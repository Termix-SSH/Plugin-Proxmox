import { describe, expect, it } from "vitest";
import {
  cleanDescription,
  createSnapshotCommand,
  defaultSnapshotName,
  listSnapshots,
  parseSnapshotKey,
  requireSnapshotName,
  snapshotKey,
  waitForTask,
} from "../../src/backend/snapshot-operations.js";

const lxc = {
  vmid: 101,
  name: "web",
  type: "lxc" as const,
  node: "zeus",
  status: "running",
};
const vm = { ...lxc, vmid: 200, type: "qemu" as const };

describe("proxmox snapshot operations", () => {
  it("lists snapshots without the current state entry", async () => {
    const snaps = await listSnapshots(async (command) => {
      expect(command).toBe(
        "pvesh get /nodes/zeus/lxc/101/snapshot --output-format json",
      );
      return {
        stdout: JSON.stringify([
          { name: "current", running: 1 },
          { name: "pre-update", snaptime: 1700000000, description: "x" },
        ]),
        stderr: "",
        code: 0,
      };
    }, lxc);
    expect(snaps).toEqual([
      {
        name: "pre-update",
        description: "x",
        createdAt: new Date(1700000000 * 1000).toISOString(),
      },
    ]);
  });

  it("checks snapshot names", () => {
    expect(requireSnapshotName("pre-update_1")).toBe("pre-update_1");
    expect(() => requireSnapshotName("1abc")).toThrow();
    expect(() => requireSnapshotName("a;rm -rf")).toThrow();
    expect(() => requireSnapshotName("")).toThrow();
  });

  it("makes a dated default name that passes the check", () => {
    const name = defaultSnapshotName(new Date(2026, 10, 19, 15, 30, 5));
    expect(name).toBe("termix-20261119-153005");
    expect(requireSnapshotName(name)).toBe(name);
  });

  it("strips quotes and shell characters from descriptions", () => {
    expect(cleanDescription('it\'s $(rm) `x` "y"\n ok')).toBe(
      "its (rm) x y  ok",
    );
  });

  it("round trips snapshot keys and rejects bad ones", () => {
    expect(parseSnapshotKey(snapshotKey(101, "snap1"))).toEqual({
      vmid: 101,
      name: "snap1",
    });
    expect(() => parseSnapshotKey("nope")).toThrow();
    expect(() => parseSnapshotKey("0|snap1")).toThrow();
    expect(() => parseSnapshotKey("101|bad name")).toThrow();
  });

  it("builds the create command and only adds RAM for VMs", () => {
    expect(createSnapshotCommand(lxc, "s1", "before", true)).toBe(
      "pvesh create /nodes/zeus/lxc/101/snapshot --snapname s1 --description 'before'",
    );
    expect(createSnapshotCommand(vm, "s1", "", true)).toBe(
      "pvesh create /nodes/zeus/qemu/200/snapshot --snapname s1 --vmstate 1",
    );
  });

  it("waits for the task and throws when it failed", async () => {
    const upid = "UPID:zeus:0001:0002:0003:vzsnapshot:101:root@pam:";
    let calls = 0;
    await waitForTask(
      async () => {
        calls += 1;
        return {
          stdout: JSON.stringify(
            calls < 2
              ? { status: "running" }
              : { status: "stopped", exitstatus: "OK" },
          ),
          stderr: "",
          code: 0,
        };
      },
      "zeus",
      upid,
      60000,
      async () => {},
    );
    expect(calls).toBe(2);

    await expect(
      waitForTask(
        async () => ({
          stdout: JSON.stringify({
            status: "stopped",
            exitstatus: "snapshot failed",
          }),
          stderr: "",
          code: 0,
        }),
        "zeus",
        upid,
        60000,
        async () => {},
      ),
    ).rejects.toThrow("snapshot failed");
  });

  it("does not wait when there is no task id", async () => {
    await waitForTask(
      async () => {
        throw new Error("should not run");
      },
      "zeus",
      "",
    );
  });
});
