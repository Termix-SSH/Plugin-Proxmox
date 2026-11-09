import { describe, expect, it } from "vitest";
import { listGuests, powerCommand } from "../../src/backend/operations.js";

const resources = [
  { type: "qemu", vmid: 101, name: "games", node: "zeus", status: "running" },
  { type: "lxc", vmid: 200, name: "dns", node: "hera", status: "stopped" },
  { type: "qemu", vmid: 900, name: "tpl", node: "zeus", template: 1 },
  { type: "qemu", vmid: 5, name: "bad", node: "a;rm", status: "running" },
];

describe("proxmox operations", () => {
  it("lists guests and skips templates and unsafe node names", async () => {
    const guests = await listGuests(async () => ({
      stdout: JSON.stringify(resources),
      stderr: "",
      code: 0,
    }));
    expect(guests.map((g) => g.vmid)).toEqual([101, 200]);
  });

  it("fails when pvesh fails", async () => {
    await expect(
      listGuests(async () => ({ stdout: "", stderr: "not found", code: 127 })),
    ).rejects.toThrow("not found");
  });

  it("builds the power command for the guest's own node and type", () => {
    expect(
      powerCommand(
        { vmid: 200, name: "dns", type: "lxc", node: "hera", status: "x" },
        "reboot",
      ),
    ).toBe("pvesh create /nodes/hera/lxc/200/status/reboot");
  });
});
