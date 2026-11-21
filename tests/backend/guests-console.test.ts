import { describe, expect, it } from "vitest";
import {
  consoleCommand,
  innerCommand,
  kindAllowed,
  newTicket,
  probeNode,
} from "../../src/backend/console.js";
import {
  cloneCommand,
  createCtCommand,
  createVmCommand,
  readCloneInput,
  readCtInput,
  readOptions,
  readVmInput,
} from "../../src/backend/guests.js";

const vm = {
  vmid: 200,
  name: "web",
  type: "qemu" as const,
  node: "zeus",
  status: "running",
};
const ct = { ...vm, vmid: 101, type: "lxc" as const };
const size = { cols: 120, rows: 40 };

describe("console commands", () => {
  it("fits the console to the guest type", () => {
    expect(kindAllowed(vm, "vnc")).toBe(true);
    expect(kindAllowed(vm, "serial")).toBe(true);
    expect(kindAllowed(vm, "shell")).toBe(false);
    expect(kindAllowed(ct, "shell")).toBe(true);
    expect(kindAllowed(ct, "vnc")).toBe(false);
    expect(innerCommand(ct, "shell")).toBe("pct enter 101");
    expect(innerCommand(vm, "serial")).toBe("qm terminal 200");
  });

  it("reads the VNC ticket from stdin, never the command line", () => {
    const { command, pty } = consoleCommand(vm, "vnc", "zeus", "root", size);
    expect(pty).toBe(false);
    expect(command).toBe(
      `bash -c 'read -r t; export LC_PVE_TICKET="$t"; exec qm vncproxy 200'`,
    );
    expect(consoleCommand(vm, "vnc", "zeus", "sudo", size).command).toMatch(
      /^sudo -n bash -c /,
    );
    expect(
      consoleCommand(vm, "vnc", "zeus", "sudo-password", size).command,
    ).toMatch(/^sudo -S -p '' bash -c /);
  });

  it("hops to the guest's node with the ticket sent as an env var", () => {
    const { command } = consoleCommand(vm, "vnc", "hera", "root", size);
    expect(command).toContain(
      "ssh -e none -T -o BatchMode=yes -o SendEnv=LC_PVE_TICKET root@zeus qm vncproxy 200",
    );
    const shell = consoleCommand(ct, "shell", "hera", "sudo", size);
    expect(shell).toEqual({
      command:
        "sudo -n ssh -e none -tt -o BatchMode=yes root@zeus pct enter 101",
      pty: true,
    });
  });

  it("gives a sudo password login a pty through script", () => {
    const { command, pty } = consoleCommand(
      ct,
      "shell",
      "zeus",
      "sudo-password",
      size,
    );
    expect(pty).toBe(false);
    expect(command).toBe(
      "sudo -S -p '' script -qfec 'stty rows 40 cols 120; exec pct enter 101' /dev/null",
    );
  });

  it("refuses a node name that could break the command", () => {
    expect(() =>
      consoleCommand({ ...vm, node: "a;b" }, "vnc", "zeus", "root", size),
    ).toThrow();
  });

  it("makes 8 character tickets", () => {
    const ticket = newTicket();
    expect(ticket).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(newTicket()).not.toBe(ticket);
  });
});

describe("probeNode", () => {
  function fakeClient(stdout: string) {
    return {
      exec(
        _command: string,
        _options: unknown,
        callback: (err: Error | undefined, stream: unknown) => void,
      ) {
        const handlers: Record<string, (value: unknown) => void> = {};
        const stderr = {
          on: () => stderr,
          removeAllListeners: () => {},
        };
        const stream = {
          on(event: string, fn: (value: unknown) => void) {
            handlers[event] = fn;
            return stream;
          },
          stderr,
          close: () => {},
          removeAllListeners: () => {},
          destroy: () => {},
        };
        callback(undefined, stream);
        setImmediate(() => {
          handlers.data?.(Buffer.from(stdout));
          handlers.close?.(0);
        });
      },
    };
  }

  it("finds root, sudo and the node name", async () => {
    expect(
      await probeNode(fakeClient("0 zeus no") as never, undefined),
    ).toEqual({ privilege: "root", node: "zeus" });
    expect(
      await probeNode(fakeClient("1000 hera yes") as never, undefined),
    ).toEqual({ privilege: "sudo", node: "hera" });
    expect(await probeNode(fakeClient("1000 hera no") as never, "pw")).toEqual({
      privilege: "sudo-password",
      node: "hera",
    });
    await expect(
      probeNode(fakeClient("1000 hera no") as never, undefined),
    ).rejects.toThrow(/root/);
  });
});

