// ═══════════════════════════════════════════════════════════════════════════════
// Shared polling scheduler
// One setInterval per data-key, shared across every widget that needs the same
// data. Monitor data keeps running in the background so alerts and dashboards do
// not silently freeze when the browser tab loses focus.
// ═══════════════════════════════════════════════════════════════════════════════

import { markOk, markError, markAllPaused, setActive } from './freshness';
import {
  feedRunMode,
  resetRuntimePolicyForTest,
  setGlobalPaused,
  setMonitorRoutePaused,
  shouldRunFeed,
  subscribeRuntimePolicy,
} from './runtimePolicy';
import type { FeedRunMode } from './feedCatalog';

export type DataSub<T> = (data: T) => void;

export interface PollerEntry {
  intervalMs: number;
  subscribers: Set<DataSub<unknown>>;
  errorSubscribers: Set<(err: unknown) => void>;
  lastData: unknown;
  fetcher: () => Promise<unknown>;
  timerId: ReturnType<typeof setInterval> | null;
  inFlight: Promise<void> | null;
  requestSeq: number;
  pollOnMonitorRoute: boolean;
  mode: FeedRunMode;
}

const POLLERS = new Map<string, PollerEntry>();

export function _shouldSkip(options?: { monitorScoped?: boolean; mode?: FeedRunMode }): boolean {
  return !shouldRunFeed({
    mode: options?.mode ?? 'critical-background',
    monitorScoped: options?.monitorScoped,
  });
}

async function _pollOnce(key: string): Promise<void> {
  const e = POLLERS.get(key);
  if (!e || e.subscribers.size === 0) return;
  if (_shouldSkip({ monitorScoped: e.pollOnMonitorRoute, mode: e.mode })) return;
  if (e.inFlight) return e.inFlight;
  const seq = ++e.requestSeq;
  e.inFlight = (async () => {
    try {
      const d = await e.fetcher();
      if (_shouldSkip({ monitorScoped: e.pollOnMonitorRoute, mode: e.mode })) return;
      if (seq !== e.requestSeq) return;
      e.lastData = d;
      e.subscribers.forEach(fn => fn(d));
      markOk(key, e.intervalMs);
    } catch (err) {
      markError(key, err);
      e.errorSubscribers.forEach(fn => fn(err));
    } finally {
      if (e.inFlight) e.inFlight = null;
    }
  })();
  return e.inFlight;
}

function reconcilePollersWithRuntimePolicy(): void {
  POLLERS.forEach((e, key) => {
    const blocked = _shouldSkip({ monitorScoped: e.pollOnMonitorRoute, mode: e.mode });
    if (blocked) {
      if (e.timerId != null) {
        clearInterval(e.timerId);
        e.timerId = null;
      }
      return;
    }
    if (e.subscribers.size > 0 && e.timerId == null) {
      _pollOnce(key);
      e.timerId = setInterval(() => _pollOnce(key), e.intervalMs);
    }
  });
}

subscribeRuntimePolicy(reconcilePollersWithRuntimePolicy);

let _wsPauseFn: (() => void) | null = null;
let _wsResumeFn: (() => void) | null = null;

export function _resetPollersForTest(): void {
  POLLERS.forEach(e => {
    if (e.timerId != null) clearInterval(e.timerId);
  });
  POLLERS.clear();
  resetRuntimePolicyForTest();
  _wsPauseFn = null;
  _wsResumeFn = null;
}

export function _registerWSPauseResume(pause: () => void, resume: () => void): void {
  _wsPauseFn = pause;
  _wsResumeFn = resume;
}

export function _resumeAll(): void {
  setGlobalPaused(false);
  markAllPaused(false);
  POLLERS.forEach((e, key) => {
    if (e.subscribers.size > 0 && e.timerId == null && !_shouldSkip({ monitorScoped: e.pollOnMonitorRoute, mode: e.mode })) {
      _pollOnce(key);
      e.timerId = setInterval(() => _pollOnce(key), e.intervalMs);
    }
  });
  _wsResumeFn?.();
}

