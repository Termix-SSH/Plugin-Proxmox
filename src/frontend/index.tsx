import "@xterm/xterm/css/xterm.css";
import { useEffect, useState, type ComponentType } from "react";
import { Boxes, HardDrive, Server } from "lucide-react";
import {
  useHosts,
  type HostEditorSectionProps,
  type StandaloneViewProps,
  type TabProps,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { ComponentSlot } from "@termix-ssh/plugin-sdk/ui";
import type { PluginHostRecord } from "@termix-ssh/plugin-sdk/frontend";
import { setProxmoxApp } from "./proxmox-api";
import { ProxmoxDiscoverDialog } from "./ProxmoxDiscoverDialog";
import { HostProxmoxTab } from "./HostProxmoxTab";
import { ProxmoxStatsTab } from "./stats/ProxmoxStatsTab";
import ProxmoxStatsApp from "./stats/ProxmoxStatsApp";
import { HostProxmoxStatsTab } from "./stats/HostProxmoxStatsTab";
import { ProxmoxNodesCard } from "./stats/ProxmoxNodesCard";
import { ProxmoxHostTile } from "./stats/ProxmoxHostTile";
import { guestsWidget } from "./stats/HomepageWidget";
import { registerTreeChildren } from "./tree-children";

interface DiscoverRequest {
  hostId?: number;
  defaultCredentialId?: number | null;
  defaultAuthType?: string;
}

type Opener = (request: DiscoverRequest | null) => void;

// The Proxmox fields are this plugin's host settings, saved with the host
// through form.pluginSettings.proxmox.
function ProxmoxHostSection({ form, updateForm }: HostEditorSectionProps) {
  const values = (form.pluginSettings?.proxmox ?? {}) as Record<
    string,
    unknown
  >;
  const setField = (key: string, value: unknown) =>
    updateForm((current) => {
      const all = (current.pluginSettings ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      return {
        ...current,
        pluginSettings: {
          ...all,
          proxmox: { ...(all.proxmox ?? {}), [key]: value },
        },
      };
    });
  const sectionForm = {
    enableProxmox: values.enableProxmox === true,
    proxmoxConfig: values.proxmoxConfig ?? null,
    enableProxmoxStats: values.enableProxmoxStats === true,
    proxmoxStatsConfig: values.proxmoxStatsConfig ?? {
      pollInterval: 60,
      nodeName: null,
    },
  };
  return (
    <>
      <HostProxmoxTab
        form={sectionForm as Parameters<typeof HostProxmoxTab>[0]["form"]}
        setField={setField as Parameters<typeof HostProxmoxTab>[0]["setField"]}
      />
      <HostProxmoxStatsTab
        form={sectionForm as Parameters<typeof HostProxmoxStatsTab>[0]["form"]}
        setField={
          setField as Parameters<typeof HostProxmoxStatsTab>[0]["setField"]
        }
      />
      {/* Other plugins add Proxmox-related settings here. */}
      <ComponentSlot
        slotId="proxmox.hostEditor"
        props={{ form: sectionForm, setField }}
      />
    </>
  );
}

function ProxmoxStatsTabView({ sshHost, label, isVisible, tab }: TabProps) {
  const focus = (tab?.data as { focus?: { vmid?: number } } | undefined)?.focus;
  return (
    <ProxmoxStatsTab
      focus={focus}
      hostConfig={sshHost as never}
      title={label}
      isVisible={isVisible}
      isTopbarOpen={false}
      embedded={true}
    />
  );
}

function ProxmoxStatsStandalone({ hostId }: StandaloneViewProps) {
  return <ProxmoxStatsApp hostId={hostId} />;
}

/** This plugin's host settings, as they arrive on the host record. */
export function proxmoxSettings(
  host: Pick<PluginHostRecord, "pluginSettings">,
): Record<string, unknown> {
  return host.pluginSettings?.proxmox ?? {};
}

export function activate(app: TermixApp): void {
  setProxmoxApp(app);
  app.onDispose(() => setProxmoxApp(null));
  // Actions and the overlay both run in the plugin's background frame, so
  // the menu item and host action reach the dialog through this.
  let current: DiscoverRequest | null = null;
  const openers = new Set<Opener>();
  const openDiscover = (request: DiscoverRequest | null) => {
    current = request;
    for (const open of openers) open(request);
  };

  function DiscoverOverlay() {
    const [request, setRequest] = useState<DiscoverRequest | null>(current);
    const { hosts } = useHosts();
    useEffect(() => {
      openers.add(setRequest);
      return () => {
        openers.delete(setRequest);
      };
    }, []);
    if (!request) return null;
    // The shell only shows the overlay frame while it sees this marker.
    return (
      <>
        <span data-overlay="" hidden />
        <ProxmoxDiscoverDialog
          open
          onClose={() => openDiscover(null)}
          hosts={hosts}
          onHostsChanged={() => {}}
          preselectedHostId={request.hostId}
          defaultCredentialId={request.defaultCredentialId ?? null}
          defaultAuthType={request.defaultAuthType}
        />
      </>
    );
  }

  app.registerSlotContribution("shell.overlay", {
    actionId: "proxmox.discoverOverlay",
    titleKey: "hosts.proxmoxImportTitle",
    kind: "component",
    component: DiscoverOverlay as ComponentType<Record<string, unknown>>,
  });

  app.registerAction("proxmox.import", () => openDiscover({}));
  app.registerSlotContribution("hosts.importMenu", {
    actionId: "proxmox.import",
    titleKey: "hosts.proxmoxImportTitle",
    icon: Server as never,
    kind: "button",
  });

  app.registerHostAction({
    id: "proxmox-discover",
    titleKey: "hosts.proxmoxDiscoverAction",
    icon: Boxes,
    kind: "open",
    order: 90,
    when: (host) => !!proxmoxSettings(host).enableProxmox,
    run: (host) => {
      const config = proxmoxSettings(host).proxmoxConfig as
        | { defaultCredentialId?: number | null; defaultAuthType?: string }
        | undefined;
      openDiscover({
        hostId: Number(host.id),
        defaultCredentialId: config?.defaultCredentialId ?? null,
        defaultAuthType: config?.defaultAuthType ?? undefined,
      });
    },
  });

  // Other plugins add Proxmox settings to the section below, drawn with
  // { form, setField }.
  app.declareActionSlot({
    id: "proxmox.hostEditor",
    accepts: ["component"],
    fit: "content",
  });

  app.registerHostEditorSection({
    id: "proxmox",
    group: "ssh",
    titleKey: "hosts.tabProxmox",
    icon: Server,
    order: 50,
    component: ProxmoxHostSection,
  });

  app.registerTab("proxmox-stats", ProxmoxStatsTabView, {
    icon: HardDrive,
    titleKey: "nav.proxmoxStats",
    requiresHost: true,
    noHostMessageKey: "proxmoxStats.noHostSelected",
    standalone: ProxmoxStatsStandalone,
    preload: () => import("./stats/ProxmoxStatsTab"),
  });

  app.registerHostAction({
    id: "proxmox-stats",
    titleKey: "nav.proxmoxStats",
    icon: HardDrive,
    kind: "open",
    order: 60,
    tabType: "proxmox-stats",
    copyUrlView: "proxmox-stats",
    when: (host) => proxmoxSettings(host).enableProxmoxStats === true,
  });

  app.registerDashboardCard({
    id: "proxmox-nodes",
    titleKey: "card.title",
    defaultPanel: "main",
    defaultHeight: 200,
    frame: "framed",
    component: ProxmoxNodesCard,
  });

  app.registerSlotContribution("host-page.tiles", {
    actionId: "proxmox.hostTile",
    titleKey: "nav.proxmoxStats",
    icon: HardDrive,
    kind: "component",
    component: ProxmoxHostTile as unknown as ComponentType<
      Record<string, unknown>
    >,
    when: (context?: { host?: PluginHostRecord }) =>
      !context?.host ||
      proxmoxSettings(context.host).enableProxmoxStats === true,
  });

  app.registerExtension("homepage.widgets", guestsWidget(app.t));

  registerTreeChildren(
    app,
    (host) => proxmoxSettings(host).enableProxmoxStats === true,
  );
}
