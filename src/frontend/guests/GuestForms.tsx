import React from "react";
import { toast } from "sonner";
import { usePluginApi, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  FormFooter,
  InlineView,
  LoadingState,
  NumberField,
  Segmented,
  SelectField,
  SwitchRow,
  TextAreaField,
  TextField,
} from "@termix-ssh/plugin-sdk/ui";
import { apiError, createGuestsApi, type GuestOptions } from "./guests-api";

const NAME_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,61}[A-Za-z0-9])?$/;

type GuestKind = "vm" | "ct";

/** Picks the storages that can hold the disk for a VM or a container. */
export function diskStorages(options: GuestOptions, kind: GuestKind): string[] {
  const content = kind === "vm" ? "images" : "rootdir";
  return options.storages
    .filter((s) => s.content.includes(content))
    .map((s) => s.storage);
}

function useOptions(hostId: number, node: string) {
  const api = usePluginApi();
  const guests = React.useMemo(() => createGuestsApi(api), [api]);
  const [options, setOptions] = React.useState<GuestOptions | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    let cancelled = false;
    setOptions(null);
    guests
      .options(hostId, node || undefined)
      .then((next) => !cancelled && setOptions(next))
      .catch((e) => !cancelled && setError(apiError(e, "")));
    return () => {
      cancelled = true;
    };
  }, [guests, hostId, node]);
  return { guests, options, error };
}

export function NewGuestForm({
  hostId,
  onClose,
  onDone,
}: {
  hostId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [node, setNode] = React.useState("");
  const { guests, options, error } = useOptions(hostId, node);
  const [kind, setKind] = React.useState<GuestKind>("vm");
  const [name, setName] = React.useState("");
  const [vmid, setVmid] = React.useState(0);
  const [cores, setCores] = React.useState(2);
  const [memory, setMemory] = React.useState(2048);
  const [disk, setDisk] = React.useState(32);
  const [storage, setStorage] = React.useState("");
  const [image, setImage] = React.useState("");
  const [bridge, setBridge] = React.useState("vmbr0");
  const [start, setStart] = React.useState(false);
  const [sshKey, setSshKey] = React.useState("");
  const [unprivileged, setUnprivileged] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!options) return;
    if (!node) setNode(options.node);
    setVmid((current) => current || options.nextId);
    const disks = diskStorages(options, kind);
    setStorage((current) =>
      disks.includes(current) ? current : (disks[0] ?? ""),
    );
    const images = kind === "vm" ? options.isos : options.templates;
    setImage((current) =>
      images.includes(current)
        ? current
        : kind === "vm"
          ? ""
          : (images[0] ?? ""),
    );
    if (options.bridges.length && !options.bridges.includes(bridge)) {
      setBridge(options.bridges[0]);
    }
  }, [options, kind, node, bridge]);

  React.useEffect(() => {
    setCores(kind === "vm" ? 2 : 1);
    setMemory(kind === "vm" ? 2048 : 512);
    setDisk(kind === "vm" ? 32 : 8);
  }, [kind]);

  const valid =
    NAME_RE.test(name) &&
    !!storage &&
    (kind === "vm" || !!image) &&
    vmid >= 100;

  const save = async () => {
    setSaving(true);
    try {
      const common = {
        node,
        vmid,
        cores,
        memoryMiB: memory,
        diskGiB: disk,
        storage,
        bridge,
        start,
      };
      const result =
        kind === "vm"
          ? await guests.run(hostId, "create-vm", {
              ...common,
              name,
              iso: image || undefined,
            })
          : await guests.run(hostId, "create-ct", {
              ...common,
              hostname: name,
              template: image,
              sshKey: sshKey.trim() || undefined,
              unprivileged,
            });
      toast.success(result.message || t("guests.created"));
      onDone();
    } catch (e) {
      toast.error(apiError(e, t("guests.failed")));
    } finally {
      setSaving(false);
    }
  };

  const images = options
    ? kind === "vm"
      ? options.isos
      : options.templates
    : [];

  return (
    <InlineView
      open
      onOpenChange={(next) => !next && onClose()}
      title={t("guests.new")}
      footer={
        <FormFooter
          onCancel={onClose}
          onSave={() => void save()}
          saving={saving}
          disabled={!valid || !options}
          cancelLabel={t("guests.cancel")}
          saveLabel={t("guests.create")}
        />
      }
    >
      {error ? (
        <p className="p-3 text-sm text-destructive">
          {error || t("guests.optionsFailed")}
        </p>
      ) : !options ? (
        <LoadingState label={t("guests.loading")} />
      ) : (
        <div className="flex flex-col gap-3 p-3">
          <Segmented<GuestKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: "vm", label: t("guests.vm") },
              { value: "ct", label: t("guests.ct") },
            ]}
          />
          {options.nodes.length > 1 && (
            <SelectField
              label={t("guests.node")}
              value={node}
              onChange={setNode}
              options={options.nodes.map((value) => ({ value, label: value }))}
            />
          )}
          <TextField
            label={kind === "vm" ? t("guests.name") : t("guests.hostname")}
            value={name}
            onChange={setName}
            placeholder={kind === "vm" ? "web-01" : "app-01"}
            mono
          />
          <NumberField
            label={t("guests.vmid")}
            value={vmid}
            onChange={setVmid}
            min={100}
            max={999999999}
          />
          <SelectField
            label={kind === "vm" ? t("guests.iso") : t("guests.template")}
            value={image}
            onChange={setImage}
            options={[
              ...(kind === "vm"
                ? [{ value: "", label: t("guests.noIso") }]
                : []),
              ...images.map((value) => ({
                value,
                label: value.replace(/^[^:]+:(iso|vztmpl)\//, ""),
              })),
            ]}
          />
          {kind === "ct" && images.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t("guests.noTemplates")}
            </p>
          )}
          <SelectField
            label={t("guests.storage")}
            value={storage}
            onChange={setStorage}
            options={diskStorages(options, kind).map((value) => {
              const free = options.storages.find(
                (s) => s.storage === value,
              )?.availGiB;
              return {
                value,
                label:
                  free == null
                    ? value
                    : t("guests.storageFree", { storage: value, free }),
              };
            })}
          />
          <NumberField
            label={t("guests.disk")}
            value={disk}
            onChange={setDisk}
            min={1}
            max={65536}
          />
          <NumberField
            label={t("guests.cores")}
            value={cores}
            onChange={setCores}
            min={1}
            max={512}
          />
          <NumberField
            label={t("guests.memory")}
            value={memory}
            onChange={setMemory}
            min={16}
            max={4194304}
          />
          {options.bridges.length > 0 && (
            <SelectField
              label={t("guests.bridge")}
              value={bridge}
              onChange={setBridge}
              options={options.bridges.map((value) => ({
                value,
                label: value,
              }))}
            />
          )}
          {kind === "ct" && (
            <>
              <SwitchRow
                label={t("guests.unprivileged")}
                description={t("guests.unprivilegedHint")}
                checked={unprivileged}
                onChange={setUnprivileged}
              />
              <TextAreaField
                label={t("guests.sshKey")}
                hint={t("guests.sshKeyHint")}
                value={sshKey}
                onChange={setSshKey}
                rows={3}
                mono
              />
            </>
          )}
          <SwitchRow
            label={t("guests.start")}
            checked={start}
            onChange={setStart}
          />
        </div>
      )}
    </InlineView>
  );
}

