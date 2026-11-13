import { afterEach, describe, expect, it, vi } from "vitest";
import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import {
  startProxmoxService,
  stopProxmoxService,
} from "../../src/backend/routes.js";
import {
  startProxmoxStatsService,
  stopProxmoxStatsService,
} from "../../src/backend/stats-service.js";
import type { ProxmoxNodeHistoryRepository } from "../../src/backend/proxmox-node-history-repository.js";

// A plugin process only serves routes added to ctx's router itself.
function recordingRouter() {
  const added: string[] = [];
  const record =
    (method: string) =>
    (path: unknown): void => {
      if (typeof path !== "string") throw new Error(`${method} without a path`);
      added.push(`${method.toUpperCase()} ${path}`);
    };
  const router = {
    get: record("get"),
    post: record("post"),
    put: record("put"),
    delete: record("delete"),
    use: () => {
      throw new Error("use() hides routes from a plugin process");
    },
  };
  return { router: router as unknown as Router, added };
}

describe("route mounting", () => {
  afterEach(() => {
    stopProxmoxService();
    stopProxmoxStatsService();
    vi.useRealTimers();
  });

  it("adds every route straight to the plugin's router", () => {
    vi.useFakeTimers();
    const { router, added } = recordingRouter();
    startProxmoxService(router);
    startProxmoxStatsService(
      { ssh: {} } as unknown as PluginContext,
      router,
      {} as ProxmoxNodeHistoryRepository,
    );
    expect(added.sort()).toEqual(
      [
        "POST /sync",
        "GET /discover/stream",
        "POST /discover",
        "POST /import",
        "GET /stats/:id",
        "POST /stats/start/:id",
        "POST /stats/stop/:id",
        "POST /stats/heartbeat",
        "GET /stats/history/:hostId",
      ].sort(),
    );
  });
});
