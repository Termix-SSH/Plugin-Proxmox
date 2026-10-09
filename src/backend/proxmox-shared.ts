// Proxmox node names are restricted to [a-zA-Z0-9-] by PVE itself,
// but we validate defensively before using in a shell command.
const SAFE_NODE_RE = /^[a-zA-Z0-9._-]{1,64}$/;

export function isSafeNodeName(name: string): boolean {
  return SAFE_NODE_RE.test(name);
}

export type ProxmoxErrorCode =
  "PVESH_NOT_FOUND" | "PVESH_BAD_OUTPUT" | "NODE_NAME_INVALID";

/** An error the UI can show in the user's language by its code. */
export class ProxmoxError extends Error {
  constructor(
    message: string,
    readonly code: ProxmoxErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProxmoxError";
  }
}

export function errorCodeOf(error: unknown): ProxmoxErrorCode | undefined {
  return error instanceof ProxmoxError ? error.code : undefined;
}
