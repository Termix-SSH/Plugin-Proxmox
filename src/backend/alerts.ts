import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { startHostAlerts, type HostProblem } from "./host-alerts.js";
import { listGuests, offlineNodes, withPveshRunner } from "./operations.js";

/**
 * Alerts for guests that stopped after being seen running, and for nodes that
 * went offline. A guest that was never seen running does not alert.
 */
export function startProxmoxAlerts(ctx: PluginContext) {
  const seenRunning = new Map<number, Set<number>>();
  return startHostAlerts({
    ctx,
    setting: "alertGuests",
    category: "proxmox.state_change",
    tab: "proxmox-stats",
    probe: (hostId) =>
      withPveshRunner(ctx, hostId, async (run) => {
        const guests = await listGuests(run);
        const seen = seenRunning.get(hostId) ?? new Set<number>();
        seenRunning.set(hostId, seen);
        const problems: HostProblem[] = [];
        for (const guest of guests) {
          if (guest.status === "running") seen.add(guest.vmid);
          else if (seen.has(guest.vmid)) {
            problems.push({
              key: `guest:${guest.vmid}:${guest.status}`,
              title: `${guest.name} is ${guest.status}`,
              body: `${guest.type === "qemu" ? "VM" : "Container"} ${guest.vmid} ${guest.name} is ${guest.status}`,
            });
          }
        }
        for (const node of await offlineNodes(run).catch(() => [])) {
          problems.push({
            key: `node:${node}`,
            title: `Node ${node} is offline`,
            body: `Node ${node} is offline`,
            severity: "critical",
          });
        }
        return problems;
      }),
  });
}
