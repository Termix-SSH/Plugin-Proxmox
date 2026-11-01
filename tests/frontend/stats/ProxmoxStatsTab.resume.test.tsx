import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pluginApi = vi.hoisted(() => ({}));
const api = vi.hoisted(() => ({
  startPolling: vi.fn(),
  stopPolling: vi.fn(async () => undefined),
  getStats: vi.fn(),
  sendHeartbeat: vi.fn(async () => undefined),
}));

vi.mock("@termix-ssh/plugin-sdk/frontend", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({ t: (key: string) => key, language: "en" }),
  usePluginApi: () => pluginApi,
  useHosts: () => ({ hosts: [] }),
}));

vi.mock("../../../src/frontend/stats/proxmox-stats-api", () => ({
  createProxmoxStatsApi: () => api,
}));

vi.mock("../../../src/frontend/stats/NodeSummaryStrip", () => ({
  NodeSummaryStrip: () => <div>node summary</div>,
}));
vi.mock("../../../src/frontend/stats/cards/NodeNetworkCard", () => ({
  NodeNetworkCard: () => null,
}));
vi.mock("../../../src/frontend/stats/cards/StoragePoolsCard", () => ({
  StoragePoolsCard: () => null,
}));
vi.mock("../../../src/frontend/stats/cards/ClusterHealthCard", () => ({
  ClusterHealthCard: () => null,
}));

import { ProxmoxStatsTab } from "../../../src/frontend/stats/ProxmoxStatsTab";

const SNAPSHOT = {
  node: { cpu: { percent: 1 }, memory: { percent: 2 }, disk: { percent: 3 } },
  guests: { guests: [], counts: {} },
  cluster: { clustered: false },
};

const HOST = {
  id: 1,
  name: "pve",
  ip: "10.0.0.1",
  username: "root",
  pluginSettings: { proxmox: { enableProxmoxStats: true } },
};

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

async function connect() {
  render(<ProxmoxStatsTab hostConfig={HOST} />);
  await advance(600);
  expect(screen.getByText("node summary")).toBeInTheDocument();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  api.startPolling.mockResolvedValue({ viewerSessionId: "viewer-1" });
  api.getStats.mockResolvedValue(SNAPSHOT);
});

afterEach(() => {
  cleanup();
  setHidden(false);
  vi.useRealTimers();
});

describe("ProxmoxStatsTab in the background", () => {
  it("keeps the session through a quick switch away", async () => {
    await connect();
    api.stopPolling.mockClear();
    api.startPolling.mockClear();

    await act(async () => setHidden(true));
    await advance(5_000);
    await act(async () => setHidden(false));
    await advance(1_000);

    expect(api.stopPolling).not.toHaveBeenCalled();
    expect(api.startPolling).not.toHaveBeenCalled();
    expect(screen.getByText("node summary")).toBeInTheDocument();
  });

  it("reconnects behind the stats after a long switch away", async () => {
    await connect();

    await act(async () => setHidden(true));
    await advance(11_000);
    expect(api.stopPolling).toHaveBeenCalled();

    api.startPolling.mockClear();
    api.startPolling.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => setHidden(false));
    await advance(600);

    expect(api.startPolling).toHaveBeenCalledTimes(1);
    expect(screen.getByText("node summary")).toBeInTheDocument();
    expect(screen.queryByText("proxmoxStats.connecting")).toBeNull();
  });

  it("shows the connection screen when the reconnect fails", async () => {
    await connect();

    await act(async () => setHidden(true));
    await advance(11_000);

    api.startPolling.mockRejectedValueOnce(new Error("no route"));
    await act(async () => setHidden(false));
    await advance(600);

    expect(screen.queryByText("node summary")).toBeNull();
    expect(screen.getAllByText("no route").length).toBeGreaterThan(0);
  });
});
