import { describe, expect, it, vi } from "vitest";
import { createMockCtx } from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";

const state = {
  guests: [
    { vmid: 101, name: "games", type: "qemu", node: "zeus", status: "running" },
  ],
  offline: [] as string[],
};

vi.mock("../../src/backend/operations.js", () => ({
  withPveshRunner: async (
    _ctx: unknown,
    _hostId: number,
    fn: (run: unknown) => unknown,
  ) => fn(async () => ({ stdout: "", stderr: "", code: 0 })),
  listGuests: async () => state.guests,
  offlineNodes: async () => state.offline,
}));

const { startProxmoxAlerts } = await import("../../src/backend/alerts.js");

const manifest = manifestJson as unknown as PluginManifest;

describe("proxmox alerts", () => {
  it("alerts when a running guest stops and a node goes offline", async () => {
    const mock = createMockCtx({
      pluginId: manifest.id,
      manifest,
      capabilities: manifest.capabilities,
      actor: "user-1",
      hosts: [
        {
          id: 3,
          userId: "user-1",
          name: "zeus",
          ip: "10.0.0.3",
          port: 22,
          username: "root",
          tags: null,
          folder: null,
          authType: "password",
        },
      ],
    });
    await mock.ctx.settings.setHost(3, "alertGuests", true);
    await mock.ctx.kv.set("alerts:3", "user-1");
    const alerts = startProxmoxAlerts(mock.ctx);

    await alerts.tick();
    expect(mock.notifications).toHaveLength(0);

    state.guests = [{ ...state.guests[0], status: "stopped" }];
    state.offline = ["hera"];
    await alerts.tick();
    await alerts.tick();

    expect(mock.notifications.map((n) => n.notification.dedupeKey)).toEqual([
      "proxmox.state_change:3:guest:101:stopped",
      "proxmox.state_change:3:node:hera",
    ]);
  });
});
