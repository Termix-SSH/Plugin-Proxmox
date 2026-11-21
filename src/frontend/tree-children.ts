import { useEffect, useState } from "react";
import {
  usePluginApi,
  type PluginHostRecord,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";

const POLL_MS = 30_000;

interface TreeGuest {
  vmid: number;
  name: string;
  type: "qemu" | "lxc";
  node: string;
  status: string;
}

interface TreeChild {
  id: string;
  label: string;
  detail?: string;
  kind: "vm" | "lxc";
  state: "running" | "stopped" | "paused" | "unknown";
  tabType: string;
  data: Record<string, unknown>;
}

interface TreeResult {
  items: TreeChild[];
  loading?: boolean;
  error?: string;
}

/** registerHostTreeChildren is in Termix 26.11.3 and newer. */
type TreeApp = TermixApp & {
  registerHostTreeChildren?: (provider: {
    id: string;
    titleKey?: string;
    when: (host: PluginHostRecord) => boolean;
    useChildren: (host: PluginHostRecord) => TreeResult | null;
    order?: number;
  }) => unknown;
};

export function treeState(status: string): TreeChild["state"] {
  if (status === "running") return "running";
  if (status === "stopped") return "stopped";
  if (status === "paused" || status === "suspended") return "paused";
  return "unknown";
}

export function toTreeChildren(guests: TreeGuest[]): TreeChild[] {
  return guests.map((guest) => ({
    id: `${guest.type}:${guest.vmid}`,
    label: guest.name || String(guest.vmid),
    detail: `${guest.vmid} | ${guest.node}`,
    kind: guest.type === "lxc" ? "lxc" : "vm",
    state: treeState(guest.status),
    tabType: "proxmox-stats",
    data: { focus: { vmid: guest.vmid } },
  }));
}

/** The cluster's guests while a host tree shows the host open. */
export function useProxmoxTreeChildren(host: PluginHostRecord): TreeResult {
  const api = usePluginApi();
  const [result, setResult] = useState<TreeResult>({
    items: [],
    loading: true,
  });
  const hostId = host.id;

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const { data } = await api.get<{ items: TreeGuest[] }>(
          `/guests/${hostId}/tree`,
        );
        if (!stopped) setResult({ items: toTreeChildren(data.items ?? []) });
      } catch (error) {
        const message =
          (error as { response?: { data?: { error?: string } } })?.response
            ?.data?.error ?? (error as Error)?.message;
        if (!stopped) setResult({ items: [], error: message });
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [api, hostId]);

  return result;
}

export function registerTreeChildren(
  app: TermixApp,
  when: (host: PluginHostRecord) => boolean,
): void {
  (app as TreeApp).registerHostTreeChildren?.({
    id: "guests",
    titleKey: "tree.guests",
    order: 40,
    when,
    useChildren: useProxmoxTreeChildren,
  });
}
