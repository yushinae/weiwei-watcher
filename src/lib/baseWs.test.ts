import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseWS } from './baseWs';

// ── Mock WebSocket ────────────────────────────────────────────────────────────
// Minimal stand-in: records sent frames, exposes _open()/_emit()/close() so tests
// can drive the socket lifecycle deterministically.

class MockWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) { this.url = url; MockWebSocket.instances.push(this); }
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  addEventListener() { /* unused */ }
  removeEventListener() { /* unused */ }

  _open() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
  _emit(data: string) { this.onmessage?.({ data }); }
  get last() { return MockWebSocket.instances[MockWebSocket.instances.length - 1]; }
}

// ── Concrete subclass (lazy-connect, like the public Bybit option client) ──────

class TestWS extends BaseWS {
  firstSubs: string[] = [];
  lastUnsubs: string[] = [];
  opens = 0;

  constructor() { super({ backoffMin: 1_000, backoffMax: 4_000, pingMs: 5_000 }); }

  protected url() { return 'ws://test'; }
  protected handleOpen() { this.opens++; this.setStatus('connected'); this.startPing(); this.resubscribeAll(); }
  protected handleMessage(raw: string) {
    const m = JSON.parse(raw) as { channel: string; data: unknown };
    this.dispatch(m.channel, m.data);
  }
  protected onFirstSubscribe(ch: string) { this.firstSubs.push(ch); this.openSocket(); this.sendSubscribe(ch); }
  protected onLastUnsubscribe(ch: string) { this.lastUnsubs.push(ch); this.sendUnsubscribe(ch); }
  protected sendSubscribe(ch: string) { this.rawSend({ sub: ch }); }
  protected sendUnsubscribe(ch: string) { this.rawSend({ unsub: ch }); }
  protected shouldReconnect() { return this.subs.size > 0; }
}

const sockets = () => MockWebSocket.instances;
const latest = () => sockets()[sockets().length - 1];

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BaseWS status', () => {
  it('replays current status on subscribe and dedups repeats', () => {
    const ws = new TestWS();
    const seen: string[] = [];
    ws.subscribeStatus(s => seen.push(s));
    expect(seen).toEqual(['disconnected']);     // immediate replay

    ws.subscribe('a', () => {});                // → openSocket → 'connecting'
    expect(seen).toEqual(['disconnected', 'connecting']);

    latest()._open();                           // handleOpen → 'connected'
    expect(seen).toEqual(['disconnected', 'connecting', 'connected']);

    // A second subscribe must NOT re-emit a status (already connected).
    ws.subscribe('b', () => {});
    expect(seen).toEqual(['disconnected', 'connecting', 'connected']);
  });

  it('stops notifying after unsubscribeStatus', () => {
    const ws = new TestWS();
    const seen: string[] = [];
    const off = ws.subscribeStatus(s => seen.push(s));
    off();
    ws.subscribe('a', () => {});
    expect(seen).toEqual(['disconnected']);     // nothing after off()
  });
});

describe('BaseWS subscriptions (ref-counting)', () => {
  it('opens + subscribes once per channel, unsubscribes only when last listener leaves', () => {
    const ws = new TestWS();
    const off1 = ws.subscribe('chan', () => {});
    const off2 = ws.subscribe('chan', () => {});
    expect(ws.firstSubs).toEqual(['chan']);     // first listener only
    expect(sockets()).toHaveLength(1);          // one socket opened (lazy)

    off1();
    expect(ws.lastUnsubs).toEqual([]);          // still one listener left
    off2();
    expect(ws.lastUnsubs).toEqual(['chan']);    // last listener gone
  });

  it('dispatches payloads to all listeners of a channel', () => {
    const ws = new TestWS();
    const a = vi.fn(); const b = vi.fn();
    ws.subscribe('chan', a);
    ws.subscribe('chan', b);
    latest()._open();
    latest()._emit(JSON.stringify({ channel: 'chan', data: { x: 1 } }));
    expect(a).toHaveBeenCalledWith({ x: 1 });
    expect(b).toHaveBeenCalledWith({ x: 1 });
  });

  it('flushes queued subscribe frames once the socket opens (resubscribeAll)', () => {
    const ws = new TestWS();
    ws.subscribe('a', () => {});
    ws.subscribe('b', () => {});
    // Not open yet → rawSend is a no-op, nothing sent.
    expect(latest().sent).toEqual([]);
    latest()._open();                           // handleOpen → resubscribeAll
    expect(latest().sent).toEqual([{ sub: 'a' }, { sub: 'b' }]);
  });
});

describe('BaseWS reconnect + ping', () => {
  it('reconnects after an unexpected close while channels remain', () => {
    const ws = new TestWS();
    ws.subscribe('a', () => {});
    latest()._open();
    expect(sockets()).toHaveLength(1);

    latest().close();                           // unexpected drop
    vi.advanceTimersByTime(1_000);              // backoffMin
    expect(sockets()).toHaveLength(2);          // a fresh socket was created
  });

  it('does NOT reconnect when no channels are left', () => {
    const ws = new TestWS();
    const off = ws.subscribe('a', () => {});
    latest()._open();
    off();                                       // subs now empty
    latest().close();
    vi.advanceTimersByTime(10_000);
    expect(sockets()).toHaveLength(1);          // no reconnect
  });

  it('sends a ping on the heartbeat interval', () => {
    const ws = new TestWS();
    ws.subscribe('a', () => {});
    latest()._open();
    const before = latest().sent.length;
    vi.advanceTimersByTime(5_000);              // pingMs
    expect(latest().sent.slice(before)).toEqual([{ op: 'ping' }]); // default ping frame
  });
});
