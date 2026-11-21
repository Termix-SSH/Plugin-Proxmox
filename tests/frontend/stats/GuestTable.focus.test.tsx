import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@termix-ssh/plugin-sdk/frontend", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({ t: (key: string) => key, language: "en" }),
  usePluginApi: () => ({}),
}));

import { GuestTable } from "../../../src/frontend/stats/GuestTable";

const guest = (vmid: number, name: string) => ({
  vmid,
  name,
  type: "qemu" as const,
  status: "running",
  cpuPercent: null,
  memPercent: null,
  memUsedGiB: null,
  memTotalGiB: null,
  diskPercent: null,
  diskUsedGiB: null,
  diskTotalGiB: null,
  uptimeSeconds: null,
});
const guests = [guest(100, "webserver"), guest(200, "database")];

afterEach(cleanup);

describe("GuestTable focus", () => {
  it("starts filtered to the guest a host tree picked", () => {
    render(<GuestTable guests={guests} focusQuery="200" focusToken={{}} />);
    expect(screen.getByText("database")).toBeInTheDocument();
    expect(screen.queryByText("webserver")).not.toBeInTheDocument();
  });

  it("filters again when another guest is picked", () => {
    const { rerender } = render(
      <GuestTable guests={guests} focusQuery="200" focusToken={{}} />,
    );
    rerender(<GuestTable guests={guests} focusQuery="100" focusToken={{}} />);
    expect(screen.getByText("webserver")).toBeInTheDocument();
    expect(screen.queryByText("database")).not.toBeInTheDocument();
  });

  it("shows every guest without a focus", () => {
    render(<GuestTable guests={guests} />);
    expect(screen.getByText("webserver")).toBeInTheDocument();
    expect(screen.getByText("database")).toBeInTheDocument();
  });
});
