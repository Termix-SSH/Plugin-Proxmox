import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/backend/plugin-ctx.js", () => ({
  pluginCtx: () => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }),
}));
vi.mock("../../src/backend/proxmox/collect-proxmox-stats.js", () => ({
  collectProxmoxStats: vi.fn(async () => null),
}));

import { ProxmoxPollingManager } from "../../src/backend/proxmox-stats-polling.js";

type Host = { id: number; userId: string };

function makeManager() {
  return new ProxmoxPollingManager<Host>({
    fetchHostById: vi.fn(async () => null),
    withSshConnection: vi.fn() as never,
    historyRepository: {
      create: vi.fn(async () => {}),
      pruneOlderThan: vi.fn(async () => {}),
      listRange: vi.fn(async () => []),
    },
  });
}

let manager: ProxmoxPollingManager<Host> | null = null;
afterEach(() => manager?.destroy());

describe("GHSA-hh6h-r224-fpjh stats viewers belong to their user", () => {
  it("does not let another user stop a viewer", () => {
    manager = makeManager();
    manager.registerViewer(1, "viewer-1", "owner");
    manager.unregisterViewer(1, "viewer-1", "someone-else");
    expect(manager.updateHeartbeat("viewer-1", "owner")).toBe(true);
  });

  it("does not let another user keep a viewer alive", () => {
    manager = makeManager();
    manager.registerViewer(1, "viewer-1", "owner");
    expect(manager.updateHeartbeat("viewer-1", "someone-else")).toBe(false);
  });

  it("ignores a viewer id given with the wrong host", () => {
    manager = makeManager();
    manager.registerViewer(1, "viewer-1", "owner");
    manager.unregisterViewer(2, "viewer-1", "owner");
    expect(manager.updateHeartbeat("viewer-1", "owner")).toBe(true);
  });

  it("lets the owner stop their own viewer", () => {
    manager = makeManager();
    manager.registerViewer(1, "viewer-1", "owner");
    manager.unregisterViewer(1, "viewer-1", "owner");
    expect(manager.updateHeartbeat("viewer-1", "owner")).toBe(false);
  });
});
