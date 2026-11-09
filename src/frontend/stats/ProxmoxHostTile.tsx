import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { StatTile, TileWall, LoadingState } from "@termix-ssh/plugin-sdk/ui";
import { useNodeStats } from "./useNodeStats";

/** Guest counts of one node, on the host page. */
export function ProxmoxHostTile({
  hostId,
  isVisible = true,
}: {
  hostId: number;
  isVisible?: boolean;
}) {
  const { t } = useTranslation();
  const stats = useNodeStats([Number(hostId)], isVisible);
  const counts = stats[Number(hostId)]?.guests.counts;
  if (!counts) {
    return <LoadingState compact label={t("card.loading")} />;
  }
  return (
    <TileWall size="3">
      <StatTile label={t("tile.running")} value={String(counts.running)} />
      <StatTile label={t("tile.stopped")} value={String(counts.stopped)} />
      <StatTile label={t("tile.total")} value={String(counts.total)} />
    </TileWall>
  );
}
