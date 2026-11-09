import { useEffect, useMemo, useState } from "react";
import { usePluginApi } from "@termix-ssh/plugin-sdk/frontend";
import type { ProxmoxStatsSnapshot } from "../types";
import { createProxmoxStatsApi } from "./proxmox-stats-api";

const POLL_MS = 30_000;

/** Latest stats per node, polled as one viewer per node while visible. */
export function useNodeStats(ids: number[], isVisible: boolean) {
  const client = usePluginApi();
  const api = useMemo(() => createProxmoxStatsApi(client), [client]);
  const key = ids.join(",");
  const [stats, setStats] = useState<Record<number, ProxmoxStatsSnapshot>>({});

  useEffect(() => {
    if (!isVisible || !key) return;
    const nodeIds = key.split(",").map(Number);
    const viewers = new Map<number, string>();
    let cancelled = false;

    const refresh = async () => {
      await Promise.all(
        nodeIds.map(async (id) => {
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
  }, [api, isVisible, key]);

  return stats;
}
