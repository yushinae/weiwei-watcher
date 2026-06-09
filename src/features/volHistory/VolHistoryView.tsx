import React, { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { FlaskConical } from 'lucide-react';
import { EChart } from '../../components/echart/EChart';
import { useDeribitOptions } from '../../registry/monitorWidgetsBase';
import type { Coin } from '../monitor/types';
import {
  loadSnapshots, computeSnapshot, captureSnapshot, seriesFor, sampleSeries,
  type VolSnapshot,
} from './store';

const BRAND = '#25e889';
const BLUE = '#ff9c2e';
const YELLOW = '#FEBC2E';
const UP = '#28C840';
const DOWN = '#FF5F57';

const COINS: Coin[] = ['BTC', 'ETH'];

const sgn = (v: number) => (v > 0 ? UP : v < 0 ? DOWN : 'rgba(255,255,255,0.5)');
const fmtPp = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

// ── 小组件 ───────────────────────────────────────────────────────────────────

const Pill: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button onClick={onClick}
    className={'px-2.5 h-[26px] rounded-md text-[12px] font-semibold transition-colors duration-[120ms] ' +
      (active ? 'bg-[var(--bb-orange-soft-1)] text-[var(--bb-orange)] ring-1 ring-inset ring-[var(--nexus-accent)]/25' : 'bg-transparent text-white/50 hover:bg-white/[0.07] hover:text-white/80')}>
    {children}
  </button>
);

const StatCard = ({ label, value, color, hint }: { label: string; value: string; color: string; hint: string }) => (
  <div className="flex-1 min-w-[130px] flex flex-col gap-1 px-4 py-3 rounded-[8px] bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)]" title={hint}>
    <span className="text-[10px] uppercase tracking-wider text-white/45">{label}</span>
    <span className="text-[20px] font-bold tabular-nums leading-none" style={{ color }}>{value}</span>
    <span className="text-[10px] text-white/40">{hint}</span>
  </div>
);

const Card = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
  <div className="flex flex-col rounded-[8px] bg-[var(--color-bg-card)] ring-1 ring-inset ring-[var(--color-border-subtle)] shadow-[0_8px_22px_-14px_rgba(0,0,0,0.72)] h-[230px]">
    <div className="flex items-baseline gap-2 px-4 pt-3 pb-1 shrink-0">
      <span className="text-[12px] font-semibold uppercase tracking-[0.02em] text-white/60">{title}</span>
      {sub && <span className="text-[10px] text-white/35">{sub}</span>}
    </div>
    <div className="flex-1 min-h-0 px-2 pb-2">{children}</div>
  </div>
);

// 通用趋势折线
const trendOption = (
  series: VolSnapshot[],
  pick: (s: VolSnapshot) => number,
  color: string,
  unit: string,
  zeroLine: boolean,
): EChartsOption => {
  const xs = series.map(s => s.date.slice(5)); // MM-DD
  const ys = series.map(pick);
  return {
    grid: { left: 8, right: 12, top: 12, bottom: 22, containLabel: true },
    xAxis: {
      type: 'category', data: xs, boundaryGap: false,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 9, hideOverlap: true },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value', scale: true,
      axisLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 9, formatter: (v: number) => `${v}${unit}` },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v: number | string) => (typeof v === 'number' ? `${v.toFixed(2)}${unit}` : String(v)),
    },
    series: [{
      type: 'line', smooth: 0.2, showSymbol: false,
      data: ys.map(v => +v.toFixed(2)),
      lineStyle: { color, width: 2 },
      areaStyle: { color: `${color}1a` }, // hex + 1a ≈ 10% alpha
      ...(zeroLine ? {
        markLine: {
          symbol: 'none', silent: true,
          lineStyle: { color: 'rgba(255,255,255,0.22)', type: 'dashed', width: 1 },
          label: { show: false },
          data: [{ yAxis: 0 }],
        },
      } : {}),
    }],
  };
};

// ── 主视图 ───────────────────────────────────────────────────────────────────

