import { describe, it, expect, vi, beforeEach } from "vitest";

const execCommand = vi.fn();
vi.mock("../../../src/backend/proxmox/common-utils.js", () => ({
  execCommand: (...args: unknown[]) => execCommand(...args),
}));

import { collectProxmoxNodeNetwork } from "../../../src/backend/proxmox/node-network-collector.js";
import type { Client } from "ssh2";

const fakeClient = {} as Client;

function result(stdout: string, code: number | null = 0) {
  return { stdout, stderr: "", code };
}

beforeEach(() => {
  execCommand.mockReset();
});

describe("collectProxmoxNodeNetwork", () => {
  it("rejects an unsafe node name before running any command", async () => {
    const res = await collectProxmoxNodeNetwork(fakeClient, "bad;name");
    expect(res.interfaces).toEqual([]);
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("reads the node's own interfaces and skips guest devices", async () => {
    execCommand.mockResolvedValueOnce(
      result(
        [
          "vmbr0 10.0.0.5/24",
          "tap101i0 fe80::1/64",
          "fwbr101i0 fe80::2/64",
        ].join("\n"),
      ),
    );
    execCommand.mockResolvedValueOnce(
      result(["vmbr0 UP", "tap101i0 UP"].join("\n")),
    );
    execCommand.mockResolvedValueOnce(
      result(
        [
          "Inter-|   Receive",
          " face |bytes    packets",
          "vmbr0: 123456    10    0    0    0     0          0         0   654321   20    0    0    0     0       0          0",
        ].join("\n"),
      ),
    );

    const res = await collectProxmoxNodeNetwork(fakeClient, "pve1");
    expect(res.interfaces).toEqual([
      {
        name: "vmbr0",
        ip: "10.0.0.5",
        state: "UP",
        rxBytes: "123456",
        txBytes: "654321",
      },
    ]);
    for (const call of execCommand.mock.calls) {
      expect(String(call[1])).not.toContain("netstat");
    }
  });

  it("returns nothing when the node output is empty", async () => {
    execCommand.mockResolvedValueOnce(result(""));
    execCommand.mockResolvedValueOnce(result(""));
    execCommand.mockResolvedValueOnce(
      result(["Inter-|   Receive", " face |"].join("\n")),
    );

    const res = await collectProxmoxNodeNetwork(fakeClient, "pve1");
    expect(res.interfaces).toEqual([]);
  });
});
