import type { Coin } from '../../features/monitor/types';
import { DERIBIT_CACHE, HIST_CACHE, type DeribitData, type HistoryData } from './deribit';
import { FLOW_CACHE, type FlowData } from './flow';
import { TICKER_CACHE, type TickerSnapshot, type RawOptionTrade } from './ws';

// ═══════════════════════════════════════════════════════════════════════════════
// Premium flow accumulators
// ═══════════════════════════════════════════════════════════════════════════════

export interface PFlowAcc { cumCallNet: number; cumPutNet: number }
export const PFLOW_ACC    = new Map<string, PFlowAcc>();
export const PFLOW_SERIES = new Map<string, { ts: number; c: number; p: number }[]>();
export const PFLOW_LAST   = new Map<string, string>();

export function processPremiumFlow(coin: Coin, trades: RawOptionTrade[]): void {
  if (!PFLOW_ACC.has(coin)) PFLOW_ACC.set(coin, { cumCallNet: 0, cumPutNet: 0 });
  if (!PFLOW_SERIES.has(coin)) PFLOW_SERIES.set(coin, []);

  const acc = PFLOW_ACC.get(coin)!;
  const buf = PFLOW_SERIES.get(coin)!;
  const lastId = PFLOW_LAST.get(coin);

  const lastIdx = lastId ? trades.findIndex(t => t.id === lastId) : trades.length;
  const unprocessed = trades.slice(0, lastIdx).reverse();

  if (unprocessed.length === 0) return;
  for (const t of unprocessed) {
    const sign = t.direction === 'buy' ? 1 : -1;
    if (t.optType === 'C') acc.cumCallNet += sign * t.premiumUSD;
    else                    acc.cumPutNet  += sign * t.premiumUSD;
  }
  buf.push({ ts: Date.now(), c: acc.cumCallNet, p: acc.cumPutNet });
  if (buf.length > 360) buf.splice(0, buf.length - 360);
  PFLOW_LAST.set(coin, trades[0]?.id ?? lastId ?? '');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Large trade buffer
// ═══════════════════════════════════════════════════════════════════════════════

export const LARGE_BUF = new Map<string, RawOptionTrade[]>();
export const LARGE_SEEN_IDS = new Map<string, Set<string>>();

export function processLargeTrades(coin: Coin, trades: RawOptionTrade[], minUSD: number): void {
  if (!LARGE_SEEN_IDS.has(coin)) LARGE_SEEN_IDS.set(coin, new Set());
  const seen = LARGE_SEEN_IDS.get(coin)!;
  const buf  = LARGE_BUF.get(coin) ?? [];
  let dirty  = false;
  for (const t of trades) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (t.notionalUSD >= minUSD) { buf.unshift(t); dirty = true; }
  }
  if (dirty) {
    if (buf.length > 200) buf.splice(200);
    LARGE_BUF.set(coin, buf);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Watchlist persistence
// ═══════════════════════════════════════════════════════════════════════════════

export interface WatchItem {
  instrument: string; bid: number; ask: number;
  iv: number; delta: number; mark: number;
  oi: number; oiDelta: number; ts: number;
}

export const WATCH_OI_SNAP = new Map<string, number>();
export const WATCH_CACHE  = new Map<string, WatchItem>();

export function loadWatchlist(): Set<string> {
  try {
    const raw = localStorage.getItem('ww_watchlist');
    return raw ? new Set<string>(JSON.parse(raw) as string[]) : new Set<string>();
  } catch { return new Set<string>(); }
}

export function saveWatchlist(): void {
  try { localStorage.setItem('ww_watchlist', JSON.stringify([...WATCHLIST_SET])); } catch { /* ignore */ }
}

export const WATCHLIST_SET = loadWatchlist();

// ═══════════════════════════════════════════════════════════════════════════════
// Position tracker
// ═══════════════════════════════════════════════════════════════════════════════

export interface UserPosition {
  id: string;
  instrument: string;
  qty: number;
}

export interface LivePosition extends UserPosition {
  mark: number; iv: number;
  delta: number; gamma: number; vega: number; theta: number;
  dollarDelta: number; dollarGamma: number; dollarVega: number; dollarTheta: number;
  spot: number; error?: string;
}

export function loadPositions(): UserPosition[] {
  try {
    const raw = localStorage.getItem('ww_positions');
    return raw ? (JSON.parse(raw) as UserPosition[]) : [];
  } catch { return []; }
}

export function savePositions(): void {
  try { localStorage.setItem('ww_positions', JSON.stringify(POS_STORE)); } catch { /* ignore */ }
}

export const POS_STORE: UserPosition[] = loadPositions();

// ── POS_STORE pub/sub ──────────────────────────────────────────────────────
// Multiple widgets read POS_STORE (Tracker writes, Payoff reads). Mutating
// the array directly can't notify other readers, so use these helpers.
const _posListeners = new Set<() => void>();
function _notifyPositions(): void { _posListeners.forEach(fn => fn()); }
export function subscribePositions(fn: () => void): () => void {
  _posListeners.add(fn);
  return () => { _posListeners.delete(fn); };
}
export function addPosition(p: UserPosition): void {
  POS_STORE.push(p);
  savePositions();
  _notifyPositions();
}
export function removePositionById(id: string): void {
  const idx = POS_STORE.findIndex(p => p.id === id);
  if (idx < 0) return;
  POS_STORE.splice(idx, 1);
  savePositions();
  _notifyPositions();
}

export const POS_TICKER_CACHE = new Map<string, any>();

export function buildLiveFromCache(positions: UserPosition[]): LivePosition[] {
  return positions.map(pos => {
    const t = POS_TICKER_CACHE.get(pos.instrument);
    if (!t) return { ...pos, mark: 0, iv: 0, delta: 0, gamma: 0, vega: 0, theta: 0,
                     dollarDelta: 0, dollarGamma: 0, dollarVega: 0, dollarTheta: 0, spot: 0 };
    const spot: number = t.underlying_price ?? t.index_price ?? 1;
    const g = t.greeks ?? {};
    const delta: number = (g.delta ?? 0) * pos.qty;
    const gamma: number = (g.gamma ?? 0) * pos.qty;
    const vega:  number = (g.vega  ?? 0) * pos.qty;
    const theta: number = (g.theta ?? 0) * pos.qty;
    return { ...pos, mark: t.mark_price ?? 0, iv: t.mark_iv ?? 0,
             delta, gamma, vega, theta,
             dollarDelta: delta * spot, dollarGamma: gamma * spot * spot / 100,
             dollarVega: vega / 100, dollarTheta: theta * spot, spot };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Alerts system
// ═══════════════════════════════════════════════════════════════════════════════

export type AlertMetric = 'spot' | 'dvol' | 'ivrank' | 'funding' | 'sentiment' | 'callflow' | 'putflow';
export type AlertOp     = '>' | '<';

export interface UserAlert {
  id: string; coin: Coin; metric: AlertMetric; op: AlertOp;
  threshold: number; active: boolean;
  triggered: boolean; lastValue: number | null; triggeredAt: number | null;
}

export function loadAlerts(): UserAlert[] {
  try {
    const raw = localStorage.getItem('ww_alerts');
    if (!raw) return [];
    return (JSON.parse(raw) as UserAlert[]).map(a => ({
      ...a, triggered: false, lastValue: null, triggeredAt: null,
    }));
  } catch { return []; }
}

export function saveAlerts(): void {
  try {
    const toStore = ALERTS_STORE.map(({ id, coin, metric, op, threshold, active }) =>
      ({ id, coin, metric, op, threshold, active, triggered: false, lastValue: null, triggeredAt: null })
    );
    localStorage.setItem('ww_alerts', JSON.stringify(toStore));
  } catch { /* ignore */ }
}

export const ALERTS_STORE: UserAlert[] = loadAlerts();

export const METRIC_META: Record<AlertMetric, { label: string; unit: string; defaultVal: number }> = {
  spot:      { label: 'Spot 价格',    unit: '$',    defaultVal: 90000 },
  dvol:      { label: 'DVOL',         unit: '%',    defaultVal: 60    },
  ivrank:    { label: 'IV 百分位',    unit: '%ile', defaultVal: 80    },
  funding:   { label: '年化资金费率', unit: '%',    defaultVal: 50    },
  sentiment: { label: '情绪评分',     unit: 'pts',  defaultVal: 30    },
  callflow:  { label: 'Call 净流向',  unit: 'K$',   defaultVal: 1000  },
  putflow:   { label: 'Put 净流向',   unit: 'K$',   defaultVal: -500  },
};

export function evalAlerts(coin: Coin): void {
  const optC  = DERIBIT_CACHE.get(coin);
  const histC = HIST_CACHE.get(coin);
  const flowC = FLOW_CACHE.get(coin);
  const tickC = TICKER_CACHE.get(coin);
  const pflAc = PFLOW_ACC.get(coin);

  const vals: Partial<Record<AlertMetric, number>> = {};
  if (tickC)  { vals.spot = tickC.data.spot; vals.dvol = tickC.data.dvol; }
  else if (optC) { vals.spot = optC.data.spot; }
  if (histC)  vals.ivrank = histC.data.ivRankCurrent;
  if (flowC)  vals.funding = flowC.data.annFunding;
  if (pflAc)  { vals.callflow = pflAc.cumCallNet / 1000; vals.putflow = pflAc.cumPutNet / 1000; }

  for (const a of ALERTS_STORE) {
    if (!a.active || a.coin !== coin) continue;
    const v = vals[a.metric];
    if (v === undefined) continue;
    a.lastValue = v;
    const prev = a.triggered;
    a.triggered = a.op === '>' ? v > a.threshold : v < a.threshold;
    if (a.triggered && !prev) {
      a.triggeredAt = Date.now();
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const meta = METRIC_META[a.metric];
        new Notification(`${a.coin} 警报触发`, {
          body: `${meta.label} ${a.op} ${a.threshold}${meta.unit}  (当前: ${v.toFixed(2)}${meta.unit})`,
          icon: '/favicon.ico',
          tag: a.id,
        });
      }
    }
  }
}
