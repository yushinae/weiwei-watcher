// ═══════════════════════════════════════════════════════════════════════════════
// 下单前 sanity 检查（纯函数，护栏的终点 = 护到「按下确认」那一刻）
//
// 在你点买/卖之前，一眼看清：数据新鲜吗？点差是不是异常宽？是不是手滑把限价打偏了？
// 数量填了吗？返回一个总灯（绿可下 / 黄注意 / 红别急）+ 逐条原因。
//
//   block = 真的下不了单（数量为 0、限价单没填价）→ 禁用提交
//   warn  = 能下，但先看一眼（数据不新鲜、点差宽、限价偏离盘口）→ 灯变红/黄但不锁
// ═══════════════════════════════════════════════════════════════════════════════

import type { FreshKind } from '../../registry/data/freshness';

export type CheckLevel = 'ok' | 'warn' | 'block';

export interface PreTradeCheck {
  id: string;
  level: CheckLevel;
  label: string;
  detail: string;
}

export interface PreTradeResult {
  /** 总灯：所有检查里最差的一档。 */
  level: CheckLevel;
  /** 是否存在硬阻断项（提交应禁用）。 */
  blocking: boolean;
  /** 全部检查（含通过项，UI 可只显示非 ok）。 */
  checks: PreTradeCheck[];
}

export interface PreTradeInput {
  bid: number | null;
  ask: number | null;
  mark: number;
  qty: number;
  price: number;               // 当前下单价（限价单用）
  orderType: 'limit' | 'market' | 'stop';
  /** 期权链报价的新鲜度（bid/ask/IV/greeks 都来自它）。 */
  chainKind: FreshKind | null;
  chainAgeMs: number | null;
  /** 现价（spot）的新鲜度。 */
  spotKind: FreshKind | null;
  /** 市价单按真实盘口吃单的预估滑点（%）。仅市价单传，限价单传 null。 */
  marketSlippagePct?: number | null;
}

// 阈值（点差按 mark 的百分比；限价偏离按 mark 的百分比）
const SPREAD_WIDE = 8;      // 点差 > 8% → 偏宽
const SPREAD_VWIDE = 20;    // 点差 > 20% → 很宽
const LIMIT_DEV_WARN = 6;   // 限价偏离标记 > 6% → 注意
const LIMIT_DEV_BAD = 15;   // 限价偏离标记 > 15% → 像手滑
const SLIP_WARN = 3;        // 市价吃单滑点 > 3% → 注意

function worst(a: CheckLevel, b: CheckLevel): CheckLevel {
  const rank = { ok: 0, warn: 1, block: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

function pct(n: number): string {
  return `${n >= 0 ? '' : '−'}${Math.abs(n).toFixed(1)}%`;
}

export function preTradeChecks(i: PreTradeInput): PreTradeResult {
  const checks: PreTradeCheck[] = [];

  // ── 数量 ────────────────────────────────────────────────────────────────────
  if (!(i.qty > 0)) {
    checks.push({ id: 'qty', level: 'block', label: '数量', detail: '数量为 0，填个张数' });
  } else {
    checks.push({ id: 'qty', level: 'ok', label: '数量', detail: `${i.qty} 张` });
  }

  // ── 限价单缺价 ──────────────────────────────────────────────────────────────
  if (i.orderType === 'limit' && !(i.price > 0)) {
    checks.push({ id: 'limit-empty', level: 'block', label: '限价', detail: '限价单未填价格' });
  }

  // ── 数据新鲜度（期权链报价） ──────────────────────────────────────────────────
  // 报价（bid/ask/IV/greeks）来自期权链 feed —— 冻住的报价绝不能照着下单。
  if (i.chainKind) {
    if (i.chainKind === 'error') {
      checks.push({ id: 'fresh-chain', level: 'warn', label: '报价数据', detail: '期权数据中断，报价可能不可信' });
    } else if (i.chainKind === 'stale') {
      checks.push({ id: 'fresh-chain', level: 'warn', label: '报价数据', detail: '报价已过期，先刷新再下' });
    } else if (i.chainKind === 'paused') {
      checks.push({ id: 'fresh-chain', level: 'warn', label: '报价数据', detail: '数据已暂停（窗口失焦），回到页面再下' });
    } else if (i.chainKind === 'aging') {
      checks.push({ id: 'fresh-chain', level: 'warn', label: '报价数据', detail: '报价开始变旧，留意' });
    } else if (i.chainKind === 'sample') {
      checks.push({ id: 'fresh-chain', level: 'warn', label: '报价数据', detail: '当前是示例数据，非实时' });
    } else {
      checks.push({ id: 'fresh-chain', level: 'ok', label: '报价数据', detail: '实时' });
    }
  }

  // ── 数据新鲜度（现价 spot） ──────────────────────────────────────────────────
  if (i.spotKind && i.spotKind !== 'live' && i.spotKind !== 'loading') {
    checks.push({ id: 'fresh-spot', level: 'warn', label: '现价', detail: '现价不是实时，盯市/保证金可能失真' });
  }

  // ── 点差 ────────────────────────────────────────────────────────────────────
  if (i.bid == null || i.ask == null) {
    checks.push({ id: 'spread', level: 'warn', label: '盘口', detail: '无双边报价（流动性差，慎用市价）' });
  } else if (i.mark > 0) {
    const spreadPct = ((i.ask - i.bid) / i.mark) * 100;
    if (spreadPct > SPREAD_VWIDE) {
      checks.push({ id: 'spread', level: 'warn', label: '点差', detail: `点差很宽 ${pct(spreadPct)}，市价单会吃大滑点` });
    } else if (spreadPct > SPREAD_WIDE) {
      checks.push({ id: 'spread', level: 'warn', label: '点差', detail: `点差偏宽 ${pct(spreadPct)}` });
    } else {
      checks.push({ id: 'spread', level: 'ok', label: '点差', detail: `${pct(spreadPct)}` });
    }
  }

  // ── 限价偏离标记（防胖手指） ──────────────────────────────────────────────────
  if (i.orderType === 'limit' && i.price > 0 && i.mark > 0) {
    const devPct = ((i.price - i.mark) / i.mark) * 100;
    if (Math.abs(devPct) > LIMIT_DEV_BAD) {
      checks.push({ id: 'limit-dev', level: 'warn', label: '限价', detail: `偏离标记 ${pct(devPct)}，确认不是手滑` });
    } else if (Math.abs(devPct) > LIMIT_DEV_WARN) {
      checks.push({ id: 'limit-dev', level: 'warn', label: '限价', detail: `偏离标记 ${pct(devPct)}` });
    }
  }

  // ── 市价吃单滑点（按真实盘口预估） ──────────────────────────────────────────
  if (i.marketSlippagePct != null && i.marketSlippagePct > SLIP_WARN) {
    checks.push({ id: 'slippage', level: 'warn', label: '滑点', detail: `市价吃单预计滑点 ${pct(i.marketSlippagePct)}，盘口偏薄` });
  }

  const level = checks.reduce<CheckLevel>((acc, c) => worst(acc, c.level), 'ok');
  const blocking = checks.some(c => c.level === 'block');
  return { level, blocking, checks };
}
