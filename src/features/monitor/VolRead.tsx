// 波动率 tab 重构：分层阅读 = 结论条 + 形态曲线（微笑/期限+偏斜）。实时优先（用 useDeribitOptions
// 的实时期权数据；IV Rank 来自历史、拿不到就降级显示「—」而非整块失败）。
import React, { useEffect, useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { EChart } from '../../components/echart/EChart';
import { useCardHeader } from '../../components/card/WidgetCard';
import {
  useCoinControl, useDeribitOptions, useDeribitHistory, SmileChartLive,
  CoinLabel,
  type CoinControlProps, type ExpiryGroup,
} from '../../registry/monitorWidgetsBase';

const UP = '#28C840';
const DOWN = '#FF5F57';
const BRAND = 'rgba(37,232,137,0.92)';
const YELLOW = '#FEBC2E';

// 取最接近 target 天的到期
function pick(arr: ExpiryGroup[], target: number): ExpiryGroup | undefined {
  if (!arr.length) return undefined;
  return arr.reduce((best, e) => (Math.abs(e.daysToExp - target) < Math.abs(best.daysToExp - target) ? e : best));
}

// ── 结论条：一眼读懂当前波动率环境 + 一句话建议 ──
export const VolHeadlineWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data } = useDeribitOptions(coin);
  const { data: hist } = useDeribitHistory(coin);
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(<CoinLabel coin={coin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  const m30 = data ? pick(data.expiries, 30) : undefined;
  const near = data?.expiries.find(e => e.daysToExp >= 6);
  const far = data ? pick(data.expiries, 90) : undefined;
  const dvol = data?.dvol30 ?? 0;
  const ivRank = hist?.ivRankCurrent;
  const atmIV = m30?.atmIV ?? dvol;
  const rr25 = m30?.rr25 ?? 0;
  const termSlope = far && near ? far.atmIV - near.atmIV : 0;
  const em = atmIV > 0 ? (atmIV * Math.sqrt(30 / 365) * Math.sqrt(2 / Math.PI)) : 0;

  // 一句话判定
  const ivPart = ivRank == null ? 'IV 中性'
    : ivRank >= 70 ? 'IV 高位 → 偏卖方、谨慎裸卖 Vega'
    : ivRank <= 30 ? 'IV 低位 → 偏买方 / 日历价差'
    : 'IV 中位 → 双向均可';
  const skewPart = rr25 <= -4 ? '看跌偏斜重（put 贵）→ risk-reversal / 卖 put'
    : rr25 >= 4 ? '看涨偏斜（call 贵）' : '';
  const termPart = termSlope <= -2 ? '· 期限倒挂（近月恐慌）' : termSlope >= 2 ? '· 期限正向' : '';
  const verdict = [ivPart, skewPart].filter(Boolean).join(' · ') + ' ' + termPart;

  const Stat = ({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) => (
    <div className="flex flex-col gap-0.5 px-3 shrink-0">
      <span className="text-[9px] uppercase tracking-wider text-white/40">{label}</span>
      <span className="text-[18px] font-bold tabular-nums leading-none" style={{ color }}>{value}</span>
      {sub && <span className="text-[9px] text-white/35">{sub}</span>}
    </div>
  );
  const ivc = ivRank == null ? 'rgba(255,255,255,0.85)' : ivRank >= 70 ? DOWN : ivRank <= 30 ? UP : YELLOW;

  return (
    <div className="w-full h-full flex items-center gap-1 px-2 overflow-x-auto">
      <Stat label="IV Rank" value={ivRank != null ? `${ivRank.toFixed(0)}` : '—'} color={ivc} sub="52周百分位" />
      <div className="w-px h-8 bg-white/[0.08]" />
      <Stat label="DVOL" value={`${dvol.toFixed(1)}%`} color="rgba(255,255,255,0.85)" sub="实时" />
      <Stat label="30d 预期" value={`±${em.toFixed(1)}%`} color="rgba(255,255,255,0.7)" />
      <Stat label="25Δ 偏斜" value={`${rr25 >= 0 ? '+' : ''}${rr25.toFixed(1)}`} color={rr25 < 0 ? DOWN : rr25 > 0 ? UP : 'rgba(255,255,255,0.6)'} sub={rr25 < 0 ? '看跌' : rr25 > 0 ? '看涨' : '对称'} />
      <Stat label="期限斜率" value={`${termSlope >= 0 ? '+' : ''}${termSlope.toFixed(1)}`} color={termSlope < 0 ? DOWN : UP} sub={termSlope < 0 ? '倒挂' : '正向'} />
      <div className="flex-1 min-w-[180px] flex items-center px-3">
        <span className="text-[12px] leading-snug text-white/65">
          <span className="text-white/40">判定: </span><em className="not-italic font-semibold text-white/85">{verdict}</em>
        </span>
      </div>
    </div>
  );
};

// ── 微笑曲线（按 delta，一条线一个到期）——读形态 ──
export const VolSmileCurveWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(<CoinLabel coin={coin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);
  return (
    <div className="w-full h-full px-2 pb-1">
      <SmileChartLive expiries={data?.expiries ?? []} />
    </div>
  );
};

// ── 期限结构 + 偏斜曲线（ATM IV 折线 + RR25 折线，按到期）——读期限/偏斜形态 ──
export const VolTermWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(<CoinLabel coin={coin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  const option = useMemo<EChartsOption | null>(() => {
    const exp = (data?.expiries ?? []).filter(e => e.daysToExp >= 1 && e.daysToExp <= 200).slice(0, 8);
    if (exp.length < 2) return null;
    const labels = exp.map(e => e.label);
    return {
      grid: { left: 36, right: 40, top: 28, bottom: 24, containLabel: true },
      legend: { data: [{ name: 'ATM IV', icon: 'roundRect' }, { name: '25Δ RR', icon: 'line' }], textStyle: { color: 'rgba(255,255,255,0.5)', fontSize: 10 }, right: 8, top: 0 },
      xAxis: { type: 'category', data: labels, boundaryGap: false, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } }, axisLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 9 }, axisTick: { show: false } },
      yAxis: [
        { type: 'value', scale: true, axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, formatter: (v: number) => `${v.toFixed(0)}%` }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } } },
        { type: 'value', scale: true, axisLabel: { color: YELLOW, fontSize: 9, formatter: (v: number) => v.toFixed(0) }, splitLine: { show: false } },
      ],
      tooltip: { trigger: 'axis' },
      series: [
        { name: 'ATM IV', type: 'line', smooth: 0.3, symbol: 'circle', symbolSize: 6, data: exp.map(e => +e.atmIV.toFixed(1)), lineStyle: { color: BRAND, width: 2 }, itemStyle: { color: BRAND }, areaStyle: { color: 'rgba(37,232,137,0.08)' }, label: { show: true, position: 'top', fontSize: 9, color: BRAND, formatter: (p: { value: number }) => p.value.toFixed(0) } },
        { name: '25Δ RR', type: 'line', yAxisIndex: 1, smooth: 0.3, symbol: 'circle', symbolSize: 5, data: exp.map(e => +e.rr25.toFixed(2)), lineStyle: { color: YELLOW, width: 1.5, type: 'dashed' }, itemStyle: { color: YELLOW }, markLine: { symbol: 'none', silent: true, lineStyle: { color: 'rgba(255,255,255,0.15)', type: 'dotted' }, data: [{ yAxis: 0 }] } },
      ],
    };
  }, [data]);

  if (!option) return <div className="w-full h-full flex items-center justify-center text-[11px] text-white/45">加载中…</div>;
  return <div className="w-full h-full px-1 pb-1"><EChart option={option} /></div>;
};
