import type { Client } from "ssh2";
import type {
  PluginContext,
  PluginOperationContext,
} from "@termix-ssh/plugin-sdk/backend";
import { createPveshRunner, type PveshRunner } from "./proxmox/pvesh-runner.js";
import { isSafeNodeName } from "./proxmox-shared.js";

export interface Guest {
  vmid: number;
  name: string;
  type: "qemu" | "lxc";
  node: string;
  status: string;
}

const POWER = {
  "proxmox.start-guest": "start",
  "proxmox.shutdown-guest": "shutdown",
  "proxmox.reboot-guest": "reboot",
  "proxmox.stop-guest": "stop",
} as const;

function requireHost(context: PluginOperationContext): number {
  if (context.hostId === undefined) throw new Error("This needs a host");
  return context.hostId;
}

/** Every guest in the cluster this node belongs to. */
export async function listGuests(run: PveshRunner): Promise<Guest[]> {
  const { stdout, code, stderr } = await run(
    "pvesh get /cluster/resources --type vm --output-format json",
    25000,
  );
  if (code !== 0) {
    throw new Error(stderr.trim() || "pvesh failed. Is this a Proxmox node?");
  }
  const parsed = JSON.parse(stdout) as Record<string, unknown>[];
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (r) =>
        (r.type === "qemu" || r.type === "lxc") &&
        r.template !== 1 &&
        r.template !== true &&
        typeof r.vmid === "number" &&
        typeof r.node === "string" &&
        isSafeNodeName(r.node),
    )
    .map((r) => ({
      vmid: r.vmid as number,
      name: typeof r.name === "string" ? r.name : String(r.vmid),
      type: r.type as "qemu" | "lxc",
      node: r.node as string,
      status: typeof r.status === "string" ? r.status : "unknown",
    }))
    .sort((a, b) => a.vmid - b.vmid);
}

export function powerCommand(guest: Guest, verb: string): string {
  if (!isSafeNodeName(guest.node) || !Number.isInteger(guest.vmid)) {
    throw new Error("Bad guest");
  }
  return `pvesh create /nodes/${guest.node}/${guest.type}/${guest.vmid}/status/${verb}`;
}

/** Nodes of the cluster that are not online. */
export async function offlineNodes(run: PveshRunner): Promise<string[]> {
  const { stdout, code } = await run(
    "pvesh get /cluster/resources --type node --output-format json",
    25000,
  );
  if (code !== 0) return [];
  const parsed = JSON.parse(stdout) as Record<string, unknown>[];
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((r) => typeof r.node === "string" && r.status !== "online")
    .map((r) => r.node as string);
}

/** Runs pvesh on a host as the acting user, with the saved sudo password. */
export async function withPveshRunner<T>(
  ctx: PluginContext,
  hostId: number,
  fn: (run: PveshRunner) => Promise<T>,
): Promise<T> {
  const resolved = await ctx.ssh.resolveHost(hostId).catch(() => null);
  const sudoPassword =
    (resolved?.sudoPassword as string | undefined) || undefined;
  return ctx.ssh.withConnection<T, Client>(
    hostId,
    { pool: "proxmox-ops" },
    (client) => fn(createPveshRunner(client, sudoPassword)),
  );
}

/** Proxmox guests as actions, so they show on the host page and in rollouts. */
export function registerOperations(ctx: PluginContext): void {
  if (typeof ctx.operations?.register !== "function") return;

  const withRunner = <T>(
    hostId: number,
    fn: (run: PveshRunner) => Promise<T>,
  ): Promise<T> => withPveshRunner(ctx, hostId, fn);

  const findGuest = async (run: PveshRunner, vmid: unknown) => {
    const id = Number(vmid);
    const guest = (await listGuests(run)).find((g) => g.vmid === id);
    if (!guest) throw new Error(`Guest ${String(vmid)} not found`);
    return guest;
  };

  ctx.operations.register("proxmox.list-guests", {
    run: async (_input, context) => {
      const guests = await withRunner(requireHost(context), listGuests);
      const running = guests.filter((g) => g.status === "running").length;
      return {
        summary: `${running} of ${guests.length} guests running`,
        data: {
          rows: guests.map((g) => ({
            id: String(g.vmid),
            name: g.name,
            type: g.type === "qemu" ? "VM" : "LXC",
            node: g.node,
            status: g.status,
          })),
          options: guests.map((g) => ({
            value: String(g.vmid),
            label: `${g.vmid} ${g.name}`,
          })),
          value: running,
          status: "ok",
          label: `${running} of ${guests.length} running`,
        },
      };
    },
  });

  for (const [id, verb] of Object.entries(POWER)) {
    ctx.operations.register(id, {
      describe: (_input, context) =>
        `Would ${verb} guest ${context.resourceKey ?? ""}`,
      run: async (_input, context) =>
        withRunner(requireHost(context), async (run) => {
          const guest = await findGuest(run, context.resourceKey);
          if (verb === "start" && guest.status === "running") {
            return { summary: `${guest.name} is already running` };
          }
          const result = await run(powerCommand(guest, verb), 120000);
          if (result.code !== 0) {
            throw new Error(result.stderr.trim() || `Could not ${verb}`);
          }
          return {
            summary: `${verb} sent to ${guest.vmid} ${guest.name}`,
            changed: true,
          };
        }),
    });
  }
}
