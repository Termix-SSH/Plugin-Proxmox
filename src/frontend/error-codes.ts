const KEYS: Record<string, string> = {
  PVESH_NOT_FOUND: "proxmoxStats.pveshNotFound",
  PVESH_BAD_OUTPUT: "proxmoxStats.pveshBadOutput",
  NODE_NAME_INVALID: "proxmoxStats.nodeDetectionFailed",
};

/** The translated text for a backend error code, or the fallback. */
export function proxmoxErrorText(
  t: (key: string) => string,
  code: string | undefined,
  fallback: string,
): string {
  const key = code ? KEYS[code] : undefined;
  return key ? t(key) : fallback;
}
