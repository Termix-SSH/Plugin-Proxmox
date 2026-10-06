/* eslint-disable react-hooks/exhaustive-deps */
import React from "react";
import {
  Button,
  ConnectionScreen,
  ConnectionLogProvider,
  useConnectionLog,
  TabStrip,
} from "@termix-ssh/plugin-sdk/ui";
import {
  useTranslation,
  usePluginApi,
  useHosts,
} from "@termix-ssh/plugin-sdk/frontend";
import { RefreshCw, Server } from "lucide-react";
import { createProxmoxStatsApi } from "./proxmox-stats-api";
import type { ProxmoxStatsSnapshot, ProxmoxStatsConfig } from "../types";
import { NodeSummaryStrip } from "./NodeSummaryStrip";
import { GuestTable } from "./GuestTable";
import { NodeNetworkCard } from "./cards/NodeNetworkCard";
import { StoragePoolsCard } from "./cards/StoragePoolsCard";
import { ClusterHealthCard } from "./cards/ClusterHealthCard";
import { useConnectionRetry } from "@termix-ssh/plugin-sdk/frontend";
import { runAdaptivePolling } from "@termix-ssh/plugin-sdk/ui";

const HISTORY_LEN = 30;

function statsChangeKey(data: ProxmoxStatsSnapshot): string {
  const bucket = (value: number | null | undefined) =>
    value == null ? null : Math.round(value / 5) * 5;
  return JSON.stringify({
    cpu: bucket(data.node.cpu.percent),
    memory: bucket(data.node.memory.percent),
    disk: bucket(data.node.disk.percent),
    guests: data.guests.counts,
    cluster: data.cluster,
  });
}
const DEFAULT_POLL_INTERVAL = 60;

interface HostConfig {
  id: number;
  name: string;
  ip: string;
  username: string;
  pluginSettings?: {
    proxmox?: {
      enableProxmoxStats?: boolean;
      proxmoxStatsConfig?: string | ProxmoxStatsConfig | null;
    };
  };
  authType?: string;
  port?: number;
  [key: string]: unknown;
}

interface ProxmoxStatsProps {
  hostConfig?: HostConfig;
  title?: string;
  isVisible?: boolean;
  isTopbarOpen?: boolean;
  embedded?: boolean;
}

interface ProxmoxStatsHistories {
  cpu: number[];
  memory: number[];
  disk: number[];
}

