import { useState, useEffect, useCallback, useSyncExternalStore, useRef } from 'react';
import { fetchBybitOptionPositions, BybitAuthError, type BybitOptionPosition } from './rest';
import { hasBrowserWsCredentials, isConfigured, subscribeAuthState } from './auth';
import { BYBIT_PRIVATE_WS } from './ws';
import { shouldRunFeedKey } from '../../registry/data/runtimePolicy';

// Polling interval — WS handles incremental updates, REST keeps us honest if a
// WS message slips through (e.g. across a reconnect race) and refreshes Greeks
// even when the position itself doesn't change.
const POLL_MS = 30_000;
const WS_FLUSH_MS = 400;

export function useBybitAuthState() {
  return useSyncExternalStore(subscribeAuthState, isConfigured, isConfigured);
}

interface State {
  positions: BybitOptionPosition[];
  loading: boolean;
  error: string | null;
  fetchedAt: number;
}

// ── Merge WS push payloads on top of an existing positions list ──────────────
function mergePositions(prev: BybitOptionPosition[], updates: BybitOptionPosition[]): BybitOptionPosition[] {
  if (updates.length === 0) return prev;
  const map = new Map(prev.map(p => [p.symbol, p]));
  for (const u of updates) {
    if (parseFloat(u.size) === 0) {
      map.delete(u.symbol);
    } else {
      map.set(u.symbol, { ...map.get(u.symbol), ...u });
    }
  }
  return [...map.values()];
}

export function useBybitPositions(): State & { refresh: () => void } {
  const configured = useBybitAuthState();
  const [state, setState] = useState<State>({ positions: [], loading: false, error: null, fetchedAt: 0 });
  const wsBufferRef = useRef<BybitOptionPosition[]>([]);
  const wsFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!isConfigured()) return;
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const positions = await fetchBybitOptionPositions();
      setState({ positions, loading: false, error: null, fetchedAt: Date.now() });
    } catch (e) {
      if (e instanceof BybitAuthError) {
        setState(s => ({ ...s, loading: false, error: '请先在 .env 或本地后端配置 Bybit API key' }));
      } else {
        setState(s => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
      }
    }
  }, []);

  // REST: initial snapshot + safety-net poll
  useEffect(() => {
    if (!configured) return;
    refresh();
    const id = setInterval(() => {
      if (shouldRunFeedKey('bybit-positions', { mode: 'critical-background' })) refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [configured, refresh]);

  // WS: subscribe to `position` topic; buffer & flush so a flurry of updates
  // doesn't cause one render per push.
  useEffect(() => {
    if (!configured || !hasBrowserWsCredentials()) return;
    const flush = () => {
      wsFlushTimerRef.current = null;
      const updates = wsBufferRef.current;
      wsBufferRef.current = [];
      if (updates.length === 0) return;
      setState(s => ({
        ...s,
        positions: mergePositions(s.positions, updates),
        fetchedAt: Date.now(),
      }));
    };
    const unsub = BYBIT_PRIVATE_WS.subscribe<BybitOptionPosition[]>('position', (data) => {
      // Bybit emits one push per category; filter for options to be safe.
      const opts = (Array.isArray(data) ? data : []).filter(p =>
        // Heuristic: option symbols contain "-C" or "-P" as the last segment
        /-(C|P)$/.test(p.symbol),
      );
      if (opts.length === 0) return;
      wsBufferRef.current.push(...opts);
      if (wsFlushTimerRef.current === null) {
        wsFlushTimerRef.current = setTimeout(flush, WS_FLUSH_MS);
      }
    });
    return () => {
      unsub();
      if (wsFlushTimerRef.current !== null) {
        clearTimeout(wsFlushTimerRef.current);
        wsFlushTimerRef.current = null;
      }
      wsBufferRef.current = [];
    };
  }, [configured]);

  return { ...state, refresh };
}
