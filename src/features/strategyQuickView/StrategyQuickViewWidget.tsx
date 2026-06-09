// ═══════════════════════════════════════════════════════════════════════════════
// 策略速查卡 Widget — 5种策略：选策略、调参数、看盈亏图
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo, useEffect } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Activity } from 'lucide-react';
import { EChart } from '../../components/echart/EChart';
import { Tile } from '../../components/card/Tile';
import type { Coin } from '../../features/monitor/types';
import { useDeribitOptions, useTickerSnapshotWS } from '../../registry/monitorWidgetsBase';
import {
  calculateStrategy,
  type StrategyType,
  STRATEGY_METAS,
  getStrategyMeta,
  getStrategyParams,
  defaultStrikes,
} from './strategyLogic';

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

function fmtDollar(v: number) {
  if (!isFinite(v)) return v > 0 ? '+∞' : '-∞';
  const absV = Math.abs(v);
  const sign = v >= 0 ? '+' : '-';
  if (absV >= 1000) return `${sign}$${(absV / 1000).toFixed(1)}K`;
  return `${sign}$${absV.toFixed(0)}`;
}

const fmtPx = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// ── 策略简短标签 ──

const STRATEGY_LABELS: Record<string, string> = {
  'long-call': 'Long Call (买入看涨)',
  'long-put': 'Long Put (买入看跌)',
  'bear-call-spread': 'Bear Call (熊市价差)',
  'bull-put-spread': 'Bull Put (牛市价差)',
  'iron-condor': 'Iron Condor (铁鹰策略)',
  'naked-put': 'Naked Put (裸卖Put)',
  'short-strangle': 'Short Strangle (宽跨式)',
  'short-straddle': 'Short Straddle (跨式)',
  'call-debit-spread': 'Call Debit (看涨价差)',
  'put-debit-spread': 'Put Debit (看跌价差)',
};

// ── 原始样式 Stepper（h-28 rounded-lg，标签在上） ──

function Stepper({ value, onChange, step = 1000, min = 1000, max = 200000, label }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; label: string;
}) {
  return (
    <label className="flex flex-col gap-0.5 shrink-0">
      <span className="text-[10px] text-white/55 font-medium">{label}</span>
      <div className="flex items-center h-[28px] rounded-lg bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)] overflow-hidden">
        <button onClick={() => onChange(Math.max(min, value - step))}
          className="w-6 h-full flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-[var(--color-surface-5)] transition-colors text-[13px] shrink-0"
        >−</button>
        <input type="text" value={value.toLocaleString('en-US')}
          onChange={(e) => { const n = parseInt(e.target.value.replace(/,/g, '')); if (!isNaN(n) && n >= min && n <= max) onChange(n); }}
          className="w-[64px] h-full bg-transparent text-center text-[13px] font-bold tabular-nums text-white/85 outline-none"
        />
        <button onClick={() => onChange(Math.min(max, value + step))}
          className="w-6 h-full flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-[var(--color-surface-5)] transition-colors text-[13px] shrink-0"
        >+</button>
      </div>
    </label>
  );
}

// ── Qty Stepper（原始样式） ──

function QtyStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-0.5 shrink-0 min-w-[48px]">
      <span className="text-[10px] text-white/55 font-medium">数量</span>
      <div className="flex items-center h-[28px] rounded-lg bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)] overflow-hidden">
        <button onClick={() => onChange(Math.max(1, value - 1))}
          className="w-6 h-full flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-[var(--color-surface-5)] transition-colors text-[13px] shrink-0"
        >−</button>
        <span className="w-6 text-center text-[13px] font-bold tabular-nums text-white/85">{value}</span>
        <button onClick={() => onChange(Math.min(100, value + 1))}
          className="w-6 h-full flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-[var(--color-surface-5)] transition-colors text-[13px] shrink-0"
        >+</button>
      </div>
    </label>
  );
}

// ── Select 组件（原始样式，标签在上） ──

