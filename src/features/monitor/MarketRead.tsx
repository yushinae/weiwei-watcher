// 行情 tab 重设计卡片：每张只答一个问题，结论先行、形态优先。
// ① MarketHeadlineWidget：现在在哪 + 怎么动（大价 + 24h 涨跌 + 当日区间条 + 关键数）
// ② MarketSignalsWidget：市场倾向（PCR/skew/资金费率/期限 → 一个综合判定 + 四个清晰读数）
import React, { useEffect, useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { EChart } from '../../components/echart/EChart';
import { useCardHeader } from '../../components/card/WidgetCard';
import {
  useCoinControl, useDeribitOptions, useTickerSnapshotWS,
  CoinLabel, type CoinControlProps, type ExpiryGroup,
} from '../../registry/monitorWidgetsBase';
import { useCandles } from '../priceChart/candles';

const UP = '#28C840';
const DOWN = '#FF5F57';
const YELLOW = '#FEBC2E';
const MUTE = 'rgba(255,255,255,0.5)';

const fmtPx = (v: number) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(1));
const fmtUsdM = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v.toFixed(0)}M`);
const pick = (a: ExpiryGroup[], t: number) => (a.length ? a.reduce((b, e) => (Math.abs(e.daysToExp - t) < Math.abs(b.daysToExp - t) ? e : b)) : undefined);

const Header = ({ coin, setCoin, live }: { coin: 'BTC' | 'ETH'; setCoin: (c: 'BTC' | 'ETH') => void; live: boolean }) => {
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(<CoinLabel coin={coin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, live]);
  return null;
};

const Stat = ({ label, value, color = 'rgba(255,255,255,0.85)' }: { label: string; value: string; color?: string }) => (
  <div className="flex flex-col gap-0.5 px-3 shrink-0">
    <span className="text-[9px] uppercase tracking-wider text-white/40">{label}</span>
    <span className="text-[15px] font-bold tabular-nums leading-none" style={{ color }}>{value}</span>
  </div>
);

const Mom = ({ label, pct }: { label: string; pct: number }) => (
  <span className="text-[10px] tabular-nums whitespace-nowrap">
    <span className="text-white/35">{label}</span>{' '}
    <span className="font-semibold" style={{ color: pct > 0 ? UP : pct < 0 ? DOWN : MUTE }}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>
  </span>
);

// ── ① 行情头条：价格走势 sparkline + 多周期动量 ──
export const MarketHeadlineWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const ticker = useTickerSnapshotWS(coin);
  const { data } = useDeribitOptions(coin);
  const { candles } = useCandles(coin, '1h');

  const spot = ticker?.spot ?? data?.spot ?? 0;
  const dvol = ticker?.dvol ?? data?.dvol30 ?? 0;
  const funding = ticker?.fundingAnn ?? 0;
  const optVol = data ? data.totalOptVol24hUSD / 1e6 : (ticker?.optVol24h_M ?? 0);

  // 多周期动量（1h/4h 从 K 线，24h 用 ticker 官方值）
  const cl = candles.map(c => c.c);
  const n = cl.length;

  // 24H 高低：优先从最近 24 根 1h K 线推（比 ticker 字段可靠），降级用 ticker，再降级用现价
  const last24 = candles.slice(-24);
  const hi = last24.length ? Math.max(...last24.map(c => c.h)) : (ticker?.high24h ?? spot);
  const lo = last24.length ? Math.min(...last24.map(c => c.l)) : (ticker?.low24h ?? spot);
  const chgK = (k: number) => (n > k && cl[n - 1 - k] ? (cl[n - 1] / cl[n - 1 - k] - 1) * 100 : 0);
  const m1h = chgK(1), m4h = chgK(4);
  const chg = ticker?.change24hPct ?? chgK(24);
  const chgC = chg > 0 ? UP : chg < 0 ? DOWN : MUTE;

  // sparkline：最近 48 根 1h 收盘
  const spark = cl.slice(-48);
  const sparkUp = spark.length >= 2 ? spark[spark.length - 1] >= spark[0] : true;
  const sparkColor = sparkUp ? UP : DOWN;
  const sparkOption = useMemo<EChartsOption>(() => ({
    grid: { left: 2, right: 2, top: 6, bottom: 2 },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: spark.map((_, i) => i) },
    yAxis: { type: 'value', show: false, scale: true },
    tooltip: { show: false },
    series: [{
      type: 'line', data: spark.map(v => +v.toFixed(1)), smooth: 0.2, showSymbol: false,
      lineStyle: { color: sparkColor, width: 1.6 },
      areaStyle: { color: sparkUp ? 'rgba(40,200,64,0.12)' : 'rgba(255,95,87,0.12)' },
    }],
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [spark.length, sparkColor, spark[spark.length - 1]]);

  return (
    <div className="w-full h-full flex items-center gap-4 px-3 overflow-x-auto">
      <Header coin={coin} setCoin={setCoin} live={!!ticker} />
      {/* 大价 + 24h 涨跌 + 多周期动量 */}
      <div className="flex flex-col gap-1 shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[30px] font-bold tabular-nums leading-none" style={{ color: chgC }}>{fmtPx(spot)}</span>
          <span className="text-[13px] font-bold tabular-nums" style={{ color: chgC }}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
        </div>
        <div className="flex items-center gap-3">
          <Mom label="1h" pct={m1h} />
          <Mom label="4h" pct={m4h} />
          <Mom label="24h" pct={chg} />
        </div>
        <span className="text-[9px] text-white/35 tabular-nums">24H 区间 {fmtPx(lo)} – {fmtPx(hi)}</span>
      </div>

      {/* 价格走势 sparkline（最近 48h）*/}
      <div className="flex-1 min-w-[160px] max-w-[420px] h-full py-1.5">
        {spark.length >= 2
          ? <EChart option={sparkOption} notMerge />
          : <div className="w-full h-full flex items-center justify-center text-[10px] text-white/30">加载走势…</div>}
      </div>

      <div className="w-px h-9 bg-white/[0.08] shrink-0" />
      <Stat label="DVOL" value={`${dvol.toFixed(1)}%`} />
      <Stat label="资金费率/年" value={`${funding >= 0 ? '+' : ''}${funding.toFixed(1)}%`} color={funding >= 0 ? UP : DOWN} />
      <Stat label="期权成交 24H" value={fmtUsdM(optVol)} />
    </div>
  );
};

// ── ② 市场信号（综合判定 + 四读数）──
export const MarketSignalsWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data } = useDeribitOptions(coin);
  const ticker = useTickerSnapshotWS(coin);

  const sig = useMemo(() => {
    const exp = data?.expiries ?? [];
    const m30 = pick(exp, 30);
    const near = exp.find(e => e.daysToExp >= 6);
    const far = pick(exp, 90);
    const pcr = data?.pcr ?? 0;
    const rr25 = m30?.rr25 ?? 0;
    const funding = ticker?.fundingAnn ?? 0;
    const term = far && near ? far.atmIV - near.atmIV : 0;
    // 综合倾向：偏空票数 − 偏多票数
    let score = 0;
    if (pcr > 1.1) score -= 1; else if (pcr < 0.7) score += 1;
    if (rr25 < -3) score -= 1; else if (rr25 > 3) score += 1;
    if (funding < -2) score -= 1; else if (funding > 25) score -= 1; // 极高资金费率=过热预警，也偏谨慎
    if (term < -2) score -= 1;
    const lean = score <= -2 ? { t: '偏空 / 防守', c: DOWN } : score >= 2 ? { t: '偏多', c: UP } : { t: '中性', c: YELLOW };
    return { pcr, rr25, funding, term, lean };
  }, [data, ticker]);

  const Item = ({ label, value, color, note }: { label: string; value: string; color: string; note: string }) => (
    <div className="flex-1 min-w-[120px] flex flex-col justify-center gap-1 px-3 py-2 rounded-[6px] bg-[var(--color-surface-2)] border border-transparent transition-colors hover:bg-[var(--color-surface-5)]">
      <span className="text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</span>
      <span className="text-[17px] font-bold tabular-nums leading-none" style={{ color }}>{value}</span>
      <span className="text-[9px] text-white/42 leading-tight">{note}</span>
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col gap-2 px-3 py-2 bg-[var(--color-bg-card)]">
      <Header coin={coin} setCoin={setCoin} live={!!data} />
      {/* 综合倾向 */}
      <div className="flex items-center gap-2 shrink-0 rounded-[6px] bg-[var(--color-surface-1)] px-2.5 py-1.5 border border-transparent">
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">综合倾向</span>
        <span className="text-[15px] font-bold" style={{ color: sig.lean.c }}>{sig.lean.t}</span>
        <span className="text-[10px] text-white/35">· 由下列 4 个信号综合（仓位/偏斜/资金/期限）</span>
      </div>
      {/* 4 信号 */}
      <div className="flex gap-2 flex-1 items-stretch">
        <Item label="PCR (OI)" value={sig.pcr.toFixed(2)} color={sig.pcr > 1.1 ? DOWN : sig.pcr < 0.7 ? UP : 'rgba(255,255,255,0.85)'}
          note={sig.pcr > 1.1 ? 'Put 堆积 · 偏悲观' : sig.pcr < 0.7 ? 'Call 偏多' : '均衡'} />
        <Item label="25Δ 偏斜" value={`${sig.rr25 >= 0 ? '+' : ''}${sig.rr25.toFixed(1)}`} color={sig.rr25 < 0 ? DOWN : sig.rr25 > 0 ? UP : MUTE}
          note={sig.rr25 < -3 ? 'Put 贵 · 看跌偏斜' : sig.rr25 > 3 ? 'Call 贵 · 看涨' : '对称'} />
        <Item label="资金费率/年" value={`${sig.funding >= 0 ? '+' : ''}${sig.funding.toFixed(1)}%`} color={sig.funding < 0 ? DOWN : sig.funding > 25 ? YELLOW : UP}
          note={sig.funding < 0 ? '空头付费 · 偏空' : sig.funding > 25 ? '过热预警' : '多头付费'} />
        <Item label="期限斜率" value={`${sig.term >= 0 ? '+' : ''}${sig.term.toFixed(1)}`} color={sig.term < 0 ? DOWN : UP}
          note={sig.term < -2 ? '倒挂 · 近月恐慌' : '正向'} />
      </div>
    </div>
  );
};
