import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../../src/frontend/index";
import manifestJson from "../../../manifest.json";
import locales from "../../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const snapshot = {
  node: {
    cpu: { percent: 42, cores: 8, load: null },
    memory: { percent: 61, usedGiB: 10, totalGiB: 16 },
    disk: { percent: 30, usedGiB: 30, totalGiB: 100 },
    uptime: { seconds: 1, formatted: "1s" },
    system: { hostname: "pve", kernel: null, pveVersion: null },
  },
  network: { interfaces: [] },
  guests: { guests: [], counts: { running: 3, stopped: 1, total: 4 } },
  storage: { pools: [] },
  cluster: {},
  lastChecked: "",
};

describe("proxmox nodes dashboard card", () => {
  it("polls each node with stats on and stops when it closes", async () => {
    const api = {
      get: vi.fn(async () => ({ data: snapshot })),
      post: vi.fn(async (url: string) => ({
        data: url.startsWith("/stats/start")
          ? { success: true, viewerSessionId: "v1" }
          : {},
      })),
    };
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api as never,
      hosts: [
        {
          id: "5",
          name: "pve",
          ip: "10.0.0.5",
          port: 22,
          pluginSettings: { proxmox: { enableProxmoxStats: true } },
        },
        { id: "6", name: "other", ip: "10.0.0.6", port: 22 },
      ],
    });
    expect(rendered.registered.dashboardCards()).toEqual(["proxmox-nodes"]);
    rendered.renderDashboardCard("proxmox-nodes");
    expect(await screen.findByText(/CPU 42%/)).toBeTruthy();
    expect(screen.getByText(/3\/4 running/)).toBeTruthy();
    expect(screen.queryByText("other")).toBeNull();
    expect(api.post).toHaveBeenCalledWith("/stats/start/5");
    cleanup();
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/stats/stop/5", {
        viewerSessionId: "v1",
      }),
    );
  });
});
