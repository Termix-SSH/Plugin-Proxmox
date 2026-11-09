import { Database } from "lucide-react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { ListBadge, Meter, MetricCard } from "@termix-ssh/plugin-sdk/ui";
import type { ProxmoxStatsSnapshot } from "../../types";

export function StoragePoolsCard({
  snapshot,
}: {
  snapshot: ProxmoxStatsSnapshot | null;
}) {
  const { t } = useTranslation();
  const pools = snapshot?.storage.pools ?? [];

  return (
    <MetricCard
      title={t("proxmoxStats.storagePools")}
      icon={<Database className="size-3.5" />}
      scroll
    >
      {pools.length === 0 ? (
        <span className="text-xs text-muted-foreground">N/A</span>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {pools.map((pool) => (
            <div key={pool.name} className="flex flex-col gap-1 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {pool.name}
                </span>
                <ListBadge>{pool.type}</ListBadge>
                {!pool.active && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {t("proxmoxStats.inactive")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Meter percent={pool.percent ?? 0} className="flex-1" />
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {pool.usedGiB !== null && pool.totalGiB !== null
                    ? `${pool.usedGiB.toFixed(1)} / ${pool.totalGiB.toFixed(1)} GiB`
                    : "N/A"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </MetricCard>
  );
}
