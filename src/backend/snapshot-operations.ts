import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { PveshRunner } from "./proxmox/pvesh-runner.js";
import { isSafeNodeName } from "./proxmox-shared.js";
import {
  listGuests,
  requireHost,
  withPveshRunner,
  type Guest,
} from "./operations.js";

export interface Snapshot {
  name: string;
  description: string;
  createdAt: string | null;
}

const SNAPSHOT_NAME = /^[A-Za-z][A-Za-z0-9_-]{1,39}$/;
const UPID = /^UPID:[A-Za-z0-9:._@!-]+$/;

export function guestPath(guest: Guest): string {
  if (!isSafeNodeName(guest.node) || !Number.isInteger(guest.vmid)) {
    throw new Error("Bad guest");
  }
  return `/nodes/${guest.node}/${guest.type}/${guest.vmid}`;
}

export function requireSnapshotName(value: unknown): string {
  const name = String(value ?? "").trim();
  if (!SNAPSHOT_NAME.test(name)) {
    throw new Error(
      "Snapshot names start with a letter and use only letters, digits, - and _ (2 to 40 long)",
    );
  }
  return name;
}

/** A name like termix-20261119-153000, used when none is given. */
export function defaultSnapshotName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `termix-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/** Keeps a description to plain text that is safe inside single quotes. */
export function cleanDescription(value: unknown): string {
  return String(value ?? "")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/['\\`$"]/g, "")
    .trim()
    .slice(0, 200);
}

export function snapshotKey(vmid: number, name: string): string {
  return `${vmid}|${name}`;
}

export function parseSnapshotKey(key: unknown): {
  vmid: number;
  name: string;
} {
  const text = String(key ?? "");
  const at = text.indexOf("|");
  if (at < 0) throw new Error("Pick a snapshot");
  const vmid = Number(text.slice(0, at));
  if (!Number.isInteger(vmid) || vmid <= 0) throw new Error("Pick a snapshot");
  return { vmid, name: requireSnapshotName(text.slice(at + 1)) };
}

export async function listSnapshots(
  run: PveshRunner,
  guest: Guest,
): Promise<Snapshot[]> {
  const { stdout, code, stderr } = await run(
    `pvesh get ${guestPath(guest)}/snapshot --output-format json`,
    25000,
  );
  if (code !== 0) throw new Error(stderr.trim() || "Could not list snapshots");
  const parsed = JSON.parse(stdout) as Record<string, unknown>[];
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((s) => typeof s.name === "string" && s.name !== "current")
    .map((s) => ({
      name: s.name as string,
      description: typeof s.description === "string" ? s.description : "",
      createdAt:
        typeof s.snaptime === "number"
          ? new Date(s.snaptime * 1000).toISOString()
          : null,
    }));
}

const sleepMs = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits for a Proxmox task (UPID) to end and throws when it failed. */
export async function waitForTask(
  run: PveshRunner,
  node: string,
  output: string,
  timeoutMs = 600000,
  sleep: (ms: number) => Promise<void> = sleepMs,
): Promise<void> {
  const upid = output
    .trim()
    .split(/\s+/)
    .find((part) => part.startsWith("UPID:"));
  if (!upid) return;
  if (!UPID.test(upid) || !isSafeNodeName(node)) {
    throw new Error("Bad task id");
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { stdout, code } = await run(
      `pvesh get /nodes/${node}/tasks/'${upid}'/status --output-format json`,
      25000,
    );
    if (code === 0) {
      const status = JSON.parse(stdout) as {
        status?: string;
        exitstatus?: string;
      };
      if (status.status === "stopped") {
        if (status.exitstatus && status.exitstatus !== "OK") {
          throw new Error(status.exitstatus);
        }
        return;
      }
    }
    await sleep(2000);
  }
  throw new Error("The Proxmox task did not finish in time");
}

export function createSnapshotCommand(
  guest: Guest,
  name: string,
  description: string,
  vmstate: boolean,
): string {
  let command = `pvesh create ${guestPath(guest)}/snapshot --snapname ${requireSnapshotName(name)}`;
  if (description) command += ` --description '${description}'`;
  if (vmstate && guest.type === "qemu") command += " --vmstate 1";
  return command;
}

