// ═══════════════════════════════════════════════════════════════════════════════
// Bybit V5 Private WebSocket — singleton, connects when credentials unlock.
//
// Auth handshake (V5):
//   1. WS opens
//   2. Client sends { op: 'auth', args: [apiKey, expires, signature] }
//      where signature = HMAC_SHA256(secret, "GET/realtime" + expires)
//   3. After auth success, send { op: 'subscribe', args: [topic, ...] }
//   4. Server pushes { topic, data, ... }
//   5. Client must send { op: 'ping' } every 20s to keep alive
//
// All traffic goes through /bybit-ws Vite proxy → wss://stream.bybit.com/v5/private
// ═══════════════════════════════════════════════════════════════════════════════

import { getCredentials, isUnlocked, subscribeAuthState } from './auth';
import { hmacSha256Hex } from './crypto';

const PROXY_PATH = '/bybit-ws';
const AUTH_EXPIRES_MS = 10_000;
const PING_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;

type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'auth';

type Listener<T = unknown> = (data: T) => void;

class BybitPrivateWS {
  private ws: WebSocket | null = null;
  private subs = new Map<string, Set<Listener>>();
  private authed = false;
  private wantConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private backoff = 1_000;
  private _status: WsStatus = 'disconnected';
  private _statusListeners = new Set<(s: WsStatus) => void>();

  // ── public API ────────────────────────────────────────────────────────────

  subscribeStatus(cb: (s: WsStatus) => void): () => void {
    this._statusListeners.add(cb);
    cb(this._status);
    return () => { this._statusListeners.delete(cb); };
  }

  connect(): void {
    this.wantConnected = true;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;
    if (!isUnlocked()) return;

    this._setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}${PROXY_PATH}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen    = () => this.onOpen();
    ws.onmessage = (e) => this.onMessage(e);
    ws.onclose   = () => this.onClose();
    ws.onerror   = () => ws.close();
  }

  disconnect(): void {
    this._setStatus('disconnected');
    this.wantConnected = false;
    this.authed = false;
    this.stopPing();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) {
      this.ws.onopen = null; this.ws.onmessage = null;
      this.ws.onclose = null; this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }

  subscribe<T>(topic: string, cb: Listener<T>): () => void {
    if (!this.subs.has(topic)) {
      this.subs.set(topic, new Set());
      if (this.authed) this.send({ op: 'subscribe', args: [topic] });
    }
    this.subs.get(topic)!.add(cb as Listener);
    return () => {
      const set = this.subs.get(topic);
      if (!set) return;
      set.delete(cb as Listener);
      if (set.size === 0) {
        this.subs.delete(topic);
        if (this.authed) this.send({ op: 'unsubscribe', args: [topic] });
      }
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private _setStatus(s: WsStatus): void {
    this._status = s;
    this._statusListeners.forEach(fn => fn(s));
  }

  private async onOpen(): Promise<void> {
    const creds = getCredentials();
    if (!creds || !this.ws) return;
    this.backoff = 1_000;
    const expires = (Date.now() + AUTH_EXPIRES_MS).toString();
    const sig = await hmacSha256Hex(creds.secret, `GET/realtime${expires}`);
    this.send({ op: 'auth', args: [creds.apiKey, expires, sig] });
  }

  private onMessage(evt: MessageEvent): void {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.op === 'auth') {
        if (msg.success) {
          this._setStatus('connected');
          this.authed = true;
          this.startPing();
          this.resubscribeAll();
        } else {
          // Bad auth → disconnect and don't auto-reconnect (key probably wrong/expired)
          this.wantConnected = false;
          this.ws?.close();
        }
        return;
      }
      if (msg.op === 'subscribe' || msg.op === 'unsubscribe' || msg.op === 'pong') return;
      if (msg.topic) {
        this.subs.get(msg.topic)?.forEach(fn => fn(msg.data));
      }
    } catch { /* ignore parse errors */ }
  }

  private onClose(): void {
    this._setStatus('disconnected');
    this.authed = false;
    this.stopPing();
    if (this.wantConnected && this.reconnectTimer === null) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
        this.connect();
      }, this.backoff);
    }
  }

  private send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  private resubscribeAll(): void {
    for (const topic of this.subs.keys()) {
      this.send({ op: 'subscribe', args: [topic] });
    }
  }

  private startPing(): void {
    if (this.pingTimer !== null) return;
    this.pingTimer = setInterval(() => this.send({ op: 'ping' }), PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }
}

export const BYBIT_PRIVATE_WS = new BybitPrivateWS();

// Auto-connect on unlock, disconnect on lock or credential clear.
subscribeAuthState(() => {
  if (isUnlocked()) BYBIT_PRIVATE_WS.connect();
  else BYBIT_PRIVATE_WS.disconnect();
});
// If credentials are already unlocked when this module first loads, connect now.
if (isUnlocked()) BYBIT_PRIVATE_WS.connect();
