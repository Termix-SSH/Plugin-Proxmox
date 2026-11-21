import { randomInt } from "node:crypto";
import { AsyncResource } from "node:async_hooks";
import { StringDecoder } from "node:string_decoder";
import type { Client, ClientChannel } from "ssh2";
import type {
  PluginContext,
  PluginWebSocketConnection,
} from "@termix-ssh/plugin-sdk/backend";
import { listGuests, type Guest } from "./operations.js";
import { createPveshRunner } from "./proxmox/pvesh-runner.js";
import { execCommand } from "./proxmox/common-utils.js";
import { isSafeNodeName } from "./proxmox-shared.js";

export type ConsoleKind = "vnc" | "shell" | "serial";

const PING_MS = 30_000;
const OPEN = 1;

type RawData = Buffer | ArrayBuffer | Buffer[];

/** The parts of core's ws socket this file uses. */
interface Socket {
  readyState: number;
  send: (data: string | Buffer, options?: { binary?: boolean }) => void;
  close: (code?: number, reason?: string) => void;
  ping: () => void;
  on(event: "message", fn: (raw: RawData, isBinary: boolean) => void): void;
  on(event: "close" | "error", fn: () => void): void;
}

function toBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw);
}
const TICKET_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** How the SSH user gets root on the node. */
export type Privilege = "root" | "sudo" | "sudo-password";

/** VNC passwords are cut to 8 characters, so the ticket is 8 long. */
export function newTicket(): string {
  let out = "";
  for (let i = 0; i < 8; i++)
    out += TICKET_CHARS[randomInt(TICKET_CHARS.length)];
  return out;
}

/** Which consoles a guest has. */
export function kindAllowed(guest: Guest, kind: ConsoleKind): boolean {
  return guest.type === "lxc"
    ? kind === "shell"
    : kind === "vnc" || kind === "serial";
}

/** The command that runs as root on the guest's own node. */
export function innerCommand(guest: Guest, kind: ConsoleKind): string {
  if (!Number.isInteger(guest.vmid) || guest.vmid <= 0)
    throw new Error("Bad guest");
  if (kind === "shell") return `pct enter ${guest.vmid}`;
  if (kind === "serial") return `qm terminal ${guest.vmid}`;
  return `qm vncproxy ${guest.vmid}`;
}

/**
 * The full command for the SSH exec. A guest on another cluster node is
 * reached with the cluster's own root ssh between nodes. The VNC ticket and a
 * sudo password come in on stdin, never on the command line.
 */
export function consoleCommand(
  guest: Guest,
  kind: ConsoleKind,
  localNode: string,
  privilege: Privilege,
  size: { cols: number; rows: number },
): { command: string; pty: boolean } {
  if (!isSafeNodeName(guest.node)) throw new Error("Bad node name");
  let inner = innerCommand(guest, kind);
  const remote = guest.node !== localNode;
  if (remote) {
    inner =
      kind === "vnc"
        ? `ssh -e none -T -o BatchMode=yes -o SendEnv=LC_PVE_TICKET root@${guest.node} ${inner}`
        : `ssh -e none -tt -o BatchMode=yes root@${guest.node} ${inner}`;
  }
  if (kind === "vnc") {
    // read takes the ticket line, then exec hands the rest of stdin to qm.
    const script = `read -r t; export LC_PVE_TICKET="$t"; exec ${inner}`;
    if (privilege === "root")
      return { command: `bash -c '${script}'`, pty: false };
    if (privilege === "sudo") {
      return { command: `sudo -n bash -c '${script}'`, pty: false };
    }
    return { command: `sudo -S -p '' bash -c '${script}'`, pty: false };
  }
  if (privilege === "root") return { command: inner, pty: true };
  if (privilege === "sudo") return { command: `sudo -n ${inner}`, pty: true };
  // sudo reads the password from stdin, so the pty comes from script.
  const cols = Math.max(20, Math.min(500, Math.floor(size.cols)));
  const rows = Math.max(5, Math.min(300, Math.floor(size.rows)));
  return {
    command: `sudo -S -p '' script -qfec 'stty rows ${rows} cols ${cols}; exec ${inner}' /dev/null`,
    pty: false,
  };
}

/** Finds out how this SSH user becomes root and what the node is called. */
export async function probeNode(
  client: Client,
  sudoPassword: string | undefined,
): Promise<{ privilege: Privilege; node: string }> {
  const probe = await execCommand(
    client,
    'printf "%s %s " "$(id -u)" "$(hostname)"; sudo -n true 2>/dev/null && echo yes || echo no',
    15000,
  );
  const [uid = "", node = "", sudo = ""] = probe.stdout.trim().split(/\s+/);
  if (uid === "0") return { privilege: "root", node };
  if (sudo === "yes") return { privilege: "sudo", node };
  if (sudoPassword) return { privilege: "sudo-password", node };
  throw new Error(
    "The console needs root on the Proxmox node. Log in as root, allow passwordless sudo, or save a sudo password for the host.",
  );
}

function parseMessage(raw: RawData): { type: string; data: unknown } {
  const parsed = JSON.parse(toBuffer(raw).toString()) as {
    type?: unknown;
    data?: unknown;
  };
  return { type: String(parsed.type ?? ""), data: parsed.data };
}

function dimension(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : fallback;
}

/**
 * Guest consoles at /plugin-ws/proxmox/console: a text console for
 * containers and VM serial ports, and the raw VNC stream for VM screens.
 * Needs the guests permission and edit access to the node's host.
 */
