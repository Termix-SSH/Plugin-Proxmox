import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";

const guests = [
  { vmid: 100, name: "web", type: "qemu", node: "zeus", status: "running" },
  { vmid: 101, name: "dns", type: "lxc", node: "zeus", status: "stopped" },
];
const withPveshRunner = vi.hoisted(() => vi.fn());

vi.mock("../../src/backend/operations.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withPveshRunner,
}));

import { registerGuestRoutes } from "../../src/backend/guests.js";

type Handler = (req: Request, res: Response) => Promise<unknown>;

function setup(hasAccess = true) {
  const handlers = new Map<string, Handler>();
  const router = {
    get: (path: string, handler: Handler) =>
      handlers.set(`GET ${path}`, handler),
    post: (path: string, handler: Handler) =>
      handlers.set(`POST ${path}`, handler),
  } as unknown as Router;
  const checkAccess = vi.fn(async () => ({ hasAccess }));
  const ctx = {
    hosts: { checkAccess },
    currentActor: () => "user-1",
    log: { warn: vi.fn() },
    operations: undefined,
  } as unknown as PluginContext;
  registerGuestRoutes(router, ctx);
  const call = async (hostId: string) => {
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    await handlers.get("GET /guests/:hostId/tree")!(
      { params: { hostId } } as unknown as Request,
      res as unknown as Response,
    );
    return res;
  };
  return { call, checkAccess };
}

beforeEach(() => {
  withPveshRunner.mockReset();
  withPveshRunner.mockResolvedValue(guests);
});

describe("GET /guests/:hostId/tree", () => {
  it("lists the guests and keeps them for a moment", async () => {
    const { call, checkAccess } = setup();
    const first = await call("5");
    expect(first.statusCode).toBe(200);
    expect(first.body).toEqual({ items: guests });
    expect(checkAccess).toHaveBeenCalledWith(5, "connect");
    await call("5");
    expect(withPveshRunner).toHaveBeenCalledTimes(1);
  });

  it("needs access to the host", async () => {
    const { call } = setup(false);
    expect((await call("5")).statusCode).toBe(403);
    expect(withPveshRunner).not.toHaveBeenCalled();
  });

  it("refuses a bad host id and hides Proxmox errors", async () => {
    const { call } = setup();
    expect((await call("abc")).statusCode).toBe(400);
    withPveshRunner.mockRejectedValue(new Error("secret detail"));
    const failed = await call("6");
    expect(failed.statusCode).toBe(502);
    expect(JSON.stringify(failed.body)).not.toContain("secret");
  });
});
