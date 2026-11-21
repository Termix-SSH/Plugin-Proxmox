declare module "@novnc/novnc" {
  export default class RFB {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket,
      options?: { credentials?: { password?: string } },
    );
    scaleViewport: boolean;
    resizeSession: boolean;
    focus(): void;
    disconnect(): void;
    sendCtrlAltDel(): void;
    addEventListener(type: string, fn: (event: CustomEvent) => void): void;
  }
}
