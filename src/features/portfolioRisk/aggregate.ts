// 组合风险聚合：把实时持仓汇总成「按币种的净美元希腊」，并基于希腊字母做情景压力测试。
//
// 单位约定全程沿用 app 既有可信口径（store.ts / PositionTrackerWidget）：
//   · dollarDelta = delta × spot          → 净美元 Delta（名义）
//   · dollarGamma = gamma × spot² / 100   → 每 1% spot 的 Dollar Gamma
//   · dollarVega  = vega / 100            → 每 1% IV 的 Dollar Vega
//   · dollarTheta = theta × spot          → 每日 Dollar Theta
// Deribit 的 greeks 来自其 ticker（已折算 USD，可信）。Bybit 的原生 greeks 为
// 每张合约口径、未折算 USD，跨所合并需乘合约规模——未经实盘核对前不纳入 USD 合计，
// 以免给出"看似精确实则错误"的风险数字（venue 字段已为后续接入预留）。

import type { LivePosition } from '../../registry/monitorWidgetsBase';
import type { UnifiedPosition } from '../accounts/types';

export type Venue = 'Deribit' | 'Bybit' | 'Hyperliquid' | 'Binance';

export interface RiskPosition {
  id: string;
  venue: Venue;
  coin: string;
  instrument: string;
  qty: number;
  spot: number;
  mark: number;
  iv: number;
  dollarDelta: number; // $Δ 名义
  dollarGamma: number; // $Γ / 1% spot
  dollarVega: number;  // $ν / 1% IV
  dollarTheta: number; // $Θ / day
  sim?: boolean;       // 模拟仓（策略沙盒），与真实仓区分
}

export interface CoinBook {
  coin: string;
  spot: number;
  count: number;
  netDelta: number;
  netGamma: number;
  netVega: number;
  netTheta: number;
}

const coinOf = (instrument: string) => instrument.split('-')[0] || '—';

// Deribit live 持仓 → 统一风险模型（直接采用其 USD dollar greeks）
export function fromDeribit(live: LivePosition[]): RiskPosition[] {
  return live
    .filter(p => p.qty !== 0)
    .map(p => ({
      id: p.id,
      venue: 'Deribit' as const,
      coin: coinOf(p.instrument),
      instrument: p.instrument,
      qty: p.qty,
      spot: p.spot,
      mark: p.mark,
      iv: p.iv,
      dollarDelta: p.dollarDelta,
      dollarGamma: p.dollarGamma,
      dollarVega: p.dollarVega,
      dollarTheta: p.dollarTheta,
    }));
}

// 「账户」页真实持仓 → 统一风险模型。各所统一约定：1 张=1 币、delta 仓位级币本位 → $Δ = delta × 现价。
// vega/theta：USDT/USDC 线性(greeksUsd=true)已是 USD；Deribit 反向(BTC/ETH)以币计 → ×现价。
export function fromAccounts(positions: UnifiedPosition[], spotByCoin: Record<string, number>): RiskPosition[] {
  return positions
    .filter(p => (p.delta ?? 0) !== 0 || p.size !== 0)
    .map(p => {
      const spot = spotByCoin[p.coin] || (Math.abs(p.size) ? p.notionalUsd / Math.abs(p.size) : 0) || 0;
      const delta = p.delta ?? (p.kind === 'perp' ? p.size : 0);
      const gamma = p.gamma ?? 0, vega = p.vega ?? 0, theta = p.theta ?? 0;
      const usd = p.greeksUsd ?? true;
      const kindLabel = p.kind === 'perp' ? '永续' : p.kind === 'option' ? '期权' : '现货';
      const instrument = p.instrument ?? `${p.venue} ${p.coin} ${kindLabel}`;
      return {
        id: `acct-${p.accountId}-${p.venue}-${instrument}-${p.size}`,
        venue: p.venue,
        coin: p.coin,
        instrument,
        qty: p.size,
        spot,
        mark: p.markPx ?? 0,
        iv: 0,
        dollarDelta: delta * spot,
        dollarGamma: gamma * spot * spot / 100,
        dollarVega: usd ? vega : vega * spot,
        dollarTheta: usd ? theta : theta * spot,
      };
    });
}

// 模拟仓（期权链下单）→ 风险模型。希腊在成交时从链上 BS 快照（USD 口径、每张）：
//   delta/gamma 为每张×方向 → ×qty 得仓位币本位；vega(USD/1%) / theta(USD/日) 已是 USD → ×qty。
export function fromSim(
  positions: Array<{ symbol: string; side: 'long' | 'short'; qty: number; markPrice: number; delta?: number; gamma?: number; vega?: number; theta?: number }>,
  spotByCoin: Record<string, number>,
): RiskPosition[] {
  return positions
    .filter(p => p.qty > 0)
    .map(p => {
      const coin = (p.symbol.split('-')[0] || '—').replace(/_.*/, '');
      const spot = spotByCoin[coin] || 0;
      const dl = (p.delta ?? 0) * p.qty; // 仓位币本位 delta
      const gm = (p.gamma ?? 0) * p.qty; // 仓位币本位 gamma
      const vg = (p.vega ?? 0) * p.qty;  // 已是 USD/1%
      const th = (p.theta ?? 0) * p.qty; // 已是 USD/日
      return {
        id: `sim-${p.symbol}`,
        venue: 'Deribit' as const,
        coin,
        instrument: p.symbol,
        qty: p.side === 'long' ? p.qty : -p.qty,
        spot,
        mark: p.markPrice,
        iv: 0,
        dollarDelta: dl * spot,
        dollarGamma: gm * spot * spot / 100,
        dollarVega: vg,
        dollarTheta: th,
        sim: true,
      };
    });
}