/** Snapshot actions, so automations can take one before an update. */
export function registerSnapshotOperations(ctx: PluginContext): void {
  const findGuest = async (run: PveshRunner, vmid: unknown) => {
    const id = Number(vmid);
    const guest = (await listGuests(run)).find((g) => g.vmid === id);
    if (!guest) throw new Error(`Guest ${String(vmid)} not found`);
    return guest;
  };

  const runTask = async (
    run: PveshRunner,
    guest: Guest,
    command: string,
    what: string,
  ) => {
    const result = await run(command, 120000);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `Could not ${what}`);
    }
    await waitForTask(run, guest.node, result.stdout);
  };

  ctx.operations.register("proxmox.list-snapshots", {
    run: async (input, context) =>
      withPveshRunner(ctx, requireHost(context), async (run) => {
        const only = input.vmid ? Number(input.vmid) : null;
        const guests = (await listGuests(run))
          .filter((g) => only === null || g.vmid === only)
          .slice(0, 100);
        const rows: Record<string, unknown>[] = [];
        for (const guest of guests) {
          for (const snap of await listSnapshots(run, guest)) {
            rows.push({
              key: snapshotKey(guest.vmid, snap.name),
              name: snap.name,
              guest: `${guest.vmid} ${guest.name}`,
              vmid: guest.vmid,
              description: snap.description,
              createdAt: snap.createdAt,
            });
          }
        }
        return {
          summary: `${rows.length} snapshots`,
          data: {
            rows,
            options: rows.map((r) => ({
              value: String(r.key),
              label: `${String(r.guest)} ${String(r.name)}`,
            })),
            value: rows.length,
          },
        };
      }),
  });

  ctx.operations.register("proxmox.create-snapshot", {
    describe: (input, context) =>
      `Would take snapshot ${input.name ? String(input.name) : "with a dated name"} of guest ${context.resourceKey ?? ""}`,
    run: async (input, context) =>
      withPveshRunner(ctx, requireHost(context), async (run) => {
        const guest = await findGuest(run, context.resourceKey);
        const name = input.name
          ? requireSnapshotName(input.name)
          : defaultSnapshotName();
        await runTask(
          run,
          guest,
          createSnapshotCommand(
            guest,
            name,
            cleanDescription(input.description),
            input.vmstate === true,
          ),
          "take the snapshot",
        );
        return {
          summary: `Took snapshot ${name} of ${guest.vmid} ${guest.name}`,
          changed: true,
          data: { name, key: snapshotKey(guest.vmid, name), vmid: guest.vmid },
        };
      }),
  });

  ctx.operations.register("proxmox.rollback-snapshot", {
    describe: (_input, context) => {
      const { vmid, name } = parseSnapshotKey(context.resourceKey);
      return `Would roll guest ${vmid} back to snapshot ${name}. Anything since then is lost.`;
    },
    run: async (_input, context) =>
      withPveshRunner(ctx, requireHost(context), async (run) => {
        const { vmid, name } = parseSnapshotKey(context.resourceKey);
        const guest = await findGuest(run, vmid);
        await runTask(
          run,
          guest,
          `pvesh create ${guestPath(guest)}/snapshot/${name}/rollback`,
          "roll back",
        );
        return {
          summary: `Rolled ${guest.vmid} ${guest.name} back to ${name}`,
          changed: true,
        };
      }),
  });

  ctx.operations.register("proxmox.delete-snapshot", {
    describe: (_input, context) =>
      `Would delete snapshot ${parseSnapshotKey(context.resourceKey).name}`,
    run: async (_input, context) =>
      withPveshRunner(ctx, requireHost(context), async (run) => {
        const { vmid, name } = parseSnapshotKey(context.resourceKey);
        const guest = await findGuest(run, vmid);
        await runTask(
          run,
          guest,
          `pvesh delete ${guestPath(guest)}/snapshot/${name}`,
          "delete the snapshot",
        );
        return {
          summary: `Deleted snapshot ${name} of ${guest.vmid} ${guest.name}`,
          changed: true,
        };
      }),
  });
}
