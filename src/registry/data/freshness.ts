// ═══════════════════════════════════════════════════════════════════════════════
// 数据新鲜度护栏 — 中央 store
//
// 目的：让数据层「自己说实话」。每个数据源在成功 / 失败 / 因失焦暂停 / 退回示例
// 数据时上报一次，UI 据此显示「实时 / N秒前 / 示例 / 失败」并算出全局健康度。
//
// 设计：
//   • 引擎无 UI 依赖；poller / BaseWS 自动埋点，widget 零改动接入。
//   • 「颜色」反映「是否在按预期刷新」（年龄 vs 预期间隔）；「数字」反映「多久没更新」。
//     —— 两者分开：300s 轮询的数据 4 分钟内是绿的（按预期），但徽章仍显示真实年龄。
//   • 一个共享 1s ticker 驱动年龄重算，订阅者随之重渲染。
// ═══════════════════════════════════════════════════════════════════════════════

export type FreshKind =
  | 'live'     // 实时 / 刚刷新（绿）
  | 'aging'    // 开始变旧，仍可用（黄）
  | 'stale'    // 太久没更新，别信（红）
  | 'error'    // 拉取失败 / 连接断开（红）
  | 'paused'   // 因窗口失焦/隐藏暂停了轮询（黄，会自动恢复）
  | 'sample'   // 显示的是示例/演示数据（灰）
  | 'loading'; // 还没拿到第一份数据（中性）

export interface FeedMeta {
  /** 人类可读名，用于总闸下拉，如「Deribit 期权 book」。 */
  label: string;
  /** 数据来源标签，如 'Deribit' / 'Bybit'。 */
  source?: string;
  /** 预期刷新间隔（ms）。年龄超过它的倍数就降级。poller 会自动传入轮询间隔。 */
  expectedMs: number;
  /** 是否计入顶栏「数据健康」总闸。后台/可选数据设 false 以免噪音。 */
  critical: boolean;
}

interface FeedState extends FeedMeta {
  key: string;
  lastOkAt: number | null;
  lastErrAt: number | null;
  lastError: string | null;
  sample: boolean;
  paused: boolean;
  /** 当前是否有活跃消费者（有订阅者 / WS 在用）。无人消费的 feed 不算「冻住」。 */
  active: boolean;
}

export interface Freshness {
  kind: FreshKind;
  /** 距上次成功更新的毫秒数；从未成功则为 null。 */
  ageMs: number | null;
  label: string;
  source?: string;
  error?: string | null;
}

// ── 已知 feed 目录（仅为漂亮的标签 + critical 标记；未知 key 自动登记） ──────────
// 注意：expectedMs 一般由 poller 用真实轮询间隔覆盖，这里给的是兜底。
const CATALOG: Record<string, Omit<FeedMeta, 'expectedMs'> & { expectedMs?: number }> = {
  'ws-deribit':        { label: 'Deribit 实时行情 (WS)', source: 'Deribit', critical: true, expectedMs: 8_000 },
  'options-BTC':       { label: 'BTC 期权 book',          source: 'Deribit', critical: true },
  'options-ETH':       { label: 'ETH 期权 book',          source: 'Deribit', critical: true },
  'option-chain-BTC':  { label: 'BTC 期权链',             source: 'Bybit',   critical: true },
  'option-chain-ETH':  { label: 'ETH 期权链',             source: 'Bybit',   critical: true },
  'flow-BTC':          { label: 'BTC 资金流 / 大单',       source: 'Deribit', critical: false },
  'flow-ETH':          { label: 'ETH 资金流 / 大单',       source: 'Deribit', critical: false },
  'history-BTC':       { label: 'BTC 历史波动',            source: 'Deribit', critical: false },
  'history-ETH':       { label: 'ETH 历史波动',            source: 'Deribit', critical: false },
  'sentiment-BTC':     { label: 'BTC 情绪指数',            source: 'Deribit', critical: false },
  'sentiment-ETH':     { label: 'ETH 情绪指数',            source: 'Deribit', critical: false },
};

const FEEDS = new Map<string, FeedState>();
const listeners = new Set<() => void>();

let _tickTimer: ReturnType<typeof setInterval> | null = null;