// 按币种聚合净希腊
export function buildBooks(positions: RiskPosition[]): CoinBook[] {
  const m = new Map<string, CoinBook>();
  for (const p of positions) {
    const b = m.get(p.coin) ?? { coin: p.coin, spot: p.spot, count: 0, netDelta: 0, netGamma: 0, netVega: 0, netTheta: 0 };
    b.netDelta += p.dollarDelta;
    b.netGamma += p.dollarGamma;
    b.netVega += p.dollarVega;
    b.netTheta += p.dollarTheta;
    b.count += 1;
    if (p.spot > 0) b.spot = p.spot;
    m.set(p.coin, b);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

export interface BookTotals {
  netDelta: number;
  netGamma: number;
  netVega: number;
  netTheta: number;
  count: number;
}

export function totals(books: CoinBook[]): BookTotals {
  return books.reduce<BookTotals>((t, b) => ({
    netDelta: t.netDelta + b.netDelta,
    netGamma: t.netGamma + b.netGamma,
    netVega: t.netVega + b.netVega,
    netTheta: t.netTheta + b.netTheta,
    count: t.count + b.count,
  }), { netDelta: 0, netGamma: 0, netVega: 0, netTheta: 0, count: 0 });
}

// ── 情景压力测试（基于希腊字母：Δ + ½Γ + Vega + Theta）─────────────────────────
// 同一个 spot 百分比冲击施加到所有币种（加密高度相关）。大幅冲击下为近似（高阶项忽略）。

export interface Scenario {
  spotPct: number; // spot 冲击（%）
  ivPts: number;   // IV 冲击（vol 点）
  dtDays: number;  // 时间推进（天，theta）
}

// 单币种 P&L
// netDelta = 名义 $Δ → 价格 P&L ≈ netDelta · frac
// netGamma = 每 1% spot 的 $Δ 变化（dollarGamma）→ 凸性 P&L ≈ ½ · netGamma · spotPct² / 100
//   （把随移动线性变化的 $Δ 在 0..spotPct% 区间上积分；切勿再乘 spot，否则量级会放大上百倍）
// netVega  = 每 1% IV 的 $ → ivPts 个 vol 点：netVega · ivPts
// netTheta = 每日 $ → dtDays 天：netTheta · dtDays
export function coinScenarioPnL(b: CoinBook, s: Scenario): number {
  const frac = s.spotPct / 100;
  const pnlDelta = b.netDelta * frac;
  const pnlGamma = 0.5 * b.netGamma * (s.spotPct * s.spotPct) / 100;
  const pnlVega = b.netVega * s.ivPts;
  const pnlTheta = b.netTheta * s.dtDays;
  return pnlDelta + pnlGamma + pnlVega + pnlTheta;
}

// 全组合 P&L
export function portfolioScenarioPnL(books: CoinBook[], s: Scenario): number {
  return books.reduce((sum, b) => sum + coinScenarioPnL(b, s), 0);
}

// ── 示例持仓（无实时持仓时演示用）────────────────────────────────────────────
// 直接给出已折算的 dollar greeks（构造一个温和净空 Vega + 轻微净多 Delta 的真实风格组合）。
export function samplePositions(btcSpot = 67000, ethSpot = 3500): RiskPosition[] {
  const mk = (
    venue: Venue, coin: string, instrument: string, qty: number, spot: number,
    dDelta: number, dGamma: number, dVega: number, dTheta: number,
  ): RiskPosition => ({
    id: instrument + '-' + qty, venue, coin, instrument, qty, spot, mark: 0, iv: 0,
    dollarDelta: dDelta, dollarGamma: dGamma, dollarVega: dVega, dollarTheta: dTheta,
  });
  return [
    // BTC：卖出 OTM put（净多 Delta、空 Gamma、空 Vega、收 Theta）
    mk('Deribit', 'BTC', 'BTC-27JUN25-60000-P', -5, btcSpot, 78_000, -4_200, -9_400, 1_350),
    // BTC：买入 ATM call 对冲方向
    mk('Deribit', 'BTC', 'BTC-27JUN25-70000-C', 3, btcSpot, 96_000, 5_100, 7_800, -1_120),
    // BTC：卖出 call 墙上方（封顶 + 收 Theta）
    mk('Deribit', 'BTC', 'BTC-27JUN25-80000-C', -4, btcSpot, -41_000, -3_000, -6_200, 880),
    // ETH：买入跨式（多 Gamma 多 Vega）
    mk('Deribit', 'ETH', 'ETH-27JUN25-3500-C', 20, ethSpot, 34_000, 2_600, 5_400, -760),
    mk('Deribit', 'ETH', 'ETH-27JUN25-3500-P', 20, ethSpot, -30_000, 2_600, 5_400, -760),
  ];
}
