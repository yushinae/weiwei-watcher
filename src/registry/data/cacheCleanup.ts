import { DERIBIT_CACHE, CACHE_TTL, HIST_CACHE, HIST_TTL } from './deribit';
import { FLOW_CACHE, FLOW_TTL } from './flow';
import { TICKER_CACHE } from './ws';
import { WATCH_CACHE } from './store';

const CLEANUP_MS = 300_000;

function cleanExpired<K, V extends { ts: number }>(map: Map<K, V>, ttl: number): void {
  const now = Date.now();
  for (const [k, v] of map) {
    if (now - v.ts > ttl) map.delete(k);
  }
}

export function startCacheCleanup(): () => void {
  const id = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    cleanExpired(DERIBIT_CACHE, CACHE_TTL);
    cleanExpired(HIST_CACHE, HIST_TTL);
    cleanExpired(FLOW_CACHE, FLOW_TTL);
    cleanExpired(TICKER_CACHE, 300_000);
    cleanExpired(WATCH_CACHE, 600_000);
  }, CLEANUP_MS);
  return () => clearInterval(id);
}
