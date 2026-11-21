import React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Keyboard, Maximize2 } from "lucide-react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  InlineView,
  LoadingState,
  ToolbarBand,
  isElectron,
  pluginWsUrl,
  resolveConnectionOrigin,
} from "@termix-ssh/plugin-sdk/ui";

export type ConsoleKind = "vnc" | "shell" | "serial";

interface RfbLike {
  scaleViewport: boolean;
  resizeSession: boolean;
  focus: () => void;
  disconnect: () => void;
  sendCtrlAltDel: () => void;
  addEventListener: (type: string, fn: (event: CustomEvent) => void) => void;
}

interface GuestConsoleProps {
  hostId: number;
  connectionOrigin?: unknown;
  vmid: number;
  name: string;
  kind: ConsoleKind;
  onClose: () => void;
}

async function openSocket(connectionOrigin: unknown): Promise<WebSocket> {
  const origin = isElectron()
    ? await resolveConnectionOrigin({
        connectionOrigin: connectionOrigin as never,
      })
    : "local";
  const target = await pluginWsUrl("proxmox", "/console", { origin });
  if (!target) throw new Error("no-server");
  return new WebSocket(target.url, target.protocols);
}

/** A guest's screen (noVNC) or its text console (xterm), full size in the tab. */
export function GuestConsole({
  hostId,
  connectionOrigin,
  vmid,
  name,
  kind,
  onClose,
}: GuestConsoleProps) {
  const { t } = useTranslation();
  const target = React.useRef<HTMLDivElement>(null);
  const rfb = React.useRef<RfbLike | null>(null);
  const [state, setState] = React.useState<"connecting" | "open" | "closed">(
    "connecting",
  );
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const element = target.current;
    if (!element) return;
    let ws: WebSocket | null = null;
    let terminal: Terminal | null = null;
    let observer: ResizeObserver | null = null;
    let cancelled = false;

    const fail = (message: string) => {
      setError(message);
      setState("closed");
    };

    void (async () => {
      // Loaded first, so noVNC takes the socket before any RFB data arrives.
      const RFB =
        kind === "vnc" ? (await import("@novnc/novnc")).default : null;
      try {
        ws = await openSocket(connectionOrigin);
      } catch {
        fail(t("console.noServer"));
        return;
      }
      if (cancelled) {
        ws.close();
        return;
      }
      const socket = ws;
      let fit: FitAddon | null = null;
      if (kind !== "vnc") {
        terminal = new Terminal({
          cursorBlink: true,
          fontFamily: "monospace",
          fontSize: 14,
          theme: { background: "#0c0d0b" },
        });
        fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(element);
        fit.fit();
        terminal.onData((data) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "input", data }));
          }
        });
        observer = new ResizeObserver(() => {
          if (!fit || !terminal) return;
          fit.fit();
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: "resize",
                data: { cols: terminal.cols, rows: terminal.rows },
              }),
            );
          }
        });
        observer.observe(element);
      }

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: "connect",
            data: {
              hostId,
              vmid,
              kind,
              cols: terminal?.cols ?? 80,
              rows: terminal?.rows ?? 24,
            },
          }),
        );
      };
      socket.onclose = () => setState("closed");
      socket.onerror = () => fail(t("console.failed"));
      socket.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== "string") return;
        let message: { type?: string; data?: unknown; message?: string };
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === "error") {
          fail(message.message ?? t("console.failed"));
          return;
        }
        if (message.type === "output" && terminal) {
          terminal.write(String(message.data ?? ""));
          return;
        }
        if (message.type !== "connected") return;
        setState("open");
        if (kind !== "vnc") {
          terminal?.focus();
          return;
        }
        // From here the socket carries RFB, so noVNC takes it over.
        const password = String(
          (message.data as { password?: unknown } | undefined)?.password ?? "",
        );
        socket.onmessage = null;
        if (!RFB || cancelled) return;
        const view = new RFB(element, socket, {
          credentials: { password },
        }) as RfbLike;
        view.scaleViewport = true;
        view.resizeSession = false;
        view.addEventListener("disconnect", () => setState("closed"));
        view.addEventListener("securityfailure", () =>
          fail(t("console.authFailed")),
        );
        rfb.current = view;
        view.focus();
      };
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      rfb.current?.disconnect();
      rfb.current = null;
      ws?.close();
      terminal?.dispose();
    };
  }, [hostId, vmid, kind, connectionOrigin, t]);

  return (
    <InlineView
      open
      onOpenChange={(next) => !next && onClose()}
      title={t("console.title", { name, vmid })}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {kind === "vnc" && (
          <ToolbarBand>
            <Button
              size="sm"
              variant="outline"
              disabled={state !== "open"}
              onClick={() => rfb.current?.sendCtrlAltDel()}
            >
              <Keyboard className="size-3.5" />
              {t("console.ctrlAltDel")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={state !== "open"}
              onClick={() =>
                void target.current?.requestFullscreen?.().catch(() => {})
              }
            >
              <Maximize2 className="size-3.5" />
              {t("console.fullscreen")}
            </Button>
          </ToolbarBand>
        )}
        {state === "connecting" && (
          <LoadingState label={t("console.opening")} />
        )}
        {error && (
          <p className="shrink-0 border-b border-border px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {state === "closed" && !error && (
          <p className="shrink-0 border-b border-border px-3 py-2 text-xs text-muted-foreground">
            {t("console.closed")}
          </p>
        )}
        <div
          ref={target}
          className="min-h-0 flex-1 overflow-hidden bg-black p-1"
        />
      </div>
    </InlineView>
  );
}