export const VolHistoryView = () => {
  const [coin, setCoin] = useState<Coin>('BTC');
  const { data } = useDeribitOptions(coin);
  const [all, setAll] = useState<VolSnapshot[]>(() => loadSnapshots());

  // 数据到达即记录/覆盖今天这条
  useEffect(() => {
    if (!data) return;
    const snap = computeSnapshot(coin, data);
    if (snap) setAll(captureSnapshot(snap));
  }, [coin, data]);

  const real = useMemo(() => seriesFor(all, coin), [all, coin]);
  const [forceSample, setForceSample] = useState(false);
  const usingSample = forceSample || real.length < 2;
  const series = usingSample ? sampleSeries(coin) : real;
  const cur = series[series.length - 1];

  return (
    <div className="vol-history-page absolute inset-0 overflow-y-auto dash-scroll text-white/85">
      <div className="flex flex-col gap-3 p-3 min-h-full">

        {/* 工具栏 */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.04] ring-1 ring-inset ring-white/[0.05]">
            {COINS.map(c => <Pill key={c} active={coin === c} onClick={() => setCoin(c)}>{c}</Pill>)}
          </div>
          {usingSample ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#FEBC2E]/[0.12] ring-1 ring-inset ring-[#FEBC2E]/30 text-[#FEBC2E] text-[11px] font-semibold">
              <FlaskConical size={13} /> 示例序列{real.length < 2 && `（本地仅 ${real.length} 天，继续每日访问即累积真实历史）`}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#28C840]/[0.12] ring-1 ring-inset ring-[#28C840]/30 text-[#28C840] text-[11px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#28C840]" /> 本地累积 · {real.length} 天
            </span>
          )}
          {real.length >= 2 && (
            <button onClick={() => setForceSample(s => !s)}
              className="px-2.5 py-1 rounded-md bg-white/[0.06] text-white/65 ring-1 ring-inset ring-white/10 text-[11px] font-semibold hover:bg-white/[0.1] transition-colors">
              {forceSample ? '切回本地历史' : '查看示例'}
            </button>
          )}
          <span className="ml-auto text-[11px] text-white/35">每日访问自动记一条 · 偏斜/期限斜率无公开历史，仅本地累积</span>
        </div>

        {/* 当前快照 */}
        {cur && (
          <div className="flex gap-2.5 flex-wrap shrink-0">
            <StatCard label="ATM IV (30D)" value={`${cur.atmIV.toFixed(1)}%`} color="rgba(255,255,255,0.9)" hint="波动率水平" />
            <StatCard label="25Δ 偏斜 (RR)" value={fmtPp(cur.rr25)} color={sgn(cur.rr25)} hint={cur.rr25 < 0 ? '看跌偏斜（put 贵）' : cur.rr25 > 0 ? '看涨偏斜（call 贵）' : '对称'} />
            <StatCard label="期限斜率 (90D−7D)" value={fmtPp(cur.termSlope)} color={sgn(cur.termSlope)} hint={cur.termSlope < 0 ? '倒挂（近月恐慌）' : '正向'} />
            <StatCard label="25Δ 蝶式 (BF)" value={cur.bf25.toFixed(1)} color="rgba(255,255,255,0.9)" hint="微笑凸度" />
          </div>
        )}

        {/* 趋势图 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card title="ATM IV 趋势" sub="30D 平值隐含波动率">
            <EChart option={trendOption(series, s => s.atmIV, BRAND, '%', false)} notMerge />
          </Card>
          <Card title="25Δ 偏斜趋势 (Risk Reversal)" sub="负=看跌偏斜，越负越贵 put">
            <EChart option={trendOption(series, s => s.rr25, BLUE, '', true)} notMerge />
          </Card>
          <Card title="期限结构斜率趋势" sub="90D − 7D ATM IV，跌破 0 = 倒挂">
            <EChart option={trendOption(series, s => s.termSlope, YELLOW, '', true)} notMerge />
          </Card>
          <Card title="25Δ 蝶式趋势 (Butterfly)" sub="微笑两翼相对凸度">
            <EChart option={trendOption(series, s => s.bf25, '#a78bfa', '', false)} notMerge />
          </Card>
        </div>

        <div className="text-[10px] text-white/35 leading-relaxed shrink-0">
          说明：ATM IV 水平另有 Deribit DVOL 历史可参考；而 25Δ 偏斜、期限斜率、蝶式**没有公开的逐日历史源**，
          本页从今天起每日访问时各记录一条，越用历史越长。示例序列仅用于演示图形形态。
        </div>
      </div>
    </div>
  );
};

export default VolHistoryView;
