// 行情 tab 重设计卡片：每张只答一个问题，结论先行、形态优先。
// ① MarketHeadlineWidget：现在在哪 + 怎么动（大价 + 24h 涨跌 + 当日区间条 + 关键数）
// ② MarketSignalsWidget：市场倾向（PCR/skew/资金费率/期限 → 一个综合判定 + 四个清晰读数）
import React, { useEffect, useMemo } from 'react';
import { useCardHeader } from '../../components/card/WidgetCard';
import {
  useCoinControl, useDeribitOptions, useTickerSnapshotWS,
  CoinTabs, LiveBadge, type CoinControlProps, type ExpiryGroup,
} from '../../registry/monitorWidgetsBase';

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
    setHeaderRight(<div className="flex items-center gap-2">{live ? <LiveBadge /> : null}<CoinTabs v={coin} set={setCoin} /></div>);
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

// ── ① 行情头条 ──
export const MarketHeadlineWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const ticker = useTickerSnapshotWS(coin);
  const { data } = useDeribitOptions(coin);

  const spot = ticker?.spot ?? data?.spot ?? 0;
  const chg = ticker?.change24hPct ?? 0;
  const hi = ticker?.high24h ?? spot;
  const lo = ticker?.low24h ?? spot;
  const range = hi - lo;
  const pos = range > 1e-6 ? Math.max(0, Math.min(1, (spot - lo) / range)) : 0.5;
  const hasRange = range > 1e-6;
  const dvol = ticker?.dvol ?? data?.dvol30 ?? 0;
  const funding = ticker?.fundingAnn ?? 0;
  const optVol = data ? data.totalOptVol24hUSD / 1e6 : (ticker?.optVol24h_M ?? 0);
  const chgC = chg > 0 ? UP : chg < 0 ? DOWN : MUTE;

  return (
    <div className="w-full h-full flex items-center gap-4 px-3 overflow-x-auto">
      <Header coin={coin} setCoin={setCoin} live={!!ticker} />
      {/* 大价 + 涨跌 */}
      <div className="flex flex-col gap-0.5 shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[30px] font-bold tabular-nums leading-none" style={{ color: chgC }}>{fmtPx(spot)}</span>
          <span className="text-[13px] font-bold tabular-nums" style={{ color: chgC }}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
        </div>
        <span className="text-[9px] text-white/35 uppercase tracking-wider">{coin} 指数 · 24H</span>
      </div>

      {/* 当日区间条 */}
      <div className="flex flex-col gap-1 min-w-[200px] flex-1 max-w-[340px]">
        <div className="flex items-center justify-between text-[10px] tabular-nums text-white/45">
          <span>低 {hasRange ? fmtPx(lo) : '—'}</span>
          <span className="text-white/30">当日区间</span>
          <span>高 {hasRange ? fmtPx(hi) : '—'}</span>
        </div>
        <div className="relative h-2 rounded-full bg-white/[0.07] overflow-hidden">
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pos * 100}%`, background: 'linear-gradient(90deg, rgba(255,95,87,0.4), rgba(40,200,64,0.5))' }} />
          <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-[#111]" style={{ left: `calc(${pos * 100}% - 5px)` }} />
        </div>
        {!hasRange && <span className="text-[9px] text-white/30">24H 高低暂无（等行情推送）</span>}
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
    <div className="flex-1 min-w-[120px] flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-white/[0.03] ring-1 ring-inset ring-white/[0.06]">
      <span className="text-[9px] uppercase tracking-wider text-white/40">{label}</span>
      <span className="text-[17px] font-bold tabular-nums leading-none" style={{ color }}>{value}</span>
      <span className="text-[9px] text-white/40 leading-tight">{note}</span>
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col gap-2 px-3 py-2">
      <Header coin={coin} setCoin={setCoin} live={!!data} />
      {/* 综合倾向 */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-white/40">综合倾向</span>
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
