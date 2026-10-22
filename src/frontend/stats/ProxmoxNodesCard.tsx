import { useEffect, useMemo, useState } from "react";
import { HardDrive } from "lucide-react";
import {
  useHosts,
  usePluginApi,
  useTabs,
  useTranslation,
  type DashboardCardProps,
  type PluginHostRecord,
} from "@termix-ssh/plugin-sdk/frontend";
import { ListRow, PanelList } from "@termix-ssh/plugin-sdk/ui";
import type { ProxmoxStatsSnapshot } from "../types";
import { createProxmoxStatsApi } from "./proxmox-stats-api";

const POLL_MS = 30_000;

function statsEnabled(host: PluginHostRecord): boolean {
  return host.pluginSettings?.proxmox?.enableProxmoxStats === true;
}

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : `${value.toFixed(0)}%`;
}

/**
 * Dashboard card: CPU, memory, disk and guests for every node with stats
 * on. Polls only while the card is on screen, as one viewer per node.
 */
export function ProxmoxNodesCard({ isVisible }: DashboardCardProps) {
  const { t } = useTranslation();
  const client = usePluginApi();
  const api = useMemo(() => createProxmoxStatsApi(client), [client]);
  const tabs = useTabs();
  const { hosts } = useHosts();
  const nodes = useMemo(() => hosts.filter(statsEnabled), [hosts]);
  const nodeIds = nodes.map((node) => Number(node.id)).join(",");
  const [stats, setStats] = useState<Record<number, ProxmoxStatsSnapshot>>({});

  useEffect(() => {
    if (!isVisible || !nodeIds) return;
    const ids = nodeIds.split(",").map(Number);
    const viewers = new Map<number, string>();
    let cancelled = false;

    const refresh = async () => {
      await Promise.all(
        ids.map(async (id) => {
          try {
            if (!viewers.has(id)) {
              const started = await api.startPolling(id);
              if (started.viewerSessionId) {
                viewers.set(id, started.viewerSessionId);
              }
            } else {
              await api.sendHeartbeat(viewers.get(id)!);
            }
            const next = await api.getStats(id);
            if (next && !cancelled) {
              setStats((prev) => ({ ...prev, [id]: next }));
            }
          } catch {
            // Keep the last numbers; the next round tries again.
          }
        }),
      );
    };

    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      for (const [id, viewer] of viewers) {
        void api.stopPolling(id, viewer).catch(() => {});
      }
    };
  }, [api, isVisible, nodeIds]);

  return (
    <PanelList
      empty={
        <p className="p-3 text-xs text-muted-foreground">{t("card.empty")}</p>
      }
    >
      {nodes.map((node, index) => {
        const snapshot = stats[Number(node.id)];
        const cpu = snapshot?.node.cpu.percent ?? null;
        const mem = snapshot?.node.memory.percent ?? null;
        const high = Math.max(cpu ?? 0, mem ?? 0);
        return (
          <ListRow
            key={node.id}
            stripe={index}
            tone={high >= 90 ? "destructive" : high >= 75 ? "warning" : "none"}
            icon={<HardDrive className="size-3.5" />}
            title={node.name || node.ip}
            meta={
              snapshot
                ? [
                    `${t("proxmoxStats.cpu")} ${percent(cpu)}`,
                    `${t("proxmoxStats.mem")} ${percent(mem)}`,
                    `${t("proxmoxStats.disk")} ${percent(snapshot.node.disk.percent)}`,
                    t("proxmoxStats.guestCounts", {
                      running: snapshot.guests.counts.running,
                      total: snapshot.guests.counts.total,
                    }),
                  ].join(" | ")
                : t("card.loading")
            }
            onClick={() => tabs.openTab(node, "proxmox-stats")}
          />
        );
      })}
    </PanelList>
  );
}
