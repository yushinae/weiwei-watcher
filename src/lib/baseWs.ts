// ═══════════════════════════════════════════════════════════════════════════════
// BaseWS — shared WebSocket plumbing for the app's singleton clients.
//
// Captures the mechanics every client repeated identically:
//   • status state + listeners (subscribeStatus replays current, setStatus dedups)
//   • channel subscription ref-counting (first sub / last unsub hooks)
//   • reconnect scheduling with backoff (fixed when min === max)
//   • heartbeat / ping timer lifecycle
//   • socket open / teardown + message routing
//
// Protocol-specific bits stay in the subclass via the template hooks below:
//   url() · handleOpen() · handleMessage() · sendSubscribe() · sendUnsubscribe()
//   (+ optional canConnect / shouldReconnect / handleClose / onConnecting / sendPing)
//
// Generic over the status union S so each client keeps its exact public status type
// (Deribit / Bybit-public = 3 states; Bybit-private adds 'auth').
// ═══════════════════════════════════════════════════════════════════════════════

export type WsStatus = 'disconnected' | 'connecting' | 'connected';

type AnyListener = (data: never) => void;

// ── 数据新鲜度上报（控制反转，避免 lib 反向依赖 registry/data） ──────────────────
export type WsActivityKind = 'message' | 'connected' | 'disconnected';
export type WsActivityReporter = (feedKey: string, kind: WsActivityKind) => void;
let _wsActivityReporter: WsActivityReporter | null = null;
/** 由 registry/data/freshness 在启动时注入；未注入时所有上报均为 no-op。 */
export function _setWsActivityReporter(r: WsActivityReporter): void { _wsActivityReporter = r; }

export interface BaseWSOptions {
  /** Reconnect delay in ms. Fixed delay when min === max, else exponential min→max. */
  backoffMin?: number;
  backoffMax?: number;
  /** Heartbeat interval in ms. ≤ 0 disables the ping timer. */
  pingMs?: number;
}

export abstract class BaseWS<S extends string = WsStatus> {
  protected ws: WebSocket | null = null;
  protected subs = new Map<string, Set<AnyListener>>();

  /** 设置后，本连接的消息/断开会上报到新鲜度护栏（见 _setWsActivityReporter）。 */
  protected feedKey?: string;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private backoff: number;
  private readonly backoffMin: number;
  private readonly backoffMax: number;
  private readonly pingMs: number;

  private _status: S = 'disconnected' as S;
  private _statusListeners = new Set<(s: S) => void>();