describe("create and clone", () => {
  it("builds a VM with defaults and quoted values", () => {
    const input = readVmInput(
      {
        node: "zeus",
        name: "web-01",
        storage: "local-lvm",
        iso: "local:iso/debian-12.iso",
      },
      104,
    );
    expect(input).toMatchObject({
      vmid: 104,
      cores: 2,
      memoryMiB: 2048,
      diskGiB: 32,
      bridge: "vmbr0",
    });
    expect(createVmCommand(input)).toBe(
      "pvesh create /nodes/zeus/qemu --vmid 104 --name web-01 --cores 2 --memory 2048 --ostype l26 --scsihw virtio-scsi-single --scsi0 'local-lvm:32' --net0 'virtio,bridge=vmbr0' --agent 1 --ide2 'local:iso/debian-12.iso,media=cdrom' --boot 'order=scsi0;ide2'",
    );
  });

  it("refuses values that could break the command line", () => {
    expect(() =>
      readVmInput({ node: "zeus", name: "a b", storage: "x" }, 100),
    ).toThrow(/name/);
    expect(() =>
      readVmInput({ node: "zeus", name: "a", storage: "x;y" }, 100),
    ).toThrow(/storage/);
    expect(() =>
      readVmInput({ node: "z;", name: "a", storage: "x" }, 100),
    ).toThrow(/node/);
    expect(() =>
      readCtInput(
        {
          node: "zeus",
          hostname: "a",
          storage: "x",
          template: "local:vztmpl/$(id)",
        },
        100,
      ),
    ).toThrow(/template/);
    expect(() =>
      readCtInput(
        {
          node: "zeus",
          hostname: "a",
          storage: "x",
          template: "local:vztmpl/a.tar.zst",
          sshKey: "not a key; id",
        },
        100,
      ),
    ).toThrow(/SSH key/);
  });

  it("builds a container with an SSH key", () => {
    const input = readCtInput(
      {
        node: "zeus",
        hostname: "app",
        storage: "local-lvm",
        template: "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst",
        sshKey: "ssh-ed25519 AAAAC3Nza me@pc",
        start: true,
      },
      105,
    );
    expect(createCtCommand(input)).toBe(
      "pvesh create /nodes/zeus/lxc --vmid 105 --hostname app --ostemplate 'local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst' --rootfs 'local-lvm:8' --cores 1 --memory 512 --net0 'name=eth0,bridge=vmbr0,ip=dhcp' --unprivileged 1 --ssh-public-keys 'ssh-ed25519 AAAAC3Nza me@pc' --start 1",
    );
  });

  it("clones with the right name flag per type", () => {
    const clone = readCloneInput(
      { name: "web-copy", full: true, target: "hera", storage: "nvme" },
      106,
    );
    expect(cloneCommand(vm, clone)).toBe(
      "pvesh create /nodes/zeus/qemu/200/clone --newid 106 --name web-copy --full 1 --target hera --storage nvme",
    );
    expect(cloneCommand(ct, readCloneInput({ name: "c2" }, 107))).toBe(
      "pvesh create /nodes/zeus/lxc/101/clone --newid 107 --hostname c2",
    );
  });

  it("reads the choices for a node", async () => {
    const replies: Record<string, unknown> = {
      "/nodes": [
        { node: "zeus", status: "online" },
        { node: "hera", status: "offline" },
      ],
      "/cluster/nextid": "104",
      "/nodes/zeus/storage --enabled 1": [
        {
          storage: "local",
          content: "iso,vztmpl,backup",
          avail: 10 * 1024 ** 3,
        },
        { storage: "local-lvm", content: "images,rootdir" },
      ],
      "/nodes/zeus/storage/local/content": [
        { volid: "local:iso/debian.iso", content: "iso" },
        { volid: "local:vztmpl/alpine.tar.xz", content: "vztmpl" },
        { volid: "local:backup/x", content: "backup" },
      ],
      "/nodes/zeus/network --type any_bridge": [{ iface: "vmbr0" }],
    };
    const run = async (command: string) => {
      const path = command
        .replace(/^pvesh get /, "")
        .replace(/ --output-format json$/, "");
      if (!(path in replies))
        return { stdout: "", stderr: `no ${path}`, code: 1 };
      return { stdout: JSON.stringify(replies[path]), stderr: "", code: 0 };
    };
    expect(await readOptions(run, undefined)).toEqual({
      nodes: ["zeus"],
      node: "zeus",
      nextId: 104,
      storages: [
        {
          storage: "local",
          content: ["iso", "vztmpl", "backup"],
          availGiB: 10,
        },
        {
          storage: "local-lvm",
          content: ["images", "rootdir"],
          availGiB: null,
        },
      ],
      isos: ["local:iso/debian.iso"],
      templates: ["local:vztmpl/alpine.tar.xz"],
      bridges: ["vmbr0"],
    });
  });
});