export function CloneForm({
  hostId,
  vmid,
  name: source,
  onClose,
  onDone,
}: {
  hostId: number;
  vmid: number;
  name: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { guests, options, error } = useOptions(hostId, "");
  const [name, setName] = React.useState(`${source}-clone`.slice(0, 63));
  const [newid, setNewid] = React.useState(0);
  const [full, setFull] = React.useState(true);
  const [target, setTarget] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (options) setNewid((current) => current || options.nextId);
  }, [options]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await guests.run(hostId, "clone", {
        vmid,
        name,
        newid,
        full,
        target: target || undefined,
      });
      toast.success(result.message || t("guests.cloned"));
      onDone();
    } catch (e) {
      toast.error(apiError(e, t("guests.failed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <InlineView
      open
      onOpenChange={(next) => !next && onClose()}
      title={t("guests.cloneTitle", { name: source })}
      footer={
        <FormFooter
          onCancel={onClose}
          onSave={() => void save()}
          saving={saving}
          disabled={!NAME_RE.test(name) || newid < 100 || !options}
          cancelLabel={t("guests.cancel")}
          saveLabel={t("guests.clone")}
        />
      }
    >
      {error ? (
        <p className="p-3 text-sm text-destructive">{error}</p>
      ) : !options ? (
        <LoadingState label={t("guests.loading")} />
      ) : (
        <div className="flex flex-col gap-3 p-3">
          <TextField
            label={t("guests.name")}
            value={name}
            onChange={setName}
            mono
          />
          <NumberField
            label={t("guests.vmid")}
            value={newid}
            onChange={setNewid}
            min={100}
            max={999999999}
          />
          <SwitchRow
            label={t("guests.full")}
            description={t("guests.fullHint")}
            checked={full}
            onChange={setFull}
          />
          {options.nodes.length > 1 && (
            <SelectField
              label={t("guests.targetNode")}
              value={target}
              onChange={setTarget}
              options={[
                { value: "", label: t("guests.sameNode") },
                ...options.nodes.map((value) => ({ value, label: value })),
              ]}
            />
          )}
          <p className="text-xs text-muted-foreground">
            {t("guests.cloneHint")}
          </p>
        </div>
      )}
    </InlineView>
  );
}
