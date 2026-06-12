// 资金流 tab 的「资金面速读」结论条 —— 把 资金费率 + 期货升贴水 + 期权买盘方向 + 持仓量24h变化
// 综合成一句话(资金面偏多/偏空/中性/多头杠杆拥挤)。结论先行，给下面三张裸图一个结论层。
// OI 24h 变化来自本地快照累积(oiSnapshot.ts)，不足 24h 时显示「积累中」。
import React, { useEffect, useMemo } from 'react';
import { useCardHeader } from '../../components/card/WidgetCard';
import {
  useCoinControl, useDeribitOptions, useFlowData, useFuturesBasis,
  CoinLabel, type CoinControlProps,
} from '../../registry/monitorWidgetsBase';
import { recordOISnapshot, getOIChange24h } from './oiSnapshot';

const UP = '#24AE64';
const DOWN = '#EF454A';
const YELLOW = '#FF9C2E';
const MUTE = 'rgba(255,255,255,0.55)';

export const FlowHeadlineWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: flow } = useFlowData(coin);
  const { data: opt } = useDeribitOptions(coin);
  const wsBasis = useFuturesBasis(coin);
  const { setHeaderRight } = useCardHeader();
  const live = !!(flow || opt);
  useEffect(() => {
    setHeaderRight(<CoinLabel coin={coin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, live]);

  // OI 聚合 + 快照
  const oiAgg = useMemo(() => {
    if (!opt) return null;
    let callOI = 0, putOI = 0;
    for (const e of opt.expiries) {
      for (const c of e.calls) callOI += c.oi;
      for (const p of e.puts) putOI += p.oi;
    }
    const totalOI = opt.totalOptOI > 0 ? opt.totalOptOI : callOI + putOI;
    return { totalOI, callOI, putOI };
  }, [opt]);
  useEffect(() => {
    if (oiAgg) recordOISnapshot(coin, oiAgg);
  }, [coin, oiAgg]);
  const oiChg = oiAgg ? getOIChange24h(coin, oiAgg.totalOI) : null;

  const funding = flow?.annFunding ?? 0;
  // 基差来自实时 WS（useFuturesBasis 已按到期升序），取最近月。
  const frontBasis = wsBasis.length ? wsBasis[0] : undefined;
  const basis = frontBasis?.annBasis ?? 0;
  const pcVol = opt && opt.callVol24h > 0 ? opt.putVol24h / opt.callVol24h : 0;

  // 综合判定（verdict 只列真正触发的信号，不写死）
  const lean = useMemo(() => {
    const overheat = funding > 25 || basis > 30;
    const reasons: string[] = [];
    let s = 0;
    if (funding > 25) reasons.push('资金费率过热');
    else if (funding > 2) { reasons.push('多头付费'); s += 1; }
    else if (funding < -2) { reasons.push('空头付费'); s -= 1; }
    if (basis > 30) reasons.push('升水极高');
    else if (basis > 5) { reasons.push('期货升水'); s += 1; }
    else if (basis < -2) { reasons.push('期货贴水'); s -= 1; }
    if (pcVol > 1.3) { reasons.push('看跌买盘'); s -= 1; }
    else if (pcVol > 0 && pcVol < 0.7) { reasons.push('看涨买盘'); s += 1; }

    const t = overheat ? '多头杠杆拥挤' : s >= 2 ? '偏多' : s <= -2 ? '偏空' : '中性';
    const c = overheat ? YELLOW : s >= 2 ? UP : s <= -2 ? DOWN : YELLOW;
    const head = reasons.length ? reasons.join(' / ') : '资金费率与基差温和、买卖盘均衡';
    const v = head + (overheat ? ' → 多头杠杆拥挤，警惕回调踩踏' : ` → 资金面${t}`);
    return { t, c, v };
  }, [funding, basis, pcVol]);

  const Stat = ({ label, value, color = 'rgba(255,255,255,0.88)', sub, subColor }:
    { label: string; value: string; color?: string; sub?: string; subColor?: string }) => (
    <div className="flex flex-col gap-0.5 px-3 shrink-0">
      <span className="text-[9px] uppercase tracking-wider text-white/40">{label}</span>
      <span className="text-[18px] font-bold tabular-nums leading-none" style={{ color }}>{value}</span>
      {sub && <span className="text-[9px]" style={{ color: subColor ?? 'rgba(255,255,255,0.35)' }}>{sub}</span>}
    </div>
  );

  const oiSub = oiChg
    ? (oiChg.pct >= 0 ? '建仓 · 资金流入' : '平仓 · 资金流出')
    : '积累中（需~24h）';
  const oiVal = oiChg ? `${oiChg.pct >= 0 ? '+' : ''}${oiChg.pct.toFixed(1)}%` : '—';

  return (
    <div className="monitor-headline-strip w-full h-full flex items-center gap-1 px-2 overflow-x-auto">
      <Stat label="资金面" value={lean.t} color={lean.c} sub="综合判定" subColor="rgba(255,255,255,0.35)" />
      <div className="w-px h-8 bg-white/[0.08]" />
      <Stat label="资金费率/年" value={`${funding >= 0 ? '+' : ''}${funding.toFixed(1)}%`}
        color={funding > 25 ? YELLOW : funding >= 0 ? UP : DOWN}
        sub={funding > 25 ? '过热' : funding >= 0 ? '多头付费' : '空头付费'} />
      <Stat label="期货升贴水/年" value={`${basis >= 0 ? '+' : ''}${basis.toFixed(1)}%`}
        color={Math.abs(basis) < 0.5 ? MUTE : basis >= 0 ? UP : DOWN}
        sub={frontBasis ? `${Math.abs(basis) < 0.5 ? '持平' : basis >= 0 ? '升水' : '贴水'} · ${frontBasis.daysToExp}天` : '—'} />
      <Stat label="看跌/看涨成交" value={pcVol > 0 ? pcVol.toFixed(2) : '—'}
        color={pcVol > 1.3 ? DOWN : pcVol > 0 && pcVol < 0.7 ? UP : MUTE}
        sub={pcVol > 1.3 ? '看跌买盘多' : pcVol > 0 && pcVol < 0.7 ? '看涨买盘多' : '均衡'} />
      <Stat label="持仓量 24h" value={oiVal} color={oiChg ? (oiChg.pct >= 0 ? UP : DOWN) : MUTE} sub={oiSub} />
      <div className="w-px h-8 bg-white/[0.08]" />
      <div className="flex-1 min-w-[200px] flex items-center px-3">
        <span className="text-[12px] leading-snug text-white/65">
          <span className="text-white/40">判定: </span><em className="not-italic font-semibold text-white/85">{lean.v}</em>
        </span>
      </div>
    </div>
  );
};
