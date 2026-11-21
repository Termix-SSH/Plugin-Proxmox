import type { PluginApiClient } from "@termix-ssh/plugin-sdk/frontend";

export interface GuestOptions {
  nodes: string[];
  node: string;
  nextId: number;
  storages: Array<{
    storage: string;
    content: string[];
    availGiB: number | null;
  }>;
  isos: string[];
  templates: string[];
  bridges: string[];
}

export type GuestAction = "create-vm" | "create-ct" | "clone";

/** The server's message for a failed call, or the fallback. */
export function apiError(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data?.error;
  return typeof message === "string" && message ? message : fallback;
}

export function createGuestsApi(api: PluginApiClient) {
  return {
    async options(hostId: number, node?: string): Promise<GuestOptions> {
      const response = await api.get<GuestOptions>(
        `/guests/${hostId}/options`,
        { params: node ? { node } : {} },
      );
      return response.data;
    },

    async run(
      hostId: number,
      action: GuestAction,
      body: Record<string, unknown>,
    ): Promise<{ message: string }> {
      const response = await api.post<{ message: string }>(
        `/guests/${hostId}/${action}`,
        body,
      );
      return response.data;
    },
  };
}
