// ═══════════════════════════════════════════════════════════════════════════════
// Public Bybit OPTION WebSocket — no auth needed.
//
// Connects via the /bybit-ws-option Vite proxy → wss://stream.bybit.com/v5/public/option
// (consistent with the Deribit WS). Falls back to a direct connection if the proxy
// isn't reachable (e.g. a build without a reverse proxy), so it works everywhere.
//
// Subscribe: { op: 'subscribe', args: ['tickers.BTC-26DEC25-100000-C-USDT', ...] }
// Push:      { topic: 'tickers.{symbol}', type: 'snapshot'|'delta', data: {...} }
//
// (The app's other Bybit WS, BYBIT_PRIVATE_WS, is auth-gated for positions — this
//  is a separate public client for live option tickers.)
//
// Shared plumbing (status / subs ref-counting / reconnect / ping) lives in BaseWS;
// this file only adds the public-option protocol + lazy connect + proxy→direct fallback.
// ═══════════════════════════════════════════════════════════════════════════════

import { BaseWS } from '../../lib/baseWs';

const PROXY_PATH = '/bybit-ws-option';
const DIRECT_URL = 'wss://stream.bybit.com/v5/public/option';
const RECONNECT_MS = 3_000;
const BATCH = 10; // Bybit caps args per subscribe frame

class BybitOptionWS extends BaseWS {
  private useDirect = false;       // flip to direct after a failed proxy attempt
  private attemptOpened = false;   // did the current socket ever open?

  constructor() {
    super({ backoffMin: RECONNECT_MS, backoffMax: RECONNECT_MS, pingMs: 20_000 });
  }

  protected url(): string {
    if (this.useDirect) return DIRECT_URL;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}${PROXY_PATH}`;
  }

  private batchOp(op: 'subscribe' | 'unsubscribe', topics: string[]) {
    for (let i = 0; i < topics.length; i += BATCH) this.rawSend({ op, args: topics.slice(i, i + BATCH) });
  }

  protected onConnecting(): void {
    this.attemptOpened = false;
  }

  protected handleOpen(): void {
    this.attemptOpened = true;
    this.setStatus('connected');
    this.batchOp('subscribe', [...this.subs.keys()]);
    this.startPing();
  }

  protected handleMessage(raw: string): void {
    let msg: { topic?: string; data?: Record<string, unknown>; op?: string };
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.op) return; // pong / subscribe ack
    if (msg.topic && msg.data) this.dispatch(msg.topic, msg.data);
  }

  // Lazy connect: the first listener for a topic opens the socket.
  protected onFirstSubscribe(topic: string): void {
    this.openSocket();
    this.sendSubscribe(topic);
  }

  protected sendSubscribe(topic: string): void { this.rawSend({ op: 'subscribe', args: [topic] }); }
  protected sendUnsubscribe(topic: string): void { this.rawSend({ op: 'unsubscribe', args: [topic] }); }

  protected onLastUnsubscribe(topic: string): void {
    super.onLastUnsubscribe(topic);
    if (this.subs.size === 0) this.disconnect();
  }

  disconnect(): void { this.closeSocket(); }

  // Only keep reconnecting while something is still listening.
  protected shouldReconnect(): boolean { return this.subs.size > 0; }

  // If the proxy attempt never opened, fall back to a direct connection.
  protected handleClose(): void {
    if (!this.attemptOpened && !this.useDirect) this.useDirect = true;
  }
}

export const BYBIT_OPTION_WS = new BybitOptionWS();
