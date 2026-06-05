// 期权总持仓量(OI)的轻量本地快照 —— 用来算「OI 24h 变化」(建仓 vs 平仓)。
// Deribit 只给当前 OI 快照、无逐时历史，所以和 volHistory 一样在本地累积：
// 每 ≥55 分钟记一条 {ts, totalOI, callOI, putOI}，对比 ~24h 前那条算变化。
// 不足 24h 数据时优雅降级（返回 null → UI 显示「积累中」）。占用极小（每条几十字节）。
import type { Coin } from './types';

const KEY = 'weiwei.oihist.v1';
const MIN_GAP_MS = 55 * 60 * 1000;     // 两条快照最小间隔，避免刷爆
const PRUNE_MS = 50 * 60 * 60 * 1000;  // 只保留最近 ~50h
const TARGET_MS = 24 * 60 * 60 * 1000; // 目标对比点：24h 前
const TOLERANCE_MS = 6 * 60 * 60 * 1000; // 容差：18~30h 都算「约 24h 前」

export interface OISnap { ts: number; totalOI: number; callOI: number; putOI: number; }
type Store = Record<string, OISnap[]>;

function read(): Store {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Store; } catch { return {}; }
}
function write(s: Store) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota — ignore */ }
}

/** 记一条快照（自带节流 + 修剪过期）。在拿到新链数据时调用即可。 */
export function recordOISnapshot(coin: Coin, snap: Omit<OISnap, 'ts'>): void {
  if (!(snap.totalOI > 0)) return;
  const now = Date.now();
  const store = read();
  const arr = store[coin] ?? [];
  const last = arr[arr.length - 1];
  if (last && now - last.ts < MIN_GAP_MS) return; // 节流
  arr.push({ ts: now, ...snap });
  store[coin] = arr.filter(s => now - s.ts <= PRUNE_MS);
  write(store);
}

export interface OIChange {
  pct: number;        // 总 OI 24h 变化 %
  absChange: number;  // 总 OI 绝对变化（张）
  fromTs: number;     // 对比点时间戳
  hoursSpan: number;  // 实际跨度（小时）
}

/** 取 ~24h 前快照与当前 totalOI 比较；数据不足返回 null。 */
export function getOIChange24h(coin: Coin, currentTotalOI: number): OIChange | null {
  if (!(currentTotalOI > 0)) return null;
  const now = Date.now();
  const arr = read()[coin] ?? [];
  if (!arr.length) return null;
  // 找离「24h 前」最近、且在容差内的那条
  let best: OISnap | null = null;
  let bestDiff = Infinity;
  for (const s of arr) {
    const age = now - s.ts;
    const diff = Math.abs(age - TARGET_MS);
    if (diff < bestDiff && Math.abs(age - TARGET_MS) <= TOLERANCE_MS) { best = s; bestDiff = diff; }
  }
  if (!best || !(best.totalOI > 0)) return null;
  const absChange = currentTotalOI - best.totalOI;
  return {
    pct: (absChange / best.totalOI) * 100,
    absChange,
    fromTs: best.ts,
    hoursSpan: (now - best.ts) / 3.6e6,
  };
}
