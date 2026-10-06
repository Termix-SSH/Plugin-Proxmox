import { useMemo, useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Box, Server as ServerIcon } from "lucide-react";
import { PanelSearch, EmptyState, Segmented } from "@termix-ssh/plugin-sdk/ui";
import type { ProxmoxGuestSummary } from "../types";
import { cn } from "@termix-ssh/plugin-sdk/ui";

type StatusFilter = "all" | "running" | "stopped";
type TypeFilter = "all" | "qemu" | "lxc";

function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "-";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function UsageCell({
  percent,
  usedGiB,
  totalGiB,
}: {
  percent: number | null;
  usedGiB?: number | null;
  totalGiB?: number | null;
}) {
  if (percent === null) {
    return <span className="text-[11px] text-muted-foreground">-</span>;
  }
  const clamped = Math.min(100, Math.max(0, percent));
  const barColor =
    clamped >= 90
      ? "bg-red-500"
      : clamped >= 75
        ? "bg-warning"
        : "bg-accent-brand";
  return (
    <div className="flex min-w-[92px] flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tabular-nums">
          {clamped.toFixed(0)}%
        </span>
        {usedGiB != null && totalGiB != null && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {usedGiB.toFixed(1)}/{totalGiB.toFixed(1)}G
          </span>
        )}
      </div>
      <div className="h-1 w-full overflow-hidden bg-muted">
        <div
          className={cn("h-full", barColor)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export function GuestTable({ guests }: { guests: ProxmoxGuestSummary[] }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return guests
      .filter(
        (g) =>
          statusFilter === "all" ||
          (statusFilter === "running") === (g.status === "running"),
      )
      .filter((g) => typeFilter === "all" || g.type === typeFilter)
      .filter(
        (g) =>
          !q || g.name.toLowerCase().includes(q) || String(g.vmid).includes(q),
      )
      .sort((a, b) => {
        if (a.status === b.status) return a.name.localeCompare(b.name);
        return a.status === "running" ? -1 : 1;
      });
  }, [guests, query, statusFilter, typeFilter]);

  const running = guests.filter((g) => g.status === "running").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-[11px] text-muted-foreground">
          {t("proxmoxStats.guestCounts", { running, total: guests.length })}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <PanelSearch
            value={query}
            onChange={setQuery}
            placeholder={t("proxmoxStats.searchGuests")}
            className="w-40 md:w-56"
          />
          <Segmented<TypeFilter>
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: "all", label: t("proxmoxStats.filterAll") },
              { value: "qemu", label: t("proxmoxStats.filterVm") },
              { value: "lxc", label: t("proxmoxStats.filterLxc") },
            ]}
          />
          <Segmented<StatusFilter>
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: t("proxmoxStats.filterAll") },
              { value: "running", label: t("proxmoxStats.running") },
              { value: "stopped", label: t("proxmoxStats.stopped") },
            ]}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        {guests.length === 0 ? (
          <EmptyState icon={ServerIcon} title={t("proxmoxStats.noGuests")} />
        ) : filtered.length === 0 ? (
          <EmptyState title={t("proxmoxStats.noGuestsMatch")} />
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground/70">
                <th className="px-3 py-2 text-left font-semibold">
                  {t("proxmoxStats.name")}
                </th>
                <th className="px-3 py-2 text-left font-semibold">
                  {t("proxmoxStats.status")}
                </th>
                <th className="px-3 py-2 text-left font-semibold">ID</th>
                <th className="px-3 py-2 text-left font-semibold">
                  {t("proxmoxStats.cpu")}
                </th>
                <th className="px-3 py-2 text-left font-semibold">
                  {t("proxmoxStats.mem")}
                </th>
                <th className="px-3 py-2 text-left font-semibold">
                  {t("proxmoxStats.disk")}
                </th>
                <th className="px-3 py-2 text-left font-semibold">
                  {t("proxmoxStats.uptime")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((guest) => (
                <tr
                  key={`${guest.type}-${guest.vmid}`}
                  className="transition-colors hover:bg-muted/40"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {guest.type === "lxc" ? (
                        <Box className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ServerIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 truncate font-semibold">
                        {guest.name}
                      </span>
                      <span className="shrink-0 border border-border px-1 py-px text-[9px] uppercase text-muted-foreground">
                        {guest.type === "lxc" ? "LXC" : "VM"}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "size-1.5 shrink-0",
                          guest.status === "running"
                            ? "bg-green-500"
                            : "bg-muted-foreground/50",
                        )}
                      />
                      <span
                        className={cn(
                          "font-medium",
                          guest.status === "running"
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {guest.status === "running"
                          ? t("proxmoxStats.running")
                          : t("proxmoxStats.stopped")}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {guest.vmid}
                  </td>
                  <td className="px-3 py-2">
                    <UsageCell percent={guest.cpuPercent} />
                  </td>
                  <td className="px-3 py-2">
                    <UsageCell
                      percent={guest.memPercent}
                      usedGiB={guest.memUsedGiB}
                      totalGiB={guest.memTotalGiB}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <UsageCell
                      percent={guest.diskPercent}
                      usedGiB={guest.diskUsedGiB}
                      totalGiB={guest.diskTotalGiB}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {formatUptime(guest.uptimeSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