export function _pauseAll(): void {
  setGlobalPaused(true);
  markAllPaused(true);
  POLLERS.forEach(e => {
    if (e.timerId != null) { clearInterval(e.timerId); e.timerId = null; }
  });
  _wsPauseFn?.();
}

export function resumeMonitorPolling(): void {
  setMonitorRoutePaused(false);
  POLLERS.forEach((e, key) => {
    if (!e.pollOnMonitorRoute || e.subscribers.size === 0 || e.timerId != null || _shouldSkip({ monitorScoped: true, mode: e.mode })) return;
    _pollOnce(key);
    e.timerId = setInterval(() => _pollOnce(key), e.intervalMs);
  });
}

export function pauseMonitorPolling(): void {
  setMonitorRoutePaused(true);
  POLLERS.forEach(e => {
    if (!e.pollOnMonitorRoute) return;
    if (e.timerId != null) { clearInterval(e.timerId); e.timerId = null; }
  });
}

export function setVisibleInterval(cb: () => void, ms: number): () => void {
  let id: ReturnType<typeof setInterval> | null = null;
  const tick = () => { cb(); };
  const start = () => { if (id == null) id = setInterval(tick, ms); };
  const stop  = () => { if (id != null) { clearInterval(id); id = null; } };
  start();
  return () => { stop(); };
}

export function subscribeData<T>(
  key: string,
  fetcher: () => Promise<T>,
  intervalMs: number,
  subscriber: DataSub<T>,
  onErrorOrOptions?: ((err: unknown) => void) | { onError?: (err: unknown) => void; monitorScoped?: boolean; mode?: FeedRunMode },
): () => void {
  let e = POLLERS.get(key);
  const onError = typeof onErrorOrOptions === 'function' ? onErrorOrOptions : onErrorOrOptions?.onError;
  const monitorScoped = typeof onErrorOrOptions === 'object' ? onErrorOrOptions.monitorScoped === true : false;
  const mode = feedRunMode(key, typeof onErrorOrOptions === 'object' ? onErrorOrOptions.mode : undefined);
  if (!e) {
    e = {
      intervalMs,
      subscribers: new Set(),
      errorSubscribers: new Set(),
      lastData: undefined,
      fetcher: fetcher as () => Promise<unknown>,
      timerId: null,
      inFlight: null,
      requestSeq: 0,
      pollOnMonitorRoute: monitorScoped,
      mode,
    };
    POLLERS.set(key, e);
  } else {
    if (e.intervalMs !== intervalMs) {
      console.warn(`[poller] subscribeData("${key}") reused with different interval (${e.intervalMs}ms → ${intervalMs}ms); keeping the first interval.`);
    }
    e.pollOnMonitorRoute = e.pollOnMonitorRoute || monitorScoped;
    e.mode = mode;
  }
  const entry = e;
  const wasEmpty = entry.subscribers.size === 0;
  entry.subscribers.add(subscriber as DataSub<unknown>);
  if (onError) entry.errorSubscribers.add(onError);
  if (wasEmpty) setActive(key, true);

  if (entry.lastData !== undefined) subscriber(entry.lastData as T);

  if (entry.timerId == null && !_shouldSkip({ monitorScoped: entry.pollOnMonitorRoute, mode: entry.mode })) {
    if (entry.lastData === undefined) _pollOnce(key);
    entry.timerId = setInterval(() => _pollOnce(key), intervalMs);
  }

  return () => {
    entry.subscribers.delete(subscriber as DataSub<unknown>);
    if (onError) entry.errorSubscribers.delete(onError);
    if (entry.subscribers.size === 0) {
      setActive(key, false); // 无人消费 → 不再计入「冻住」告警
      if (entry.timerId != null) { clearInterval(entry.timerId); entry.timerId = null; }
    }
  };
}
