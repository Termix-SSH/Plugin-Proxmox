import { describe, expect, it, vi } from "vitest";
import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import {
  registerTreeChildren,
  toTreeChildren,
  treeState,
} from "../../src/frontend/tree-children";

describe("host tree children", () => {
  it("maps Proxmox status to tree states", () => {
    expect(treeState("running")).toBe("running");
    expect(treeState("stopped")).toBe("stopped");
    expect(treeState("suspended")).toBe("paused");
    expect(treeState("other")).toBe("unknown");
  });

  it("turns guests into items that open the guest list on them", () => {
    expect(
      toTreeChildren([
        {
          vmid: 100,
          name: "web",
          type: "qemu",
          node: "zeus",
          status: "running",
        },
        { vmid: 101, name: "", type: "lxc", node: "hera", status: "stopped" },
      ]),
    ).toEqual([
      {
        id: "qemu:100",
        label: "web",
        detail: "100 | zeus",
        kind: "vm",
        state: "running",
        tabType: "proxmox-stats",
        data: { focus: { vmid: 100 } },
      },
      {
        id: "lxc:101",
        label: "101",
        detail: "101 | hera",
        kind: "lxc",
        state: "stopped",
        tabType: "proxmox-stats",
        data: { focus: { vmid: 101 } },
      },
    ]);
  });

  it("registers only on a Termix that has host trees", () => {
    const when = () => true;
    expect(() => registerTreeChildren({} as TermixApp, when)).not.toThrow();
    const registerHostTreeChildren = vi.fn();
    registerTreeChildren(
      { registerHostTreeChildren } as unknown as TermixApp,
      when,
    );
    expect(registerHostTreeChildren).toHaveBeenCalledWith(
      expect.objectContaining({ id: "guests", when }),
    );
  });
});
