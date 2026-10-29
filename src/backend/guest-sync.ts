export type ProxmoxSource = {
  source: "proxmox";
  sourceHostId: number;
  /**
   * The Proxmox host's sync id. Its numeric id differs between a server and a
   * linked desktop, so a guest imported on one is found by this on the other.
   */
  sourceSyncId?: string | null;
  /** The cluster's name, so another node of the same cluster finds it. */
  clusterName?: string | null;
  node: string;
  vmid: number;
  type: "qemu" | "lxc";
  lastSeenAt?: string;
  lastStatus?: string;
  missingSince?: string | null;
};

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The guest a host was imported from, read from its proxmoxConfig setting. */
export function getProxmoxSource(config: unknown): ProxmoxSource | null {
  const source = parseJsonObject(config).source;
  if (!source || typeof source !== "object") return null;
  const src = source as Record<string, unknown>;
  if (
    src.source !== "proxmox" ||
    typeof src.sourceHostId !== "number" ||
    typeof src.node !== "string" ||
    typeof src.vmid !== "number" ||
    (src.type !== "qemu" && src.type !== "lxc")
  ) {
    return null;
  }
  return src as ProxmoxSource;
}

/**
 * VM ids are unique across a cluster, so the node is left out: a guest that
 * migrates to another node stays the same host.
 */
export function proxmoxSourceKey(source: {
  sourceHostId: number;
  type: string;
  vmid: number;
}): string {
  // Only guests of one Proxmox host are compared, so its id is not needed,
  // and leaving it out lets a copy recorded with the other side's id match.
  return `${source.type}:${source.vmid}`;
}

export interface ImportedGuest<H = Record<string, unknown>> {
  host: H;
  config: Record<string, unknown>;
  source: ProxmoxSource;
}

/**
 * The hosts already imported from one Proxmox node, or from any node of the
 * same cluster, keyed by guest. The source lives in each guest's
 * proxmoxConfig host setting, not on the host row, so the caller passes both.
 * When two hosts hold the same guest, the one from this node wins.
 */
export function indexImportedGuests<H extends { id: unknown }>(
  hosts: H[],
  configs: Array<{ hostId: number; value: unknown }>,
  sourceHostId: number,
  sourceSyncId: string | null = null,
  clusterName: string | null = null,
): Map<string, ImportedGuest<H>> {
  const configById = new Map(configs.map((c) => [c.hostId, c.value]));
  const out = new Map<string, ImportedGuest<H>>();
  for (const host of hosts) {
    const config = parseJsonObject(configById.get(Number(host.id)));
    const source = getProxmoxSource(config);
    if (!source) continue;
    const ownNode =
      source.sourceHostId === sourceHostId ||
      (!!sourceSyncId && source.sourceSyncId === sourceSyncId);
    const sameCluster = !!clusterName && source.clusterName === clusterName;
    if (!ownNode && !sameCluster) continue;
    const key = proxmoxSourceKey(source);
    if (out.has(key) && !ownNode) continue;
    out.set(key, { host, config, source });
  }
  return out;
}

/** The cluster's name from `pvesh get /cluster/status`, or null on one node. */
export function parseClusterName(json: string): string | null {
  try {
    const data = JSON.parse(json);
    if (!Array.isArray(data)) return null;
    const cluster = (data as Array<Record<string, unknown>>).find(
      (entry) => entry.type === "cluster",
    );
    return typeof cluster?.name === "string" && cluster.name
      ? cluster.name
      : null;
  } catch {
    return null;
  }
}

/**
 * The folder imported guests go in: the folder set on the Proxmox host, else
 * the cluster's name, else the host's name. With groupByNode each node gets
 * its own subfolder.
 */
export function guestFolder(options: {
  folderName?: string;
  clusterName: string | null;
  sourceHostName: string;
  groupByNode?: boolean;
  node: string;
}): string {
  const base =
    options.folderName?.trim() || options.clusterName || options.sourceHostName;
  return options.groupByNode ? `${base} / ${options.node}` : base;
}

/**
 * The folder a synced guest should be in. A folder the user picked is kept;
 * one sync made (the managed folder, a node subfolder of it, or the old
 * default named after the Proxmox host) follows the current settings.
 */
export function nextGuestFolder(
  current: string | null | undefined,
  wanted: string,
  managedNames: string[],
): string {
  if (!current) return wanted;
  const managed = managedNames.some(
    (name) => current === name || current.startsWith(`${name} / `),
  );
  return managed ? wanted : current;
}
