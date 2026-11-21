import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { PveshRunner } from "./proxmox/pvesh-runner.js";
import { isSafeNodeName } from "./proxmox-shared.js";
import {
  listGuests,
  requireHost,
  withPveshRunner,
  type Guest,
} from "./operations.js";
import { waitForTask } from "./snapshot-operations.js";

const STORAGE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const VOLID = /^[A-Za-z][A-Za-z0-9_.-]{0,63}:[A-Za-z0-9_./+-]{1,255}$/;
const BRIDGE = /^[A-Za-z][A-Za-z0-9_.-]{0,15}$/;
const GUEST_NAME = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,61}[A-Za-z0-9])?$/;
const SSH_KEY = /^(ssh-|ecdsa-|sk-)[A-Za-z0-9@.+/=\s_-]+$/;

export interface GuestOptions {
  nodes: string[];
  node: string;
  nextId: number;
  storages: Array<{
    storage: string;
    content: string[];
    availGiB: number | null;
  }>;
  isos: string[];
  templates: string[];
  bridges: string[];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function int(
  value: unknown,
  label: string,
  min: number,
  max: number,
  fallback?: number,
): number {
  if (
    (value === undefined || value === null || value === "") &&
    fallback !== undefined
  ) {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

function match(value: unknown, re: RegExp, label: string): string {
  const text = String(value ?? "").trim();
  if (!re.test(text)) throw new Error(`${label} is not valid`);
  return text;
}

function node(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!isSafeNodeName(text)) throw new Error("Pick a node");
  return text;
}

async function pveshJson<T>(
  run: PveshRunner,
  path: string,
  what: string,
): Promise<T> {
  const { stdout, code, stderr } = await run(
    `pvesh get ${path} --output-format json`,
    25000,
  );
  if (code !== 0) throw new Error(stderr.trim() || `Could not read ${what}`);
  return JSON.parse(stdout) as T;
}

async function runTask(run: PveshRunner, nodeName: string, command: string) {
  const result = await run(command, 120000);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Proxmox refused the request");
  }
  await waitForTask(run, nodeName, result.stdout, 30 * 60 * 1000);
}

export interface VmInput {
  node: string;
  vmid: number;
  name: string;
  cores: number;
  memoryMiB: number;
  diskGiB: number;
  storage: string;
  iso: string;
  bridge: string;
  start: boolean;
}

export function readVmInput(
  input: Record<string, unknown>,
  nextId: number,
): VmInput {
  return {
    node: node(input.node),
    vmid: int(input.vmid, "The ID", 100, 999999999, nextId),
    name: match(input.name, GUEST_NAME, "The name"),
    cores: int(input.cores, "Cores", 1, 512, 2),
    memoryMiB: int(input.memoryMiB, "Memory", 64, 4194304, 2048),
    diskGiB: int(input.diskGiB, "Disk size", 1, 65536, 32),
    storage: match(input.storage, STORAGE, "The disk storage"),
    iso: input.iso ? match(input.iso, VOLID, "The ISO") : "",
    bridge: match(input.bridge || "vmbr0", BRIDGE, "The bridge"),
    start: input.start === true,
  };
}

export function createVmCommand(vm: VmInput): string {
  const args = [
    `pvesh create /nodes/${vm.node}/qemu`,
    `--vmid ${vm.vmid}`,
    `--name ${vm.name}`,
    `--cores ${vm.cores}`,
    `--memory ${vm.memoryMiB}`,
    "--ostype l26",
    "--scsihw virtio-scsi-single",
    `--scsi0 ${shellQuote(`${vm.storage}:${vm.diskGiB}`)}`,
    `--net0 ${shellQuote(`virtio,bridge=${vm.bridge}`)}`,
    "--agent 1",
  ];
  if (vm.iso) {
    args.push(`--ide2 ${shellQuote(`${vm.iso},media=cdrom`)}`);
    args.push(`--boot ${shellQuote("order=scsi0;ide2")}`);
  }
  if (vm.start) args.push("--start 1");
  return args.join(" ");
}

export interface CtInput {
  node: string;
  vmid: number;
  hostname: string;
  template: string;
  storage: string;
  diskGiB: number;
  cores: number;
  memoryMiB: number;
  bridge: string;
  unprivileged: boolean;
  sshKey: string;
  start: boolean;
}

export function readCtInput(
  input: Record<string, unknown>,
  nextId: number,
): CtInput {
  const sshKey = String(input.sshKey ?? "").trim();
  if (sshKey && (!SSH_KEY.test(sshKey) || sshKey.length > 16384)) {
    throw new Error("The SSH key is not valid");
  }
  return {
    node: node(input.node),
    vmid: int(input.vmid, "The ID", 100, 999999999, nextId),
    hostname: match(input.hostname, GUEST_NAME, "The hostname"),
    template: match(input.template, VOLID, "The template"),
    storage: match(input.storage, STORAGE, "The disk storage"),
    diskGiB: int(input.diskGiB, "Disk size", 1, 65536, 8),
    cores: int(input.cores, "Cores", 1, 512, 1),
    memoryMiB: int(input.memoryMiB, "Memory", 16, 4194304, 512),
    bridge: match(input.bridge || "vmbr0", BRIDGE, "The bridge"),
    unprivileged: input.unprivileged !== false,
    sshKey,
    start: input.start === true,
  };
}

export function createCtCommand(ct: CtInput): string {
  const args = [
    `pvesh create /nodes/${ct.node}/lxc`,
    `--vmid ${ct.vmid}`,
    `--hostname ${ct.hostname}`,
    `--ostemplate ${shellQuote(ct.template)}`,
    `--rootfs ${shellQuote(`${ct.storage}:${ct.diskGiB}`)}`,
    `--cores ${ct.cores}`,
    `--memory ${ct.memoryMiB}`,
    `--net0 ${shellQuote(`name=eth0,bridge=${ct.bridge},ip=dhcp`)}`,
    `--unprivileged ${ct.unprivileged ? 1 : 0}`,
  ];
  if (ct.sshKey) args.push(`--ssh-public-keys ${shellQuote(ct.sshKey)}`);
  if (ct.start) args.push("--start 1");
  return args.join(" ");
}

export interface CloneInput {
  newid: number;
  name: string;
  full: boolean;
  target: string;
  storage: string;
}

export function readCloneInput(
  input: Record<string, unknown>,
  nextId: number,
): CloneInput {
  return {
    newid: int(input.newid, "The new ID", 100, 999999999, nextId),
    name: match(input.name, GUEST_NAME, "The name"),
    full: input.full === true,
    target: input.target ? node(input.target) : "",
    storage: input.storage ? match(input.storage, STORAGE, "The storage") : "",
  };
}

export function cloneCommand(guest: Guest, clone: CloneInput): string {
  if (!isSafeNodeName(guest.node)) throw new Error("Bad guest");
  const args = [
    `pvesh create /nodes/${guest.node}/${guest.type}/${guest.vmid}/clone`,
    `--newid ${clone.newid}`,
    guest.type === "qemu" ? `--name ${clone.name}` : `--hostname ${clone.name}`,
  ];
  if (clone.full) args.push("--full 1");
  if (clone.target) args.push(`--target ${clone.target}`);
  // A storage only applies to a full clone.
  if (clone.storage && clone.full) args.push(`--storage ${clone.storage}`);
  return args.join(" ");
}

async function nextId(run: PveshRunner): Promise<number> {
  const id = await pveshJson<unknown>(run, "/cluster/nextid", "the next ID");
  const n = Number(id);
  return Number.isInteger(n) ? n : 100;
}

export async function readOptions(
  run: PveshRunner,
  wanted: string | undefined,
): Promise<GuestOptions> {
  const nodes = (
    await pveshJson<Array<Record<string, unknown>>>(run, "/nodes", "the nodes")
  )
    .filter((n) => n.status === "online" && typeof n.node === "string")
    .map((n) => n.node as string)
    .filter(isSafeNodeName)
    .sort();
  const picked = wanted && nodes.includes(wanted) ? wanted : (nodes[0] ?? "");
  const out: GuestOptions = {
    nodes,
    node: picked,
    nextId: await nextId(run),
    storages: [],
    isos: [],
    templates: [],
    bridges: [],
  };
  if (!picked) return out;
  const storages = await pveshJson<Array<Record<string, unknown>>>(
    run,
    `/nodes/${picked}/storage --enabled 1`,
    "the storages",
  );
  out.storages = storages
    .filter(
      (s) => typeof s.storage === "string" && STORAGE.test(s.storage as string),
    )
    .map((s) => ({
      storage: s.storage as string,
      content: String(s.content ?? "")
        .split(",")
        .filter(Boolean),
      availGiB:
        typeof s.avail === "number"
          ? Math.round((s.avail / 1024 ** 3) * 10) / 10
          : null,
    }));
  for (const storage of out.storages) {
    const wantsIso = storage.content.includes("iso");
    const wantsTemplates = storage.content.includes("vztmpl");
    if (!wantsIso && !wantsTemplates) continue;
    const content = await pveshJson<Array<Record<string, unknown>>>(
      run,
      `/nodes/${picked}/storage/${storage.storage}/content`,
      "the storage content",
    ).catch(() => []);
    for (const item of content) {
      const volid = typeof item.volid === "string" ? item.volid : "";
      if (!VOLID.test(volid)) continue;
      if (item.content === "iso") out.isos.push(volid);
      if (item.content === "vztmpl") out.templates.push(volid);
    }
  }
  const network = await pveshJson<Array<Record<string, unknown>>>(
    run,
    `/nodes/${picked}/network --type any_bridge`,
    "the network",
  ).catch(() => []);
  out.bridges = network
    .map((n) => (typeof n.iface === "string" ? n.iface : ""))
    .filter((name) => BRIDGE.test(name))
    .sort();
  out.isos.sort();
  out.templates.sort();
  return out;
}

/** Create and clone as actions, so they go through the same checks and history. */
export function registerGuestOperations(ctx: PluginContext): void {
  const withRunner = <T>(
    hostId: number,
    fn: (run: PveshRunner) => Promise<T>,
  ) => withPveshRunner(ctx, hostId, fn);

  ctx.operations.register("proxmox.create-vm", {
    describe: (input) => `Would create VM ${String(input.name ?? "")}`,
    run: async (input, context) =>
      withRunner(requireHost(context), async (run) => {
        const vm = readVmInput(input, await nextId(run));
        await runTask(run, vm.node, createVmCommand(vm));
        return {
          summary: `Created VM ${vm.vmid} ${vm.name}`,
          changed: true,
          data: { vmid: vm.vmid },
        };
      }),
  });

  ctx.operations.register("proxmox.create-ct", {
    describe: (input) =>
      `Would create container ${String(input.hostname ?? "")}`,
    run: async (input, context) =>
      withRunner(requireHost(context), async (run) => {
        const ct = readCtInput(input, await nextId(run));
        await runTask(run, ct.node, createCtCommand(ct));
        return {
          summary: `Created container ${ct.vmid} ${ct.hostname}`,
          changed: true,
          data: { vmid: ct.vmid },
        };
      }),
  });

  ctx.operations.register("proxmox.clone-guest", {
    describe: (input, context) =>
      `Would clone guest ${context.resourceKey ?? ""} as ${String(input.name ?? "")}`,
    run: async (input, context) =>
      withRunner(requireHost(context), async (run) => {
        const vmid = Number(context.resourceKey);
        const guest = (await listGuests(run)).find((g) => g.vmid === vmid);
        if (!guest)
          throw new Error(`Guest ${String(context.resourceKey)} not found`);
        const clone = readCloneInput(input, await nextId(run));
        await runTask(run, guest.node, cloneCommand(guest, clone));
        return {
          summary: `Cloned ${guest.vmid} ${guest.name} to ${clone.newid} ${clone.name}`,
          changed: true,
          data: { vmid: clone.newid },
        };
      }),
  });
}

const TREE_CACHE_MS = 15_000;

const ACTIONS: Record<string, string> = {
  "create-vm": "proxmox.create-vm",
  "create-ct": "proxmox.create-ct",
  clone: "proxmox.clone-guest",
};

export function registerGuestRoutes(router: Router, ctx: PluginContext): void {
  const hostOf = (req: Request, res: Response): number | null => {
    const hostId = Number(req.params.hostId);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      res.status(400).json({ error: "Invalid host" });
      return null;
    }
    return hostId;
  };

