import { useMemo, type ComponentType, type ReactNode } from "react";
import { HardDrive } from "lucide-react";
import {
  useHosts,
  useTranslation,
  type ExtensionContribution,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { StatusDot, WidgetTitle } from "@termix-ssh/plugin-sdk/ui";
import { useNodeStats } from "./useNodeStats";

const GRID_SIZE = 30;

interface WidgetProps {
  widget: { title?: string | null };
  config: Record<string, never>;
}

/** What app.registerExtension("homepage.widgets", ...) takes. */
interface WidgetDefinition extends ExtensionContribution {
  id: string;
  name: string;
  description: string;
  category: "links" | "info" | "system" | "monitoring";
  icon: ReactNode;
  defaultConfig: Record<string, never>;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  components: { view: ComponentType<WidgetProps> };
}

function GuestsWidget({ widget }: WidgetProps) {
  const { t } = useTranslation();
  const { hosts } = useHosts();
  const nodes = useMemo(
    () =>
      hosts.filter(
        (host) => host.pluginSettings?.proxmox?.enableProxmoxStats === true,
      ),
    [hosts],
  );
  const stats = useNodeStats(
    nodes.map((node) => Number(node.id)),
    true,
  );
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <WidgetTitle title={widget.title} icon={<HardDrive size={11} />} />
      <div
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2 text-xs"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {nodes.length === 0 && (
          <p className="text-muted-foreground">{t("card.empty")}</p>
        )}
        {nodes.map((node) => {
          const counts = stats[Number(node.id)]?.guests.counts;
          return (
            <div key={node.id} className="flex items-center gap-2">
              <StatusDot
                tone={
                  !counts
                    ? "idle"
                    : counts.running === counts.total
                      ? "ok"
                      : "warn"
                }
              />
              <span className="min-w-0 flex-1 truncate">
                {node.name || node.ip}
              </span>
              <span className="text-muted-foreground">
                {counts
                  ? t("proxmoxStats.guestCounts", {
                      running: counts.running,
                      total: counts.total,
                    })
                  : "-"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function guestsWidget(t: TermixApp["t"]): WidgetDefinition {
  return {
    id: "proxmox_guests",
    name: t("widget.name"),
    description: t("widget.description"),
    category: "monitoring",
    icon: <HardDrive size={16} />,
    defaultConfig: {},
    defaultSize: { w: 10 * GRID_SIZE, h: 6 * GRID_SIZE },
    minSize: { w: 6 * GRID_SIZE, h: 4 * GRID_SIZE },
    components: { view: GuestsWidget },
  };
}