  constructor(opts: BaseWSOptions = {}) {
    this.backoffMin = opts.backoffMin ?? 1_000;
    this.backoffMax = opts.backoffMax ?? 30_000;
    this.pingMs = opts.pingMs ?? 20_000;
    this.backoff = this.backoffMin;
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  /** Subscribe to status changes; the callback fires immediately with the current status. */
  subscribeStatus(cb: (s: S) => void): () => void {
    this._statusListeners.add(cb);
    cb(this._status);
    return () => { this._statusListeners.delete(cb); };
  }

  protected get status(): S { return this._status; }

  protected setStatus(s: S): void {
    if (s === this._status) return;
    this._status = s;
    this._statusListeners.forEach(fn => fn(s));
    if (this.feedKey && s === 'disconnected') _wsActivityReporter?.(this.feedKey, 'disconnected');
  }

  subscriptionCount(): number {
    return this.subs.size;
  }

  // ── Channel subscriptions (ref-counted) ──────────────────────────────────────

  subscribe<T>(channel: string, cb: (data: T) => void): () => void {
    let set = this.subs.get(channel);
    if (!set) {
      set = new Set();
      this.subs.set(channel, set);
      this.onFirstSubscribe(channel);
    }
    set.add(cb as AnyListener);
    return () => {
      const s = this.subs.get(channel);
      if (!s) return;
      s.delete(cb as AnyListener);
      if (s.size === 0) {
        this.subs.delete(channel);
        this.onLastUnsubscribe(channel);
      }
    };
  }

  /** Deliver a decoded payload to a channel's listeners. */
  protected dispatch(channel: string, data: unknown): void {
    if (this.feedKey) _wsActivityReporter?.(this.feedKey, 'message');
    this.subs.get(channel)?.forEach(fn => (fn as (d: unknown) => void)(data));
  }

  /** Re-send a subscribe frame for every active channel (used after (re)connect). */
  protected resubscribeAll(): void {
    for (const channel of this.subs.keys()) this.sendSubscribe(channel);
  }

  // ── Socket lifecycle ─────────────────────────────────────────────────────────

  protected openSocket(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;
    if (!this.canConnect()) return;
    this.setStatus('connecting' as S);
    this.onConnecting();
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => { this.backoff = this.backoffMin; this.handleOpen(); };
    ws.onmessage = (e: MessageEvent) => this.handleMessage(e.data as string);
    ws.onclose = () => this.onSocketClose();
    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
  }

  /** Tear down the socket and stop all timers — no auto-reconnect afterwards. */
  protected closeSocket(): void {
    this.setStatus('disconnected' as S);
    this.stopPing();
    this.cancelReconnect();
    if (this.ws) {
      this.ws.onopen = null; this.ws.onmessage = null;
      this.ws.onclose = null; this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private onSocketClose(): void {
    this.setStatus('disconnected' as S);
    this.stopPing();
    this.handleClose();
    if (this.shouldReconnect() && this.reconnectTimer === null) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.backoff = Math.min(this.backoff * 2, this.backoffMax);
        this.openSocket();
      }, this.backoff);
    }
  }

  protected cancelReconnect(): void {
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  // ── Send helpers ─────────────────────────────────────────────────────────────

  /** JSON-encode and send when the socket is OPEN; a no-op otherwise. */
  protected rawSend(obj: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  // ── Heartbeat ────────────────────────────────────────────────────────────────

  protected startPing(): void {
    if (this.pingTimer !== null || this.pingMs <= 0) return;
    this.pingTimer = setInterval(() => this.sendPing(), this.pingMs);
  }

  protected stopPing(): void {
    if (this.pingTimer !== null) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  // ── Template hooks (override in subclasses) ──────────────────────────────────

  /** Target WebSocket URL. */
  protected abstract url(): string;
  /** Called once the socket opens (subclass: auth / resubscribe / startPing / setStatus). */
  protected abstract handleOpen(): void;
  /** Decode a raw text frame and dispatch to listeners. */
  protected abstract handleMessage(raw: string): void;
  /** Send a subscribe frame for one channel (subclass gates on its own readiness). */
  protected abstract sendSubscribe(channel: string): void;
  /** Send an unsubscribe frame for one channel. */
  protected abstract sendUnsubscribe(channel: string): void;

  /** May we open a socket right now? (e.g. private waits for credentials.) Default: yes. */
  protected canConnect(): boolean { return true; }
  /** Auto-reconnect after an unexpected close? Default: yes. */
  protected shouldReconnect(): boolean { return true; }
  /** Runs on every close, before reconnect is scheduled. Default: no-op. */
  protected handleClose(): void { /* override */ }
  /** Runs right after status flips to 'connecting'. Default: no-op. */
  protected onConnecting(): void { /* override */ }
  /** First listener for a channel — default sends the subscribe frame. */
  protected onFirstSubscribe(channel: string): void { this.sendSubscribe(channel); }
  /** Last listener for a channel gone — default sends the unsubscribe frame. */
  protected onLastUnsubscribe(channel: string): void { this.sendUnsubscribe(channel); }
  /** Heartbeat frame. Default: Bybit-style `{ op: 'ping' }`. */
  protected sendPing(): void { this.rawSend({ op: 'ping' }); }
}
