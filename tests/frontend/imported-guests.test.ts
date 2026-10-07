import { describe, expect, it } from "vitest";
import type { PluginHostRecord } from "@termix-ssh/plugin-sdk/frontend";
import {
  guestKey,
  importedGuestKeys,
} from "../../src/frontend/imported-guests";

function host(extra: Partial<PluginHostRecord>): PluginHostRecord {
  return { id: "1", name: "h", ip: "10.0.0.1", port: 22, ...extra };
}

describe("importedGuestKeys", () => {
  it("matches guests by their recorded Proxmox source", () => {
    const keys = importedGuestKeys(
      [
        host({
          pluginSettings: {
            proxmox: {
              proxmoxConfig: {
                source: {
                  source: "proxmox",
                  sourceHostId: 4,
                  node: "pve1",
                  type: "lxc",
                  vmid: 101,
                },
              },
            },
          },
        }),
        host({
          pluginSettings: {
            proxmox: {
              proxmoxConfig: {
                source: {
                  source: "proxmox",
                  sourceHostId: 9,
                  node: "pve1",
                  type: "qemu",
                  vmid: 200,
                },
              },
            },
          },
        }),
      ],
      4,
    );
    expect(keys.has(guestKey({ node: "pve1", type: "lxc", vmid: 101 }))).toBe(
      true,
    );
    expect(keys.size).toBe(1);
  });

  it("falls back to the tags an older import added", () => {
    const keys = importedGuestKeys(
      [host({ tags: ["prod", "proxmox", "qemu", "pve2", "vm-300", "docker"] })],
      4,
    );
    expect([...keys]).toEqual(["pve2:qemu:300"]);
    expect(importedGuestKeys([host({ tags: ["proxmox"] })], 4).size).toBe(0);
  });
});