function parseProxmoxStatsConfig(
  raw?: string | ProxmoxStatsConfig | null,
): Required<Pick<ProxmoxStatsConfig, "pollInterval">> & ProxmoxStatsConfig {
  const defaults = { pollInterval: DEFAULT_POLL_INTERVAL, nodeName: null };
  if (!raw) return defaults;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function ProxmoxStatsTab(props: ProxmoxStatsProps): React.ReactElement {
  return (
    <ConnectionLogProvider>
      <ProxmoxStatsInner {...props} />
    </ConnectionLogProvider>
  );
}

function ProxmoxStatsInner({
  hostConfig,
  title,
  isVisible = true,
  isTopbarOpen = true,
  embedded = false,
}: ProxmoxStatsProps): React.ReactElement {
  const { t } = useTranslation();
  const { addLog, clearLogs } = useConnectionLog();
  const pluginApi = usePluginApi();
  const api = React.useMemo(
    () => createProxmoxStatsApi(pluginApi),
    [pluginApi],
  );
  const { hosts } = useHosts();

  const [view, setView] = React.useState<"overview" | "guests">("overview");
  const [snapshot, setSnapshot] = React.useState<ProxmoxStatsSnapshot | null>(
    null,
  );
  const [histories, setHistories] = React.useState<ProxmoxStatsHistories>({
    cpu: [],
    memory: [],
    disk: [],
  });
  const [currentHostConfig, setCurrentHostConfig] = React.useState(hostConfig);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [isPageVisible, setIsPageVisible] = React.useState(!document.hidden);
  const [viewerSessionId, setViewerSessionId] = React.useState<string | null>(
    null,
  );

  const proxmoxSettings = currentHostConfig?.pluginSettings?.proxmox;
  const statsConfig = React.useMemo(
    () => parseProxmoxStatsConfig(proxmoxSettings?.proxmoxStatsConfig),
    [proxmoxSettings?.proxmoxStatsConfig],
  );

  React.useEffect(() => {
    const onVis = () => setIsPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const isActuallyVisible = isVisible && isPageVisible;

  React.useEffect(() => {
    if (!viewerSessionId || !isActuallyVisible) return;
    const interval = setInterval(() => {
      api.sendHeartbeat(viewerSessionId).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [viewerSessionId, isActuallyVisible, api]);

  React.useEffect(() => {
    if (hostConfig?.id !== currentHostConfig?.id) {
      setSnapshot(null);
      setHistories({ cpu: [], memory: [], disk: [] });
    }
    setCurrentHostConfig(hostConfig);
  }, [hostConfig?.id]);

  React.useEffect(() => {
    if (!hostConfig?.id) return;
    const updated = hosts.find((h) => String(h.id) === String(hostConfig.id));
    if (updated) setCurrentHostConfig(updated as unknown as HostConfig);
  }, [hostConfig?.id, hosts]);

  const pushHistory = React.useCallback((data: ProxmoxStatsSnapshot) => {
    setHistories((prev) => {
      const add = (arr: number[], v: number | null | undefined) =>
        [...arr, v ?? 0].slice(-HISTORY_LEN);
      return {
        cpu: add(prev.cpu, data.node?.cpu?.percent),
        memory: add(prev.memory, data.node?.memory?.percent),
        disk: add(prev.disk, data.node?.disk?.percent),
      };
    });
  }, []);

  const notEnabled = proxmoxSettings?.enableProxmoxStats !== true;
  const stopPollingRef = React.useRef<(() => void) | null>(null);

  const fetchSnapshot = React.useCallback(async (): Promise<void> => {
    if (!currentHostConfig?.id) return;

    addLog({
      type: "info",
      stage: "stats_connecting",
      message: t("proxmoxStats.connecting"),
    });

    const result = await api.startPolling(currentHostConfig.id);
    if (result.viewerSessionId) setViewerSessionId(result.viewerSessionId);

    addLog({
      type: "info",
      stage: "stats_polling",
      message: t("proxmoxStats.connecting"),
    });

    const data = await api.getStats(currentHostConfig.id);
    if (!data) {
      throw new Error(t("proxmoxStats.connectionFailed"));
    }

    setSnapshot(data);
    addLog({
      type: "success",
      stage: "connected",
      message: t("terminal.connected"),
    });

    const intervalMs =
      (statsConfig.pollInterval ?? DEFAULT_POLL_INTERVAL) * 1000;
    let signature = statsChangeKey(data);
    stopPollingRef.current?.();
    stopPollingRef.current = runAdaptivePolling(
      async () => {
        const next = await api.getStats(currentHostConfig.id);
        if (!next) throw new Error(t("proxmoxStats.connectionFailed"));
        const nextSignature = statsChangeKey(next);
        const changed = nextSignature !== signature;
        signature = nextSignature;
        setSnapshot(next);
        pushHistory(next);
        return changed;
      },
      {
        minIntervalMs: intervalMs,
        maxIntervalMs: Math.min(120_000, intervalMs * 6),
        stablePollsPerStep: 3,
      },
      { runImmediately: false },
    );
  }, [
    currentHostConfig?.id,
    statsConfig.pollInterval,
    addLog,
    t,
    pushHistory,
    api,
  ]);

  const retry = useConnectionRetry({
    connect: async () => {
      try {
        await fetchSnapshot();
        retry.markConnected();
      } catch (error: unknown) {
        addLog({
          type: "error",
          stage: "error",
          message:
            error instanceof Error
              ? error.message
              : t("proxmoxStats.connectionFailed"),
        });
        retry.markFailed();
      }
    },
    enabled: isPageVisible && !notEnabled && !!currentHostConfig?.id,
    autoStart: false,
  });

  const retryRef = React.useRef(retry);
  retryRef.current = retry;

  // Connects once per host and stays connected while this tab exists, even
  // when the user switches to another tab and back. Only the browser tab
  // going into the background (isPageVisible) pauses/resumes it -- switching
  // between Termix tabs must not tear down and reconnect the session.
  React.useEffect(() => {
    if (notEnabled || !currentHostConfig?.id) return;

    let cancelled = false;
    const debounce = setTimeout(() => {
      if (isPageVisible && !cancelled) {
        clearLogs();
        retryRef.current.reset();
        retryRef.current.retryNow();
      } else if (!isPageVisible) {
        stopPollingRef.current?.();
        stopPollingRef.current = null;
        if (currentHostConfig?.id) {
          api.stopPolling(currentHostConfig.id, undefined).catch(() => {});
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      stopPollingRef.current?.();
      stopPollingRef.current = null;
      if (currentHostConfig?.id) {
        api.stopPolling(currentHostConfig.id).catch(() => {});
      }
    };
  }, [currentHostConfig?.id, notEnabled, isPageVisible, api]);

  const wrapperStyle: React.CSSProperties = embedded
    ? { opacity: isVisible ? 1 : 0, height: "100%", width: "100%" }
    : {
        opacity: isVisible ? 1 : 0,
        margin: isTopbarOpen ? "74px 17px 8px 8px" : "16px 17px 8px 8px",
        height: isTopbarOpen ? "calc(100vh - 82px)" : "calc(100vh - 24px)",
      };

  const handleRefresh = async () => {
    if (!currentHostConfig?.id) return;
    if (retry.status !== "connected") {
      retry.retryNow();
      return;
    }
    try {
      setIsRefreshing(true);
      const data = await api.getStats(currentHostConfig.id);
      if (data) {
        setSnapshot(data);
        pushHistory(data);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const showContent = !notEnabled && retry.status === "connected" && snapshot;

  return (
    <div
      style={wrapperStyle}
      className="relative flex flex-col overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {retry.status === "connected" && !notEnabled && (
          <div className="flex h-12.5 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
            <div className="flex min-w-0 items-center gap-2">
              <Server className="size-4 shrink-0 text-accent-brand" />
              <h1 className="truncate text-base font-bold tracking-tight">
                {title}
              </h1>
              {snapshot && (
                <>
                  <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
                  <span className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("proxmoxStats.guestCounts", {
                      running: snapshot.guests.guests.filter(
                        (g) => g.status === "running",
                      ).length,
                      total: snapshot.guests.guests.length,
                    })}
                  </span>
                </>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title={t("proxmoxStats.refresh")}
              className="text-accent-brand"
            >
              <RefreshCw
                className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        )}

        {showContent && (
          <div className="shrink-0 border-b border-border px-1">
            <TabStrip
              tabs={[
                { id: "overview", label: t("proxmoxStats.overview") },
                {
                  id: "guests",
                  label: t("proxmoxStats.guestsSummary"),
                  count: snapshot.guests.guests.length,
                },
              ]}
              activeTab={view}
              onTabChange={(id) => setView(id as "overview" | "guests")}
            />
          </div>
        )}

        {showContent && view === "guests" && (
          <GuestTable guests={snapshot.guests.guests} />
        )}

        {showContent && view === "overview" && (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
            <div className="shrink-0">
              <NodeSummaryStrip node={snapshot.node} histories={histories} />
            </div>

            <div className="grid shrink-0 grid-cols-1 gap-2 md:grid-cols-3">
              <NodeNetworkCard snapshot={snapshot} />
              <StoragePoolsCard snapshot={snapshot} />
              {snapshot.cluster.clustered && (
                <ClusterHealthCard snapshot={snapshot} />
              )}
            </div>
          </div>
        )}

        <ConnectionScreen
          status={notEnabled ? "error" : retry.status}
          message={t("proxmoxStats.connecting")}
          detail={
            currentHostConfig?.ip
              ? `${currentHostConfig.username ? `${currentHostConfig.username}@` : ""}${currentHostConfig.ip}${currentHostConfig.port ? `:${currentHostConfig.port}` : ""}`
              : undefined
          }
          attempt={retry.attempt}
          maxAttempts={retry.maxAttempts}
          nextRetryInMs={retry.nextRetryInMs}
          onManualRetry={retry.retryNow}
          unavailable={
            notEnabled
              ? {
                  title: t("proxmoxStats.notEnabled"),
                  hint: t("proxmoxStats.notEnabledHint"),
                }
              : null
          }
        />
      </div>
    </div>
  );
}
