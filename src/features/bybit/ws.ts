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
//
// Shared plumbing (status / subs ref-counting / reconnect / ping) lives in BaseWS;
// this file only adds the auth handshake + unlock-gated connect.
// ═══════════════════════════════════════════════════════════════════════════════

import { getCredentials, isUnlocked, subscribeAuthState } from './auth';
import { hmacSha256Hex } from './crypto';
import { BaseWS, type WsStatus } from '../../lib/baseWs';

const PROXY_PATH = '/bybit-ws';
const AUTH_EXPIRES_MS = 10_000;
const PING_MS = 20_000;

class BybitPrivateWS extends BaseWS<WsStatus | 'auth'> {
  private authed = false;
  private wantConnected = false;

  constructor() {
    super({ pingMs: PING_MS });
  }

  // ── public API ────────────────────────────────────────────────────────────

  connect(): void {
    this.wantConnected = true;
    this.openSocket();
  }

  disconnect(): void {
    this.wantConnected = false;
    this.authed = false;
    this.closeSocket();
  }

  // ── template hooks ──────────────────────────────────────────────────────────

  protected url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}${PROXY_PATH}`;
  }

  /** Only open the socket once credentials are unlocked. */
  protected canConnect(): boolean { return isUnlocked(); }

  /** Keep reconnecting only while a consumer still wants the connection. */
  protected shouldReconnect(): boolean { return this.wantConnected; }

  protected handleOpen(): void { void this.authenticate(); }

  private async authenticate(): Promise<void> {
    const creds = getCredentials();
    if (!creds || !this.ws) return;
    const expires = (Date.now() + AUTH_EXPIRES_MS).toString();
    const sig = await hmacSha256Hex(creds.secret, `GET/realtime${expires}`);
    this.rawSend({ op: 'auth', args: [creds.apiKey, expires, sig] });
  }

  protected handleMessage(raw: string): void {
    let msg: { op?: string; success?: boolean; topic?: string; data?: unknown };
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.op === 'auth') {
      if (msg.success) {
        this.authed = true;
        this.setStatus('connected');
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
    if (msg.topic) this.dispatch(msg.topic, msg.data);
  }

  protected handleClose(): void { this.authed = false; }

  protected sendSubscribe(topic: string): void {
    if (this.authed) this.rawSend({ op: 'subscribe', args: [topic] });
  }
  protected sendUnsubscribe(topic: string): void {
    if (this.authed) this.rawSend({ op: 'unsubscribe', args: [topic] });
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
