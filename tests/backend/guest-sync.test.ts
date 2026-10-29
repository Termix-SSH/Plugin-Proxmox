import { describe, expect, it } from "vitest";
import {
  getProxmoxSource,
  guestFolder,
  indexImportedGuests,
  nextGuestFolder,
  parseClusterName,
  proxmoxSourceKey,
} from "../../src/backend/guest-sync.js";

const source = {
  source: "proxmox",
  sourceHostId: 1,
  node: "pve",
  vmid: 101,
  type: "qemu",
};

describe("getProxmoxSource", () => {
  it("reads the source from an object or a JSON string", () => {
    expect(getProxmoxSource({ source })).toEqual(source);
    expect(getProxmoxSource(JSON.stringify({ source }))).toEqual(source);
  });

  it("refuses a malformed source", () => {
    expect(getProxmoxSource(null)).toBeNull();
    expect(getProxmoxSource({ source: { ...source, vmid: "101" } })).toBeNull();
    expect(getProxmoxSource({ source: { ...source, type: "vm" } })).toBeNull();
  });
});

describe("indexImportedGuests", () => {
  // The host row carries no proxmoxConfig since 2.9.0; the source only
  // exists in the plugin's host settings.
  const hosts = [
    { id: 10, name: "guest-a" },
    { id: 11, name: "guest-b" },
    { id: 12, name: "manual" },
  ];

  it("matches hosts to guests through their settings", () => {
    const index = indexImportedGuests(
      hosts,
      [
        { hostId: 10, value: { source, lastSyncAt: "x" } },
        { hostId: 11, value: { source: { ...source, sourceHostId: 2 } } },
      ],
      1,
    );
    expect([...index.keys()]).toEqual([proxmoxSourceKey(source as never)]);
    const entry = index.get("qemu:101")!;
    expect(entry.host.id).toBe(10);
    expect(entry.config.lastSyncAt).toBe("x");
  });

  it("finds a guest imported on a linked server or desktop by sync id", () => {
    const index = indexImportedGuests(
      hosts,
      [
        {
          hostId: 11,
          value: {
            source: { ...source, sourceHostId: 7, sourceSyncId: "pve" },
          },
        },
      ],
      1,
      "pve",
    );
    expect(index.get("qemu:101")?.host.id).toBe(11);
  });

  it("ignores settings for hosts the user does not own", () => {
    const index = indexImportedGuests(
      hosts,
      [{ hostId: 99, value: { source } }],
      1,
    );
    expect(index.size).toBe(0);
  });

  it("keys a guest without its node, so a migration keeps the host", () => {
    expect(proxmoxSourceKey({ ...source, node: "pve2" } as never)).toBe(
      proxmoxSourceKey(source as never),
    );
  });
});

describe("cluster aware sync", () => {
  const hosts = [
    { id: 10, name: "from-pve0" },
    { id: 11, name: "from-pve1" },
  ];

  it("finds a guest another node of the same cluster imported", () => {
    const index = indexImportedGuests(
      hosts,
      [
        {
          hostId: 10,
          value: { source: { ...source, sourceHostId: 1, clusterName: "lab" } },
        },
      ],
      2,
      null,
      "lab",
    );
    expect(index.get("qemu:101")?.host.id).toBe(10);
  });

  it("ignores guests of another cluster", () => {
    const index = indexImportedGuests(
      hosts,
      [
        {
          hostId: 10,
          value: { source: { ...source, sourceHostId: 1, clusterName: "a" } },
        },
      ],
      2,
      null,
      "b",
    );
    expect(index.size).toBe(0);
  });

  it("prefers the copy this node imported when there are two", () => {
    const configs = [
      {
        hostId: 11,
        value: { source: { ...source, sourceHostId: 2, clusterName: "lab" } },
      },
      {
        hostId: 10,
        value: { source: { ...source, sourceHostId: 1, clusterName: "lab" } },
      },
    ];
    expect(
      indexImportedGuests(hosts, configs, 2, null, "lab").get("qemu:101")?.host
        .id,
    ).toBe(11);
    expect(
      indexImportedGuests(hosts, configs, 1, null, "lab").get("qemu:101")?.host
        .id,
    ).toBe(10);
  });

  it("reads the cluster name from pvesh output", () => {
    expect(
      parseClusterName(
        JSON.stringify([
          { type: "cluster", name: "lab", quorate: 1 },
          { type: "node", name: "pve0" },
        ]),
      ),
    ).toBe("lab");
    expect(parseClusterName(JSON.stringify([{ type: "node" }]))).toBeNull();
    expect(parseClusterName("")).toBeNull();
  });

  it("names the folder after the setting, the cluster, then the host", () => {
    const base = { clusterName: "lab", sourceHostName: "pve0", node: "pve1" };
    expect(guestFolder(base)).toBe("lab");
    expect(guestFolder({ ...base, folderName: "Homelab" })).toBe("Homelab");
    expect(guestFolder({ ...base, clusterName: null })).toBe("pve0");
    expect(guestFolder({ ...base, groupByNode: true })).toBe("lab / pve1");
  });

  it("moves guests out of folders sync made, and keeps the user's own", () => {
    const managed = ["lab", "pve0"];
    expect(nextGuestFolder(undefined, "lab", managed)).toBe("lab");
    expect(nextGuestFolder("pve0", "lab", managed)).toBe("lab");
    expect(nextGuestFolder("lab / pve0", "lab / pve2", managed)).toBe(
      "lab / pve2",
    );
    expect(nextGuestFolder("Databases", "lab", managed)).toBe("Databases");
  });
});
