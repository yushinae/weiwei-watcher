// ═══════════════════════════════════════════════════════════════════════════════
// Public Bybit OPTION WebSocket — no auth needed.
//
// Endpoint: wss://stream.bybit.com/v5/public/option
// Subscribe: { op: 'subscribe', args: ['tickers.BTC-26DEC25-100000-C-USDT', ...] }
// Push:      { topic: 'tickers.{symbol}', type: 'snapshot'|'delta', data: {...} }
//
// (The app's other Bybit WS, BYBIT_PRIVATE_WS, is auth-gated for positions — this
//  is a separate public client for live option tickers.)
// ═══════════════════════════════════════════════════════════════════════════════

type Listener = (data: Record<string, unknown>) => void;

const URL = 'wss://stream.bybit.com/v5/public/option';
const PING_MS = 20_000;
const RECONNECT_MS = 3_000;
const BATCH = 10; // Bybit caps args per subscribe frame

class BybitOptionWS {
  private ws: WebSocket | null = null;
  private subs = new Map<string, Set<Listener>>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private open = false;

  private send(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private batch(op: 'subscribe' | 'unsubscribe', topics: string[]) {
    for (let i = 0; i < topics.length; i += BATCH) this.send({ op, args: topics.slice(i, i + BATCH) });
  }

  private ensure() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const ws = new WebSocket(URL);
    this.ws = ws;
    ws.onopen = () => {
      this.open = true;
      this.batch('subscribe', [...this.subs.keys()]);
      this.pingTimer = setInterval(() => this.send({ op: 'ping' }), PING_MS);
    };
    ws.onmessage = (ev) => {
      let msg: { topic?: string; data?: Record<string, unknown>; op?: string };
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      if (msg.op) return; // pong / subscribe ack
      if (msg.topic && msg.data) this.subs.get(msg.topic)?.forEach(fn => fn(msg.data!));
    };
    ws.onclose = () => {
      this.open = false;
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      if (this.subs.size > 0 && !this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.ensure(); }, RECONNECT_MS);
      }
    };
    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
  }

  subscribe(topic: string, cb: Listener): () => void {
    if (!this.subs.has(topic)) {
      this.subs.set(topic, new Set());
      this.ensure();
      if (this.open) this.send({ op: 'subscribe', args: [topic] });
    }
    this.subs.get(topic)!.add(cb);
    return () => {
      const set = this.subs.get(topic);
      if (!set) return;
      set.delete(cb);
      if (set.size === 0) {
        this.subs.delete(topic);
        if (this.open) this.send({ op: 'unsubscribe', args: [topic] });
      }
    };
  }
}

export const BYBIT_OPTION_WS = new BybitOptionWS();
