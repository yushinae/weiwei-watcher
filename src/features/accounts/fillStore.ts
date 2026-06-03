// 本地持久成交库 —— 每次同步把新成交合并进来（按 venue:id 去重），只增不减。
// 这就是"本地存一份"的实现：关掉重开都在；交易所端永远是源头，这里是加速 + 多所合并的缓存。
// 容量：localStorage 约 5MB，按每笔 ~150B 估可存 3 万+笔，个人自用足够；将来量大可平滑换 IndexedDB。

import type { UnifiedFill, Venue } from './types';

const FILLS_KEY = 'weiwei.fills.v1';
const SYNC_KEY = 'weiwei.fills.sync.v1';

type FillMap = Record<string, UnifiedFill>;
type SyncMap = Record<string, number>;

function load<T>(k: string, fb: T): T {
  try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : fb; } catch { return fb; }
}
function save(k: string, v: unknown): void {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 配额溢出忽略 */ }
}

export function loadAllFills(): UnifiedFill[] {
  return Object.values(load<FillMap>(FILLS_KEY, {})).sort((a, b) => a.time - b.time);
}

// 返回本次新增（去重后）数量
export function mergeFills(fills: UnifiedFill[]): number {
  if (!fills.length) return 0;
  const m = load<FillMap>(FILLS_KEY, {});
  let added = 0;
  for (const f of fills) {
    const key = `${f.venue}:${f.id}`;
    if (!(key in m)) added++;
    m[key] = f;
  }
  save(FILLS_KEY, m);
  return added;
}

export function getLastSync(venue: Venue, acctId: string): number {
  return load<SyncMap>(SYNC_KEY, {})[`${venue}:${acctId}`] ?? 0;
}
export function setLastSync(venue: Venue, acctId: string, ms: number): void {
  const m = load<SyncMap>(SYNC_KEY, {});
  m[`${venue}:${acctId}`] = ms;
  save(SYNC_KEY, m);
}

export function fillsForAccount(venue: Venue, acctId: string): UnifiedFill[] {
  return loadAllFills().filter(f => f.venue === venue && f.accountId === acctId);
}

export function clearAccountData(venue: Venue, acctId: string): void {
  const m = load<FillMap>(FILLS_KEY, {});
  for (const k of Object.keys(m)) {
    if (m[k].venue === venue && m[k].accountId === acctId) delete m[k];
  }
  save(FILLS_KEY, m);
  const s = load<SyncMap>(SYNC_KEY, {});
  delete s[`${venue}:${acctId}`];
  save(SYNC_KEY, s);
}

// 一键导出 JSON 备份（防清缓存 / 跨设备手动搬）
export function exportFillsJson(): void {
  const blob = new Blob([JSON.stringify(loadAllFills(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `weiwei-fills-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