function notify(): void {
  listeners.forEach(fn => fn());
}

function startTicker(): void {
  if (_tickTimer != null) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  _tickTimer = setInterval(notify, 1_000);
}
function stopTicker(): void {
  if (_tickTimer != null) { clearInterval(_tickTimer); _tickTimer = null; }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTicker();
    else { startTicker(); notify(); }
  });
}

function ensure(key: string, expectedMs?: number): FeedState {
  let f = FEEDS.get(key);
  if (!f) {
    const cat = CATALOG[key];
    f = {
      key,
      label: cat?.label ?? key,
      source: cat?.source,
      expectedMs: expectedMs ?? cat?.expectedMs ?? 60_000,
      critical: cat?.critical ?? false,
      lastOkAt: null,
      lastErrAt: null,
      lastError: null,
      sample: false,
      paused: false,
      active: false,
    };
    FEEDS.set(key, f);
  } else if (expectedMs != null && f.expectedMs !== expectedMs) {
    f.expectedMs = expectedMs;
  }
  return f;
}

// ── 上报 API（数据层调用） ──────────────────────────────────────────────────────

/** 一次成功的拉取 / 一条 WS 消息。expectedMs 可选——poller 会传入真实间隔。 */
export function markOk(key: string, expectedMs?: number): void {
  const f = ensure(key, expectedMs);
  f.lastOkAt = Date.now();
  f.lastError = null;
  f.paused = false;
  f.sample = false;
  startTicker();
  notify();
}

/** 一次失败（CORS / 网络 / 解析 / WS 断开）。 */
export function markError(key: string, err: unknown): void {
  const f = ensure(key);
  f.lastErrAt = Date.now();
  f.lastError = err instanceof Error ? err.message : String(err ?? '未知错误');
  notify();
}

/** 该 feed 当前显示的是示例/演示数据（true）或恢复真实数据（false）。 */
export function markSample(key: string, on: boolean): void {
  const f = ensure(key);
  if (f.sample === on) return;
  f.sample = on;
  notify();
}

/** 轮询/连接因窗口失焦或隐藏被暂停（会自动恢复）。 */
export function markPaused(key: string, on: boolean): void {
  const f = ensure(key);
  if (f.paused === on) return;
  f.paused = on;
  notify();
}

/** 该 feed 当前是否有活跃消费者（poller 按订阅计数调用；WS 由 reporter 调用）。 */
export function setActive(key: string, on: boolean): void {
  const f = ensure(key);
  if (f.active === on) return;
  f.active = on;
  notify();
}

/** 批量标记所有已登记 feed 的暂停状态（供 poller 全局暂停/恢复使用）。 */
export function markAllPaused(on: boolean): void {
  let changed = false;
  FEEDS.forEach(f => { if (f.paused !== on) { f.paused = on; changed = true; } });
  if (changed) notify();
}

// ── 派生 / 读取 ────────────────────────────────────────────────────────────────

function computeKind(f: FeedState, now: number): FreshKind {
  if (f.sample) return 'sample';
  if (f.lastOkAt == null) {
    return f.lastErrAt != null ? 'error' : 'loading';
  }
  // 失败比上次成功更近 → 当前处于报错态
  if (f.lastErrAt != null && f.lastErrAt > f.lastOkAt) return 'error';
  if (f.paused) return 'paused';
  const age = now - f.lastOkAt;
  if (age <= f.expectedMs * 1.5) return 'live';
  if (age <= f.expectedMs * 5)   return 'aging';
  return 'stale';
}

function toFreshness(f: FeedState, now: number): Freshness {
  return {
    kind: computeKind(f, now),
    ageMs: f.lastOkAt == null ? null : now - f.lastOkAt,
    label: f.label,
    source: f.source,
    error: f.lastError,
  };
}

export function getFreshness(key: string): Freshness | null {
  const f = FEEDS.get(key);
  return f ? toFreshness(f, Date.now()) : null;
}

export interface FeedFreshness extends Freshness { key: string; critical: boolean; active: boolean; }

