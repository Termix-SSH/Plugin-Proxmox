import type { PluginHostRecord } from "@termix-ssh/plugin-sdk/frontend";

interface GuestRef {
  node: string;
  type: string;
  vmid: number;
}

export function guestKey(guest: GuestRef): string {
  return `${guest.node}:${guest.type}:${guest.vmid}`;
}

/**
 * Guests of one Proxmox host that are already Termix hosts, by guestKey.
 * Matches the source an import records, or the tags older imports carry.
 */
export function importedGuestKeys(
  hosts: PluginHostRecord[],
  sourceHostId: number,
): Set<string> {
  const keys = new Set<string>();
  for (const host of hosts) {
    const config = host.pluginSettings?.proxmox?.proxmoxConfig as
      | {
          source?: Partial<GuestRef> & {
            source?: string;
            sourceHostId?: number;
          };
        }
      | undefined;
    const source = config?.source;
    if (source?.source === "proxmox") {
      if (
        Number(source.sourceHostId) === sourceHostId &&
        source.node &&
        source.type &&
        typeof source.vmid === "number"
      ) {
        keys.add(guestKey(source as GuestRef));
      }
      continue;
    }

    // Imports tag guests "proxmox", type, node, then ct-<id> or vm-<id>.
    const tags = host.tags ?? [];
    const at = tags.indexOf("proxmox");
    const [type, node, idTag] = at === -1 ? [] : tags.slice(at + 1, at + 4);
    const vmid = /^(?:ct|vm)-(\d+)$/.exec(idTag ?? "")?.[1];
    if ((type === "lxc" || type === "qemu") && node && vmid) {
      keys.add(guestKey({ node, type, vmid: Number(vmid) }));
    }
  }
  return keys;
}