export function registerConsole(ctx: PluginContext): void {
  const live = new Set<() => void>();
  ctx.disposables.add(() => {
    for (const end of [...live]) end();
    live.clear();
  });

  const onConnection = async (connection: PluginWebSocketConnection) => {
    const ws = connection.socket as unknown as Socket;
    const userId = connection.userId;
    if (!userId || !(await ctx.rbac.hasFor(userId, "guests"))) {
      ws.close(1008, "Not allowed");
      return;
    }

    let stream: ClientChannel | null = null;
    let dispose: (() => void) | null = null;
    let kind: ConsoleKind | null = null;
    let started = false;

    const send = (message: Record<string, unknown>) => {
      if (ws.readyState === OPEN) ws.send(JSON.stringify(message));
    };
    const end = () => {
      stream?.end();
      stream = null;
      dispose?.();
      dispose = null;
      if (ws.readyState === OPEN) ws.close();
    };
    live.add(end);
    const ping = setInterval(() => {
      if (ws.readyState === OPEN) ws.ping();
    }, PING_MS);
    const cleanup = () => {
      clearInterval(ping);
      live.delete(end);
      stream?.end();
      stream = null;
      dispose?.();
      dispose = null;
    };

    const start = async (payload: Record<string, unknown>) => {
      if (started) return;
      started = true;
      const hostId = Number(payload.hostId);
      const vmid = Number(payload.vmid);
      const requested = String(payload.kind ?? "");
      const cols = dimension(payload.cols, 80);
      const rows = dimension(payload.rows, 24);
      if (
        !Number.isInteger(hostId) ||
        hostId <= 0 ||
        !Number.isInteger(vmid) ||
        vmid <= 0
      ) {
        send({ type: "error", message: "Pick a guest" });
        return end();
      }
      if (!["vnc", "shell", "serial"].includes(requested)) {
        send({ type: "error", message: "Unknown console type" });
        return end();
      }
      kind = requested as ConsoleKind;

      try {
        await ctx.asUser(userId, async () => {
          const access = await ctx.hosts.checkAccess(hostId, "edit");
          if (!access.hasAccess) {
            throw new Error(
              "You need edit access to this host to open a console",
            );
          }
          const host = await ctx.ssh.resolveHost(hostId);
          if (!host) throw new Error("Host not found");
          const sudoPassword =
            (host.sudoPassword as string | undefined) || undefined;
          const conn = await ctx.ssh.connect<Client>(host, {
            purpose: "proxmox-console",
            profile: "stream",
            timeoutMs: 65_000,
          });
          dispose = conn.dispose;
          if (ws.readyState !== OPEN) return end();
          const client = conn.client;

          const guest = (
            await listGuests(createPveshRunner(client, sudoPassword))
          ).find((g) => g.vmid === vmid);
          if (!guest) throw new Error(`Guest ${vmid} was not found`);
          if (!kindAllowed(guest, kind!)) {
            throw new Error("That console type does not fit this guest");
          }
          if (guest.status !== "running")
            throw new Error("The guest is not running");

          const { privilege, node } = await probeNode(client, sudoPassword);
          const { command, pty } = consoleCommand(
            guest,
            kind!,
            node,
            privilege,
            {
              cols,
              rows,
            },
          );
          const ticket = kind === "vnc" ? newTicket() : "";

          await new Promise<void>((resolve, reject) => {
            const opened = (err: Error | undefined, channel: ClientChannel) => {
              if (err) return reject(err);
              stream = channel;
              if (privilege === "sudo-password")
                channel.write(`${sudoPassword}\n`);
              if (kind === "vnc") channel.write(`${ticket}\n`);
              channel.stderr.on("data", (data: Buffer) => {
                if (kind !== "vnc")
                  send({ type: "output", data: data.toString() });
              });
              channel.on("close", () => {
                if (kind !== "vnc") send({ type: "disconnected" });
                end();
              });
              channel.on("error", () => end());
              if (kind === "vnc") {
                send({ type: "connected", data: { password: ticket } });
                channel.on("data", (data: Buffer) => {
                  if (ws.readyState === OPEN) ws.send(data, { binary: true });
                });
              } else {
                const decoder = new StringDecoder("utf8");
                channel.on("data", (data: Buffer) => {
                  send({ type: "output", data: decoder.write(data) });
                });
                send({ type: "connected", data: {} });
              }
              resolve();
            };
            if (pty) {
              client.exec(
                command,
                { pty: { term: "xterm-256color", cols, rows } },
                opened,
              );
            } else {
              client.exec(command, opened);
            }
          });
        });
      } catch (error) {
        send({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not open the console",
        });
        end();
      }
    };

    ws.on(
      "message",
      AsyncResource.bind(async (raw: RawData, isBinary: boolean) => {
        // Once VNC runs, every message is RFB data for the guest.
        if (kind === "vnc" && stream) {
          stream.write(
            Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer),
          );
          return;
        }
        if (isBinary) return;
        let message: { type: string; data: unknown };
        try {
          message = parseMessage(raw);
        } catch {
          return;
        }
        const data =
          message.data && typeof message.data === "object"
            ? (message.data as Record<string, unknown>)
            : {};
        if (message.type === "connect") await start(data);
        else if (message.type === "input" && typeof message.data === "string") {
          stream?.write(message.data);
        } else if (message.type === "resize") {
          stream?.setWindow(
            dimension(data.rows, 24),
            dimension(data.cols, 80),
            0,
            0,
          );
        } else if (message.type === "ping") send({ type: "pong" });
      }),
    );
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  };

  ctx.ws.route("/console", onConnection, { public: true, optionalAuth: true });
}
