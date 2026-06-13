// 同时同步到后端，清缓存不丢。
import type { Coin } from '../../features/monitor/types';
import { DERIBIT_CACHE, HIST_CACHE } from './deribit';
import { FLOW_CACHE } from './flow';
import { TICKER_CACHE, type RawOptionTrade } from './ws';
import { get as apiGet, put as apiPut } from '../../api';

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
  apiPut('/api/watchlist', [...WATCHLIST_SET]).catch(() => {});
}

export const WATCHLIST_SET = loadWatchlist();

export async function hydrateWatchlistFromBackend(): Promise<void> {
  try {
    const remote = await apiGet<string[]>('/api/watchlist');
    if (!Array.isArray(remote)) return;
    let changed = false;
    for (const inst of remote) {
      if (typeof inst !== 'string' || WATCHLIST_SET.has(inst)) continue;
      WATCHLIST_SET.add(inst);
      changed = true;
    }
    if (changed) {
      try { localStorage.setItem('ww_watchlist', JSON.stringify([...WATCHLIST_SET])); } catch { /* ignore */ }
    }
  } catch {
    /* backend is optional */
  }
}

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
  apiPut('/api/positions', POS_STORE).catch(() => {});
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

export async function hydratePositionsFromBackend(): Promise<void> {
  try {
    const remote = await apiGet<UserPosition[]>('/api/positions');
    if (!Array.isArray(remote)) return;
    const ids = new Set(POS_STORE.map(p => p.id));
    let changed = false;
    for (const p of remote) {
      if (!p?.id || ids.has(p.id)) continue;
      POS_STORE.push(p);
      ids.add(p.id);
      changed = true;
    }
    if (!changed) return;
    try { localStorage.setItem('ww_positions', JSON.stringify(POS_STORE)); } catch { /* ignore */ }
    _notifyPositions();
  } catch {
    /* backend is optional */
  }
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

export type AlertMetric = 'spot' | 'dvol' | 'ivrank' | 'funding' | 'callflow' | 'putflow'
  | 'netDelta' | 'netVega';
export type AlertOp     = '>' | '<';
export type MetricTier  = 'live' | 'book' | 'foreground';

export interface UserAlert {
  id: string; coin: Coin; metric: AlertMetric; op: AlertOp;
  threshold: number; active: boolean; cooldownMs: number;
  triggered: boolean; lastValue: number | null; triggeredAt: number | null; lastNotifiedAt: number | null;
}

// 指标元数据 + 可靠性分级（单一事实来源，UI 据此打标）：
//  live       Spot / DVOL —— 全局 WebSocket 常驻，后台标签页也判定并推送
//  book       净Delta / 净Vega —— 账户页同步的持仓 + 实时现价，每 4s 评估
//  foreground IV / 资金费率 / 资金流 —— 仅监控页打开、缓存新鲜时评估，离页可能漏触发
export const METRIC_META: Record<AlertMetric, { label: string; unit: string; defaultVal: number; tier: MetricTier }> = {
  spot:      { label: 'Spot 价格',     unit: '$',    defaultVal: 90000, tier: 'live' },
  dvol:      { label: 'DVOL',          unit: '%',    defaultVal: 60,    tier: 'live' },
  ivrank:    { label: 'IV 百分位',     unit: '%ile', defaultVal: 80,    tier: 'foreground' },
  funding:   { label: '年化资金费率',  unit: '%',    defaultVal: 50,    tier: 'foreground' },
  callflow:  { label: 'Call 净流向',   unit: 'K$',   defaultVal: 1000,  tier: 'foreground' },
  putflow:   { label: 'Put 净流向',    unit: 'K$',   defaultVal: -500,  tier: 'foreground' },
  netDelta:  { label: '持仓净$Delta',   unit: '$',    defaultVal: 50000, tier: 'book' },
  netVega:   { label: '持仓净$Vega/1%', unit: '$',    defaultVal: -2000, tier: 'book' },
};

const ALERT_HISTORY_KEY = 'ww_alert_history';
export const DEFAULT_ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const ALERT_HISTORY_LIMIT = 100;

function normalizeAlert(a: Partial<UserAlert> & Pick<UserAlert, 'id' | 'coin' | 'metric' | 'op' | 'threshold' | 'active'>): UserAlert {
  return {
    ...a,
    cooldownMs: typeof a.cooldownMs === 'number' ? a.cooldownMs : DEFAULT_ALERT_COOLDOWN_MS,
    triggered: false,
    lastValue: null,
    triggeredAt: null,
    lastNotifiedAt: typeof a.lastNotifiedAt === 'number' ? a.lastNotifiedAt : null,
  };
}

export function loadAlerts(): UserAlert[] {
  try {
    const raw = localStorage.getItem('ww_alerts');
    if (!raw) return [];
    return (JSON.parse(raw) as UserAlert[]).filter(a => a && a.metric in METRIC_META).map(a => normalizeAlert(a));
  } catch { return []; }
}

export function saveAlerts(): void {
  try {
    const toStore = ALERTS_STORE.map(({ id, coin, metric, op, threshold, active, cooldownMs, lastNotifiedAt }) =>
      ({ id, coin, metric, op, threshold, active, cooldownMs, lastNotifiedAt })
    );
    localStorage.setItem('ww_alerts', JSON.stringify(toStore));
  } catch { /* ignore */ }
  apiPut('/api/alerts', ALERTS_STORE.map(({ id, coin, metric, op, threshold, active, cooldownMs, lastNotifiedAt }) =>
    ({ id, coin, metric, op, threshold, active, cooldownMs, lastNotifiedAt })
  )).catch(() => {});
}

export const ALERTS_STORE: UserAlert[] = loadAlerts();

export async function hydrateAlertsFromBackend(): Promise<void> {
  try {
    const remote = await apiGet<UserAlert[]>('/api/alerts');
    if (!Array.isArray(remote)) return;
    const ids = new Set(ALERTS_STORE.map(a => a.id));
    let changed = false;
    for (const a of remote) {
      if (!a?.id || ids.has(a.id) || !(a.metric in METRIC_META)) continue;
      ALERTS_STORE.push(normalizeAlert(a));
      ids.add(a.id);
      changed = true;
    }
    if (!changed) return;
    try {
      localStorage.setItem('ww_alerts', JSON.stringify(ALERTS_STORE.map(({ id, coin, metric, op, threshold, active, cooldownMs, lastNotifiedAt }) =>
        ({ id, coin, metric, op, threshold, active, cooldownMs, lastNotifiedAt })
      )));
    } catch { /* ignore */ }
    _notifyAlerts();
  } catch {
    /* backend is optional */
  }
}

// liveOverrides：全局引擎传入的 WS 实时值（spot/dvol），覆盖可能已过期的缓存值，
// 使告警在离开监控页时仍能基于实时行情触发。
export function evalAlerts(coin: Coin, liveOverrides?: Partial<Record<AlertMetric, number>>): void {
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
  if (liveOverrides) {
    for (const k of Object.keys(liveOverrides) as AlertMetric[]) {
      const ov = liveOverrides[k];
      if (typeof ov === 'number' && !Number.isNaN(ov)) vals[k] = ov;
    }
  }

  for (const a of ALERTS_STORE) {
    if (!a.active || a.coin !== coin) continue;
    const v = vals[a.metric];
    if (v === undefined) continue;
    const firstSeen = a.lastValue === null;   // 本次会话首次拿到该指标：只建立基线，不为「已在条件内」误报
    const prev = a.triggered;
    a.lastValue = v;
    a.triggered = a.op === '>' ? v > a.threshold : v < a.threshold;
    // 仅在「穿越」阈值的上升沿提醒一次；条件回到另一侧后自动重新武装。
    // cooldown 退化为抖动防护：阈值附近反复穿越时限制最小提醒间隔。
    if (a.triggered && !prev && !firstSeen) {
      const now = Date.now();
      a.triggeredAt = now;
      if (a.lastNotifiedAt == null || now - a.lastNotifiedAt >= a.cooldownMs) {
        a.lastNotifiedAt = now;
        saveAlerts();
        emitAlertTrigger({ id: a.id, coin: a.coin, metric: a.metric, op: a.op, threshold: a.threshold, value: v, at: now });
      }
    }
  }
}

// ── Alert CRUD + pub/sub（「告警中心」页与全局引擎共用 canonical store）──────────
const _alertListeners = new Set<() => void>();
export function subscribeAlerts(fn: () => void): () => void {
  _alertListeners.add(fn);
  return () => { _alertListeners.delete(fn); };
}
function _notifyAlerts(): void { _alertListeners.forEach(f => f()); }

export function addAlert(a: Pick<UserAlert, 'coin' | 'metric' | 'op' | 'threshold'> & Partial<Pick<UserAlert, 'cooldownMs'>>): void {
  ALERTS_STORE.push(normalizeAlert({
    ...a,
    id: `al_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    active: true,
  }));
  saveAlerts(); _notifyAlerts();
}
export function removeAlert(id: string): void {
  const i = ALERTS_STORE.findIndex(a => a.id === id);
  if (i >= 0) { ALERTS_STORE.splice(i, 1); saveAlerts(); _notifyAlerts(); }
}
export function toggleAlert(id: string): void {
  const a = ALERTS_STORE.find(x => x.id === id);
  if (a) { a.active = !a.active; a.triggered = false; a.lastValue = null; saveAlerts(); _notifyAlerts(); }
}

// ── 触发事件总线（供 UI toast 订阅）──────────────────────────────────────────
export interface AlertTriggerEvent {
  id: string; coin: Coin; metric: AlertMetric; op: AlertOp; threshold: number; value: number; at: number;
}
export interface AlertHistoryItem extends AlertTriggerEvent {
  eventId: string;
}
export function loadAlertHistory(): AlertHistoryItem[] {
  try {
    const raw = localStorage.getItem(ALERT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AlertHistoryItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
const _historyListeners = new Set<() => void>();
export function subscribeAlertHistory(fn: () => void): () => void {
  _historyListeners.add(fn);
  return () => { _historyListeners.delete(fn); };
}
function _notifyAlertHistory(): void { _historyListeners.forEach(f => f()); }
function saveAlertHistory(items: AlertHistoryItem[]): void {
  try { localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify(items.slice(0, ALERT_HISTORY_LIMIT))); } catch { /* ignore */ }
}
export function clearAlertHistory(): void {
  saveAlertHistory([]);
  _notifyAlertHistory();
}
function recordAlertHistory(e: AlertTriggerEvent): void {
  const next = [{ ...e, eventId: `ah_${e.at}_${Math.random().toString(36).slice(2, 7)}` }, ...loadAlertHistory()].slice(0, ALERT_HISTORY_LIMIT);
  saveAlertHistory(next);
  _notifyAlertHistory();
}
const _triggerListeners = new Set<(e: AlertTriggerEvent) => void>();
export function subscribeAlertTriggers(fn: (e: AlertTriggerEvent) => void): () => void {
  _triggerListeners.add(fn);
  return () => { _triggerListeners.delete(fn); };
}
export function emitAlertTrigger(e: AlertTriggerEvent): void {
  recordAlertHistory(e);
  _triggerListeners.forEach(f => f(e));
}
