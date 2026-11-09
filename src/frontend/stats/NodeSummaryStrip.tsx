import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Cpu, MemoryStick, HardDrive, Clock, Server } from "lucide-react";
import type { ProxmoxNodeStats } from "../types";
import { StatTile, TileWall } from "@termix-ssh/plugin-sdk/ui";

function Tile({
  icon,
  label,
  percent,
  detail,
  sparkline,
}: {
  icon: React.ReactNode;
  label: string;
  percent: number | null;
  detail?: string | null;
  sparkline?: number[];
}) {
  const clamped = percent === null ? null : Math.min(100, Math.max(0, percent));
  return (
    <StatTile
      label={label}
      icon={icon}
      value={clamped === null ? "N/A" : `${clamped.toFixed(0)}%`}
      percent={clamped}
      hint={detail}
    >
      {sparkline && sparkline.length > 1 && <MiniSparkline data={sparkline} />}
    </StatTile>
  );
}

function MiniSparkline({ data }: { data: number[] }) {
  const w = 100;
  const h = 20;
  const max = 100;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - (Math.min(100, Math.max(0, v)) / max) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-5 w-full text-accent-brand/70">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function NodeSummaryStrip({
  node,
  histories,
}: {
  node: ProxmoxNodeStats | undefined;
  histories: { cpu: number[]; memory: number[]; disk: number[] };
}) {
  const { t } = useTranslation();

  return (
    <TileWall minWidth={200}>
      <Tile
        icon={<Cpu />}
        label={t("proxmoxStats.cpuUsage")}
        percent={node?.cpu.percent ?? null}
        detail={
          node?.cpu.cores != null
            ? t("proxmoxStats.cpuCores", { count: node.cpu.cores })
            : undefined
        }
        sparkline={histories.cpu}
      />
      <Tile
        icon={<MemoryStick />}
        label={t("proxmoxStats.memoryUsage")}
        percent={node?.memory.percent ?? null}
        detail={
          node?.memory.usedGiB != null && node?.memory.totalGiB != null
            ? `${node.memory.usedGiB.toFixed(1)} / ${node.memory.totalGiB.toFixed(1)} GiB`
            : undefined
        }
        sparkline={histories.memory}
      />
      <Tile
        icon={<HardDrive />}
        label={t("proxmoxStats.diskUsage")}
        percent={node?.disk.percent ?? null}
        detail={
          node?.disk.usedGiB != null && node?.disk.totalGiB != null
            ? `${node.disk.usedGiB.toFixed(1)} / ${node.disk.totalGiB.toFixed(1)} GiB`
            : undefined
        }
        sparkline={histories.disk}
      />
      <StatTile
        label={t("proxmoxStats.uptime")}
        icon={<Clock />}
        value={node?.uptime.formatted ?? "N/A"}
        hint={
          <span className="flex items-center gap-1.5">
            <Server className="size-3 shrink-0" />
            <span className="truncate">{node?.system.hostname ?? "-"}</span>
            {node?.system.pveVersion && (
              <span className="shrink-0">{node.system.pveVersion}</span>
            )}
          </span>
        }
      />
    </TileWall>
  );
}