function Select<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5 shrink-0">
      <span className="text-[10px] text-white/55 font-medium">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}
        className="h-[28px] rounded-lg bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)] text-[12px] text-white/80 font-medium px-2 outline-none appearance-none cursor-pointer hover:bg-[var(--color-surface-5)] transition-colors"
      >
        {options.map(o => (
          <option key={o.value} value={o.value} className="bg-[var(--color-surface-2)] text-white/80">{o.label}</option>
        ))}
      </select>
    </label>
  );
}

// ── Greeks 标签 ──

function GreekBadge({ label, value, fmt, color }: {
  label: string; value: number; fmt: (v: number) => string; color: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--color-surface-2)] text-[10px] font-semibold tabular-nums" style={{ color }}>
      <span className="text-white/40">{label}</span>
      {fmt(value)}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════════════════════

export default function StrategyQuickViewWidget({ coin }: { coin: Coin }) {
  const { data: opt } = useDeribitOptions(coin);
  const ticker = useTickerSnapshotWS(coin);
  const spot = ticker?.spot ?? opt?.spot ?? 0;
  const expiries = useMemo(() => opt?.expiries ?? [], [opt?.expiries]);

  // ── 状态 ──
  const [strategyType, setStrategyType] = useState<StrategyType>('bear-call-spread');
  const [qty, setQty] = useState(1);
  const [expiryLabel, setExpiryLabel] = useState('');

  // Auto-select nearest expiry ≥2d
  useEffect(() => {
    const nearest = expiries.filter(e => e.daysToExp >= 2)[0];
    if (nearest && !expiryLabel) setExpiryLabel(nearest.label);
  }, [expiries, expiryLabel]);

  const meta = useMemo(() => getStrategyMeta(strategyType), [strategyType]);
  const paramDefs = useMemo(() => getStrategyParams(strategyType), [strategyType]);

  // 行权价状态数组
  const initialStrikes = useMemo(() => paramDefs.map(() => 0), [paramDefs]);
  const [strikes, setStrikes] = useState<number[]>(initialStrikes);

  // Sync defaults when strategy or spot changes
  useEffect(() => {
    if (spot > 0) setStrikes(defaultStrikes(strategyType, spot));
  }, [strategyType, spot]);

  const setStrike = (idx: number, val: number) => {
    const next = [...strikes];
    next[idx] = val;
    setStrikes(next);
  };

  // ── 计算 ──
  const selectedExpiry = expiries.find(e => e.label === expiryLabel);
  const expiryT = selectedExpiry ? selectedExpiry.daysToExp / 365 : 7 / 365;
  const atmIV = selectedExpiry?.atmIV ?? 35;

  const result = useMemo(() => {
    if (!spot || spot <= 0 || strikes.some(s => s <= 0)) return null;
    return calculateStrategy({
      type: strategyType, spot, strikes,
      expiryT, iv: atmIV, qty,
    });
  }, [strategyType, spot, strikes, expiryT, atmIV, qty]);

  // ── ECharts ──
  const chartOption = useMemo(() => {
    if (!result || !result.payoff.length) return null;
    const { payoff, breakevens } = result;

    const pnls = payoff.map(p => p.pnl);
    const allPnl = [...pnls, ...(result.maxProfit !== Infinity ? [result.maxProfit] : [])];
    if (result.maxLoss !== -Infinity) allPnl.push(result.maxLoss);
    const maxAbs = Math.max(...allPnl.map(Math.abs), 1);
    const yPad = maxAbs * 0.15;
    const yMin = -maxAbs - yPad;
    const yMax = maxAbs + yPad;

    const colors = payoff.map(p => p.pnl >= 0 ? 'var(--color-trade-up)' : 'var(--color-trade-down)');

    return {
      animation: true, animationDuration: 400, animationEasing: 'cubicOut',
      grid: { left: 50, right: 14, top: 16, bottom: 28 },
      xAxis: {
        type: 'value', min: payoff[0].price, max: payoff[payoff.length - 1].price,
        axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toString() },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } }, splitLine: { show: false }, axisTick: { show: false },
      },
      yAxis: {
        type: 'value', min: yMin, max: yMax,
        axisLabel: {
          color: 'rgba(255,255,255,0.35)', fontSize: 9,
          formatter: (v: number) => v >= 0 ? `+${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toFixed(0)}` : `${v >= -1000 ? v.toFixed(0) : `${(v / 1000).toFixed(0)}K`}`,
        },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } }, axisTick: { show: false },
      },
      series: [
        { type: 'line', data: [[payoff[0].price, 0], [payoff[payoff.length - 1].price, 0]],
          lineStyle: { color: 'rgba(255,255,255,0.12)', width: 1, type: 'dashed' as const }, symbol: 'none', silent: true, z: 0 },
        ...breakevens.filter(b => b > 0 && !isNaN(b)).map((be) => ({
          type: 'line' as const,
          data: [[be, yMin], [be, yMax]],
          lineStyle: { color: 'rgba(254,188,46,0.4)', width: 1, type: 'dotted' as const },
          symbol: 'none', silent: true, z: 1,
          label: { show: true, formatter: `BE ${fmtPx(be)}`, color: 'rgba(254,188,46,0.6)', fontSize: 8, position: 'end' as const },
        })),
        {
          type: 'line', smooth: 0.2, symbol: 'none', lineStyle: { width: 2.5 }, z: 2,
          data: payoff.map((p, i) => ({ value: [p.price, p.pnl], itemStyle: { color: colors[i] } })),
          areaStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(40,200,64,0.08)' },
                { offset: 0.45, color: 'rgba(255,255,255,0)' },
                { offset: 0.55, color: 'rgba(255,255,255,0)' },
                { offset: 1, color: 'rgba(255,95,87,0.08)' },
              ],
            },
          },
        },
      ],
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          const p = params?.[params.length - 1];
          if (!p || p.seriesName) return '';
          const price = p.value?.[0];
          const pnl = p.value?.[1];
          if (price == null || pnl == null) return '';
          const color = pnl >= 0 ? '#28C840' : '#FF5F57';
          return `<div style="font-size:11px"><div style="color:rgba(255,255,255,0.5)">价格</div>
<div style="font-size:15px;font-weight:700;margin:2px 0">${fmtPx(price)}</div>
<div style="color:${color};font-weight:600">PnL: ${fmtDollar(pnl)}</div></div>`;
        },
        extraCssText: 'border-radius: 10px; background: #181B21; border: 1px solid rgba(168,184,206,0.10);',
      },
    };
  }, [result]);

  // ── Loading ──
  if (!spot || spot <= 0) {
    return <div className="flex items-center justify-center h-full text-[11px] text-white/45">等待行情数据...</div>;
  }

  const selectableExpiries = expiries
    .filter(e => e.daysToExp >= 1 && e.daysToExp <= 60)
    .slice(0, 10)
    .map(e => ({
      value: e.label,
      label: `${e.label} (${e.daysToExp}d, IV ${e.atmIV.toFixed(1)}%)`,
    }));

  return (
    <div className="flex flex-col h-full gap-2.5">
      {/* ── 一行控制栏 ── */}
      <div className="flex items-end gap-3 flex-wrap shrink-0">
        <Select label="策略" value={strategyType}
          options={STRATEGY_METAS.map(m => ({ value: m.type, label: STRATEGY_LABELS[m.type] }))}
          onChange={(v) => setStrategyType(v as StrategyType)}
        />
        <Select label="到期" value={expiryLabel}
          options={selectableExpiries.length > 0 ? selectableExpiries : [{ value: '—', label: '—' }]}
          onChange={setExpiryLabel}
        />
        <span className="text-[11px] font-semibold mb-[10px] ml-0.5"
          style={{ color: meta?.isBullish === null ? '#FEBC2E' : meta?.isBullish ? '#28C840' : '#FF5F57' }}>
          {meta?.isBullish === null ? '～' : meta?.isBullish ? '↑' : '↓'}
        </span>
        {paramDefs.map((p, i) => (
          <React.Fragment key={p.id}>
            <Stepper label={p.shortLabel} value={strikes[i] || 0}
              onChange={(v) => setStrike(i, v)} step={p.step ?? 1000}
            />
          </React.Fragment>
        ))}
        <QtyStepper value={qty} onChange={setQty} />
        {result && (
          <div className="flex items-end h-[28px] ml-auto mb-0">
            <span className="text-[12px] font-semibold tabular-nums text-white/55">
              Δ {result.delta >= 0 ? '+' : ''}{result.delta.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* ── Chart + Metrics ── */}
      <div className="flex-1 grid grid-cols-12 gap-2.5 min-h-0">
        <div className="col-span-8 bg-[var(--color-surface-1)] rounded-lg ring-1 ring-inset ring-[var(--color-border-subtle)] min-h-0">
          {chartOption && <EChart option={chartOption} />}
        </div>

        <div className="col-span-4 flex flex-col gap-1.5">
          <Tile className="flex-1 flex flex-col justify-center p-2.5">
            <div className="flex items-center gap-1.5 mb-0.5">
              <TrendingUp size={11} className="text-trade-up" />
              <span className="text-[10px] text-white/55">最大盈利</span>
            </div>
            <span className="text-[20px] font-bold tabular-nums tracking-[-0.02em]"
              style={{ color: result && result.maxProfit === Infinity ? 'var(--color-sev-mid)' : 'var(--color-trade-up)' }}>
              {result ? (result.maxProfit === Infinity ? '+∞' : fmtDollar(result.maxProfit)) : '—'}
            </span>
          </Tile>
          <Tile className="flex-1 flex flex-col justify-center p-2.5">
            <div className="flex items-center gap-1.5 mb-0.5">
              <TrendingDown size={11} className="text-trade-down" />
              <span className="text-[10px] text-white/55">最大亏损</span>
            </div>
            <span className="text-[20px] font-bold tabular-nums tracking-[-0.02em] text-trade-down">
              {result ? (result.maxLoss === -Infinity ? '-∞' : fmtDollar(result.maxLoss)) : '—'}
            </span>
          </Tile>
          <Tile className="flex-1 flex flex-col justify-center p-2.5">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Activity size={11} className="text-white/55" />
              <span className="text-[10px] text-white/55">盈亏平衡</span>
            </div>
            <span className="text-[14px] font-bold tabular-nums tracking-[-0.02em] text-white/85">
              {result ? result.breakevens.filter(b => b > 0).map(b => fmtPx(b)).join(' / ') : '—'}
            </span>
          </Tile>
          <Tile className="flex-1 flex flex-col justify-center p-2.5">
            <div className="flex items-center gap-1.5 mb-0.5">
              <DollarSign size={11} className="text-white/55" />
              <span className="text-[10px] text-white/55">权利金</span>
            </div>
            <span className="text-[14px] font-bold tabular-nums tracking-[-0.02em]"
              style={{ color: result ? (result.costOrCredit >= 0 ? 'var(--color-trade-up)' : 'var(--color-trade-down)') : 'white' }}>
              {result ? fmtDollar(result.costOrCredit) : '—'}
            </span>
          </Tile>
        </div>
      </div>

      {/* ── Greeks Bar ── */}
      {result && (
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <GreekBadge label="Δ" value={result.delta} fmt={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`} color="var(--color-trade-down)" />
          <GreekBadge label="Γ" value={result.gamma} fmt={(v) => v.toFixed(4)} color="var(--color-sev-mid)" />
          <GreekBadge label="Θ" value={result.theta} fmt={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`} color={result.theta >= 0 ? 'var(--color-trade-up)' : 'var(--color-trade-down)'} />
          <GreekBadge label="V" value={result.vega} fmt={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`} color="var(--color-sev-high)" />
          <span className="ml-auto text-[10px] text-white/35 font-mono">
            {coin} · IV {atmIV.toFixed(1)}% · {(expiryT * 365).toFixed(0)}d
          </span>
        </div>
      )}
    </div>
  );
}
