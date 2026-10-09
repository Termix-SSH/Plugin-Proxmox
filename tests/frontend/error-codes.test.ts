import { describe, expect, it } from "vitest";
import { proxmoxErrorText } from "../../src/frontend/error-codes";

const t = (key: string) => `t:${key}`;

describe("proxmoxErrorText", () => {
  it("translates a known code", () => {
    expect(proxmoxErrorText(t, "PVESH_NOT_FOUND", "raw")).toBe(
      "t:proxmoxStats.pveshNotFound",
    );
  });

  it("keeps the fallback for an unknown or missing code", () => {
    expect(proxmoxErrorText(t, "NOPE", "raw")).toBe("raw");
    expect(proxmoxErrorText(t, undefined, "raw")).toBe("raw");
  });
});
