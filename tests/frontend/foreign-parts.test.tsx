import { describe, expect, it } from "vitest";
import { renderWithApp } from "@termix-ssh/plugin-sdk/testing";
import * as plugin from "../../src/frontend/index";
import manifest from "../../manifest.json";

function OtherPart(props: Record<string, unknown>) {
  return <p>other part {String(props.hostId ?? "")}</p>;
}

describe("other plugins' parts", () => {
  it("draws what another plugin puts in proxmox.hostEditor", async () => {
    const rendered = await renderWithApp(plugin, {
      manifest: manifest as never,
      others: {
        slots: {
          "proxmox.hostEditor": [
            { actionId: "other.part", component: OtherPart },
          ],
        },
      },
    });
    const element = rendered.renderSlot("proxmox.hostEditor", { hostId: 7 });
    expect(element.textContent).toContain("other part 7");
    await rendered.deactivate();
  });
});