/** 所有已登记 feed 的当前状态快照（总闸下拉用）。 */
export function snapshotAll(): FeedFreshness[] {
  const now = Date.now();
  return [...FEEDS.values()].map(f => ({ key: f.key, critical: f.critical, active: f.active, ...toFreshness(f, now) }));
}

const KIND_SEVERITY: Record<FreshKind, number> = {
  live: 0, sample: 1, loading: 1, paused: 2, aging: 2, stale: 3, error: 3,
};

export type HealthLevel = 'ok' | 'warn' | 'down';

/** 全局健康度 = 所有 critical feed 中最差的一档。 */
export function globalHealth(): { level: HealthLevel; worst: FeedFreshness | null; degraded: FeedFreshness[] } {
  const now = Date.now();
  let worst: FeedFreshness | null = null;
  let worstSev = -1;
  const degraded: FeedFreshness[] = [];
  FEEDS.forEach(f => {
    if (!f.critical || !f.active) return; // 只看当前有人消费的关键 feed
    const fr: FeedFreshness = { key: f.key, critical: true, active: true, ...toFreshness(f, now) };
    const sev = KIND_SEVERITY[fr.kind];
    if (sev >= 2) degraded.push(fr);
    if (sev > worstSev) { worstSev = sev; worst = fr; }
  });
  const level: HealthLevel = worstSev >= 3 ? 'down' : worstSev >= 2 ? 'warn' : 'ok';
  return { level, worst, degraded };
}

// ── 订阅（React） ─────────────────────────────────────────────────────────────

export function subscribeFreshness(cb: () => void): () => void {
  listeners.add(cb);
  startTicker();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) stopTicker();
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WS 活动上报（控制反转）：lib/baseWs 通过此 reporter 上报，不直接 import 本模块。
// ═══════════════════════════════════════════════════════════════════════════════

import { _setWsActivityReporter } from '../../lib/baseWs';

_setWsActivityReporter((feedKey, kind) => {
  if (kind === 'message') { setActive(feedKey, true); markOk(feedKey); }
  else if (kind === 'connected') setActive(feedKey, true);
  else if (kind === 'disconnected') markError(feedKey, '连接断开'); // 保持 active，断开即报警
});

// ═══════════════════════════════════════════════════════════════════════════════
// React hooks
// 用 subscribe + forceUpdate；在 render 期重新计算派生值（年龄随 1s ticker 走）。
// ═══════════════════════════════════════════════════════════════════════════════

import { useReducer, useEffect } from 'react';

function useTick(): void {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeFreshness(force), []);
}

/** 订阅单个 feed 的新鲜度（随 1s ticker 自动跳「N秒前」）。 */
export function useFreshness(key: string): Freshness | null {
  useTick();
  return getFreshness(key);
}

/** 订阅全局数据健康（顶栏总闸用）。 */
export function useGlobalHealth(): ReturnType<typeof globalHealth> {
  useTick();
  return globalHealth();
}

/** 订阅全部 feed 快照（总闸下拉清单用）。 */
export function useAllFreshness(): FeedFreshness[] {
  useTick();
  return snapshotAll();
}

// ── 年龄格式化（「实时 / 12秒前 / 3分前」） ──────────────────────────────────────
export function formatAge(ageMs: number | null): string {
  if (ageMs == null) return '—';
  const s = Math.round(ageMs / 1000);
  if (s < 2) return '实时';
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  return `${h}时前`;
}

// ── 共享配色 / 文案（总闸下拉 + 内联徽章复用，避免重复定义） ──────────────────────
export const FRESH_COLOR: Record<FreshKind, string> = {
  live:   '#22C55E',
  aging:  '#F59E0B',
  stale:  '#EF4444',
  error:  '#EF4444',
  paused: '#F59E0B',
  sample: '#8A8F98',
  loading:'#8A8F98',
};

/** 状态文案：live/aging/stale 显示真实年龄；其余显示状态词。 */
export function freshStateText(fr: Pick<Freshness, 'kind' | 'ageMs'>): string {
  switch (fr.kind) {
    case 'error':   return '中断';
    case 'paused':  return '已暂停';
    case 'sample':  return '示例';
    case 'loading': return '加载中';
    default:        return formatAge(fr.ageMs); // live / aging / stale → 实时 / N秒前
  }
}
