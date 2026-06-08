// ═══════════════════════════════════════════════════════════════════════════════
// Shared polling scheduler
// One setInterval per data-key, shared across every widget that needs the same
// data. Pauses automatically when the window/tab is hidden (Page Visibility API).
// ═══════════════════════════════════════════════════════════════════════════════

import { markOk, markError, markAllPaused, setActive } from './freshness';

export type DataSub<T> = (data: T) => void;

export interface PollerEntry {
  intervalMs: number;
  subscribers: Set<DataSub<unknown>>;
  lastData: unknown;
  fetcher: () => Promise<unknown>;
  timerId: ReturnType<typeof setInterval> | null;
}

const POLLERS = new Map<string, PollerEntry>();
let _isHidden    = false;
let _focusLostAt: number | null = null;
let _blurPauseTimer: ReturnType<typeof setTimeout> | null = null;
const UNFOCUS_PAUSE_MS = 30_000;

export function _shouldSkip(): boolean {
  if (_isHidden) return true;
  if (_focusLostAt !== null && Date.now() - _focusLostAt > UNFOCUS_PAUSE_MS) return true;
  return false;
}

async function _pollOnce(key: string): Promise<void> {
  if (_shouldSkip()) return;
  const e = POLLERS.get(key);
  if (!e || e.subscribers.size === 0) return;
  try {
    const d = await e.fetcher();
    if (_shouldSkip()) return;
    e.lastData = d;
    e.subscribers.forEach(fn => fn(d));
    markOk(key, e.intervalMs);
  } catch (err) {
    markError(key, err);
  }
}

let _wsPauseFn: (() => void) | null = null;
let _wsResumeFn: (() => void) | null = null;

export function _resetPollersForTest(): void {
  POLLERS.forEach(e => {
    if (e.timerId != null) clearInterval(e.timerId);
  });
  POLLERS.clear();
  _isHidden = false;
  _focusLostAt = null;
  if (_blurPauseTimer !== null) {
    clearTimeout(_blurPauseTimer);
    _blurPauseTimer = null;
  }
  _wsPauseFn = null;
  _wsResumeFn = null;
}

export function _registerWSPauseResume(pause: () => void, resume: () => void): void {
  _wsPauseFn = pause;
  _wsResumeFn = resume;
}

export function _resumeAll(): void {
  _isHidden = false;
  markAllPaused(false);
  POLLERS.forEach((e, key) => {
    if (e.subscribers.size > 0 && e.timerId == null) {
      _pollOnce(key);
      e.timerId = setInterval(() => _pollOnce(key), e.intervalMs);
    }
  });
  _wsResumeFn?.();
}

export function _pauseAll(): void {
  _isHidden = true;
  markAllPaused(true);
  POLLERS.forEach(e => {
    if (e.timerId != null) { clearInterval(e.timerId); e.timerId = null; }
  });
  _wsPauseFn?.();
}

export function resumeMonitorPolling(): void {
  _resumeAll();
}

export function pauseMonitorPolling(): void {
  markAllPaused(false);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () =>
    document.hidden ? _pauseAll() : _resumeAll()
  );
}

if (typeof window !== 'undefined') {
  window.addEventListener('blur', () => {
    if (document.hasFocus()) return;
    _focusLostAt = _focusLostAt ?? Date.now();
    if (!_blurPauseTimer) {
      _blurPauseTimer = setTimeout(() => {
        _blurPauseTimer = null;
        if (_focusLostAt !== null && !_isHidden) _wsPauseFn?.();
      }, UNFOCUS_PAUSE_MS);
    }
  });
  window.addEventListener('focus', () => {
    if (_blurPauseTimer !== null) { clearTimeout(_blurPauseTimer); _blurPauseTimer = null; }
    if (_focusLostAt === null) return;
    const wasLongAway = Date.now() - _focusLostAt > UNFOCUS_PAUSE_MS;
    _focusLostAt = null;
    if (wasLongAway && !_isHidden) {
      POLLERS.forEach((_, key) => _pollOnce(key));
      _wsResumeFn?.();
    }
  });
}

export function setVisibleInterval(cb: () => void, ms: number): () => void {
  let id: ReturnType<typeof setInterval> | null = null;
  const tick = () => { if (!_shouldSkip()) cb(); };
  const start = () => { if (id == null) id = setInterval(tick, ms); };
  const stop  = () => { if (id != null) { clearInterval(id); id = null; } };
  const onVis = () => document.hidden ? stop() : start();
  if (!document.hidden) start();
  document.addEventListener('visibilitychange', onVis);
  return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
}

export function subscribeData<T>(
  key: string,
  fetcher: () => Promise<T>,
  intervalMs: number,
  subscriber: DataSub<T>,
): () => void {
  let e = POLLERS.get(key);
  if (!e) {
    e = {
      intervalMs,
      subscribers: new Set(),
      lastData: undefined,
      fetcher: fetcher as () => Promise<unknown>,
      timerId: null,
    };
    POLLERS.set(key, e);
  }
  const entry = e;
  const wasEmpty = entry.subscribers.size === 0;
  entry.subscribers.add(subscriber as DataSub<unknown>);
  if (wasEmpty) setActive(key, true);

  if (entry.lastData !== undefined) subscriber(entry.lastData as T);

  if (entry.timerId == null && !_isHidden) {
    if (entry.lastData === undefined) _pollOnce(key);
    entry.timerId = setInterval(() => _pollOnce(key), intervalMs);
  }

  return () => {
    entry.subscribers.delete(subscriber as DataSub<unknown>);
    if (entry.subscribers.size === 0) {
      setActive(key, false); // 无人消费 → 不再计入「冻住」告警
      if (entry.timerId != null) { clearInterval(entry.timerId); entry.timerId = null; }
    }
  };
}