  const treeCache = new Map<string, { at: number; items: Guest[] }>();

  /**
   * @openapi
   * /plugin-api/proxmox/guests/{hostId}/tree:
   *   get:
   *     summary: Guests of a Proxmox host
   *     description: The VMs and containers of the cluster the host belongs to, for host tree layouts. Needs connect access to the host. Results are kept for 15 seconds.
   *     tags:
   *       - Proxmox
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The guests.
   *       403:
   *         description: No access to the host.
   *       502:
   *         description: Proxmox could not be reached.
   */
  router.get("/guests/:hostId/tree", async (req: Request, res: Response) => {
    const hostId = hostOf(req, res);
    if (!hostId) return;
    try {
      const access = await ctx.hosts.checkAccess(hostId, "connect");
      if (!access.hasAccess) {
        return res.status(403).json({ error: "No access to this host" });
      }
      const key = `${String(ctx.currentActor() ?? "")}:${hostId}`;
      const cached = treeCache.get(key);
      if (cached && Date.now() - cached.at < TREE_CACHE_MS) {
        return res.json({ items: cached.items });
      }
      const items = await withPveshRunner(ctx, hostId, listGuests);
      treeCache.set(key, { at: Date.now(), items });
      res.json({ items });
    } catch (error) {
      ctx.log.warn(
        `Proxmox guest list failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      res.status(502).json({ error: "Could not read the guests from Proxmox" });
    }
  });

  /**
   * @openapi
   * /plugin-api/proxmox/guests/{hostId}/options:
   *   get:
   *     summary: Choices for a new guest
   *     description: Online nodes, the next free ID, and the chosen node's storages, ISO images, container templates and bridges.
   *     tags: [Proxmox]
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: node
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The choices.
   *       403:
   *         description: No edit access to the host.
   */
  router.get("/guests/:hostId/options", async (req: Request, res: Response) => {
    const hostId = hostOf(req, res);
    if (!hostId) return;
    try {
      const access = await ctx.hosts.checkAccess(hostId, "edit");
      if (!access.hasAccess) {
        return res
          .status(403)
          .json({ error: "You need edit access to this host" });
      }
      const wanted =
        typeof req.query.node === "string" ? req.query.node : undefined;
      res.json(
        await withPveshRunner(ctx, hostId, (run) => readOptions(run, wanted)),
      );
    } catch (error) {
      ctx.log.warn(
        `Proxmox guest options failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      res
        .status(502)
        .json({ error: "Could not read the choices from Proxmox" });
    }
  });

  /**
   * @openapi
   * /plugin-api/proxmox/guests/{hostId}/{action}:
   *   post:
   *     summary: Create or clone a guest
   *     description: Creates a VM or container, or clones a guest (vmid in the body). Runs as an operation, so it needs the guests permission and edit access, and lands in run history. Waits for the Proxmox task to end.
   *     tags: [Proxmox]
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: action
   *         required: true
   *         schema:
   *           type: string
   *           enum: [create-vm, create-ct, clone]
   *     responses:
   *       200:
   *         description: Done.
   *       404:
   *         description: Unknown action.
   *       422:
   *         description: Proxmox refused it, with its reason.
   */
  router.post(
    "/guests/:hostId/:action",
    async (req: Request, res: Response) => {
      const hostId = hostOf(req, res);
      if (!hostId) return;
      const actionId = ACTIONS[String(req.params.action)];
      if (!actionId) return res.status(404).json({ error: "Unknown action" });
      const body = (req.body ?? {}) as Record<string, unknown>;
      try {
        const outcome = await ctx.operations.run(actionId, {
          hostId,
          resourceKey:
            actionId === "proxmox.clone-guest"
              ? String(body.vmid ?? "")
              : undefined,
          input: body,
          confirmed: true,
        });
        if (outcome.status !== "success") {
          throw Object.assign(new Error(outcome.error ?? outcome.status), {
            status: outcome.errorCode === "forbidden" ? 403 : undefined,
          });
        }
        res.json({
          success: true,
          message: outcome.summary ?? "",
          data: outcome.data,
        });
      } catch (error) {
        const status = (error as { status?: unknown }).status;
        res
          .status(
            typeof status === "number" && status >= 400 && status < 500
              ? status
              : 422,
          )
          .json({
            error: error instanceof Error ? error.message : "The action failed",
          });
      }
    },
  );
}
