import React, { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { Plus, Trash2, FlaskConical } from 'lucide-react';
import { EChart } from '../../components/echart/EChart';
import { STRATEGIES, JOURNAL_COINS, type JournalTrade, type TradeStatus } from './types';
import {
  loadTrades, saveTrades, newId, computeStats, buildEquityCurve, sampleTrades,
} from './store';

const UP = '#28C840';
const DOWN = '#FF5F57';
const MUTE = 'rgba(255,255,255,0.5)';

const TODAY = new Date().toISOString().slice(0, 10);

const fmtUsd = (v: number) => {
  const s = Math.abs(v) >= 1000 ? Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
                                : Math.abs(v).toFixed(0);
  return `${v < 0 ? '-' : v > 0 ? '+' : ''}$${s}`;
};
const pnlColor = (v: number) => (v > 0 ? UP : v < 0 ? DOWN : MUTE);

// ── 小组件 ───────────────────────────────────────────────────────────────────

const StatCard = ({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) => (
  <div className="flex-1 min-w-[150px] flex flex-col gap-1 px-4 py-3 rounded-xl bg-white/[0.03] ring-1 ring-inset ring-white/[0.06]">
    <span className="text-[10px] uppercase tracking-wider text-white/45">{label}</span>
    <span className="text-[22px] font-bold tabular-nums leading-none">{children}</span>
    {sub && <span className="text-[11px] text-white/45 mt-0.5">{sub}</span>}
  </div>
);

const Card = ({ title, right, children, className = '' }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <div className={`flex flex-col rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.06] ${className}`}>
    <div className="flex items-center px-4 pt-3 pb-2 shrink-0">
      <span className="text-[12px] font-semibold uppercase tracking-[0.02em] text-white/60">{title}</span>
      {right && <div className="ml-auto">{right}</div>}
    </div>
    <div className="flex-1 min-h-0 px-3 pb-3">{children}</div>
  </div>
);

const inputCls = 'h-[30px] px-2 rounded-md bg-white/[0.05] ring-1 ring-inset ring-white/[0.08] text-[12px] text-white/85 outline-none focus:ring-white/20';

// ── 主视图 ───────────────────────────────────────────────────────────────────

export const JournalView = () => {
  const [trades, setTrades] = useState<JournalTrade[]>([]);

  useEffect(() => { setTrades(loadTrades()); }, []);
  const update = (next: JournalTrade[]) => { setTrades(next); saveTrades(next); };

  const stats = useMemo(() => computeStats(trades), [trades]);
  const equity = useMemo(() => buildEquityCurve(trades), [trades]);

  // 新增交易草稿
  const [draft, setDraft] = useState({
    coin: 'BTC', strategy: STRATEGIES[2] as string, status: 'closed' as TradeStatus,
    openDate: TODAY, closeDate: TODAY, pnl: '', notes: '',
  });
  const setD = (patch: Partial<typeof draft>) => setDraft(d => ({ ...d, ...patch }));

  const addTrade = () => {
    const t: JournalTrade = {
      id: newId(),
      coin: draft.coin,
      strategy: draft.strategy,
      status: draft.status,
      openDate: draft.openDate || TODAY,
      closeDate: draft.status === 'closed' ? (draft.closeDate || TODAY) : undefined,
      pnl: draft.status === 'closed' ? Number(draft.pnl) || 0 : 0,
      notes: draft.notes.trim() || undefined,
    };
    update([t, ...trades]);
    setD({ pnl: '', notes: '' });
  };

  const remove = (id: string) => update(trades.filter(t => t.id !== id));

  // ── 净值曲线 option ──
  const equityOption = useMemo<EChartsOption>(() => {
    if (equity.length < 2) return {};
    const last = equity[equity.length - 1].cum;
    const col = last >= 0 ? UP : DOWN;
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 24, containLabel: true },
      xAxis: {
        type: 'category', data: equity.map(p => p.date), boundaryGap: false,
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
        axisLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 10, hideOverlap: true },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value', scale: true,
        axisLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 10, formatter: (v: number) => fmtUsd(v) },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      },
      series: [{
        type: 'line', smooth: 0.2, showSymbol: false,
        data: equity.map(p => +p.cum.toFixed(2)),
        lineStyle: { color: col, width: 2 },
        areaStyle: { color: last >= 0 ? 'rgba(40,200,64,0.12)' : 'rgba(255,95,87,0.12)' },
        markLine: {
          symbol: 'none', silent: true,
          lineStyle: { color: 'rgba(255,255,255,0.18)', type: 'dashed', width: 1 },
          data: [{ yAxis: 0 }],
        },
      }],
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const arr = params as Array<{ dataIndex: number; axisValue: string }>;
          const i = arr[0]?.dataIndex ?? 0;
          const p = equity[i];
          if (!p) return '';
          return `<div style="font-weight:bold;margin-bottom:3px">${p.date}</div>` +
            `<div>当日 <b style="color:${pnlColor(p.day)}">${fmtUsd(p.day)}</b></div>` +
            `<div>累计 <b style="color:${pnlColor(p.cum)}">${fmtUsd(p.cum)}</b></div>`;
        },
      },
    };
  }, [equity]);

  // ── 策略盈亏 option ──
  const strategyOption = useMemo<EChartsOption>(() => {
    const bs = stats.byStrategy;
    if (!bs.length) return {};
    return {
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 10, formatter: (v: number) => fmtUsd(v) },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      },
      yAxis: {
        type: 'category', inverse: true, data: bs.map(s => s.strategy),
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
        axisLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11 },
        axisTick: { show: false },
      },
      series: [{
        type: 'bar', barWidth: '58%',
        data: bs.map(s => ({
          value: +s.pnl.toFixed(0),
          itemStyle: { color: s.pnl >= 0 ? 'rgba(40,200,64,0.55)' : 'rgba(255,95,87,0.55)', borderRadius: [0, 3, 3, 0] },
        })),
        label: {
          show: true, position: 'right', fontSize: 10,
          color: 'rgba(255,255,255,0.65)',
          formatter: (p: { value: number; dataIndex: number }) => `${fmtUsd(p.value)} · ${bs[p.dataIndex].count}笔`,
        },
      }],
      tooltip: {
        trigger: 'item',
        formatter: (p: unknown) => {
          const { dataIndex } = p as { dataIndex: number };
          const s = bs[dataIndex];
          return `<b>${s.strategy}</b><br/>盈亏 <b style="color:${pnlColor(s.pnl)}">${fmtUsd(s.pnl)}</b><br/>` +
            `${s.count} 笔 · 胜率 ${(s.winRate * 100).toFixed(0)}%`;
        },
      },
    };
  }, [stats.byStrategy]);

  const empty = trades.length === 0;
  const pf = stats.profitFactor;

  return (
    <div className="absolute inset-0 overflow-y-auto dash-scroll text-white/85">
      <div className="flex flex-col gap-3 p-3 min-h-full">

        {/* ── 统计卡 ── */}
        <div className="flex gap-2.5 flex-wrap shrink-0">
          <StatCard label="累计已实现盈亏" sub={`${stats.closedCount} 笔已平仓 · ${stats.openCount} 持仓中`}>
            <span style={{ color: pnlColor(stats.totalPnl) }}>{fmtUsd(stats.totalPnl)}</span>
          </StatCard>
          <StatCard label="胜率" sub={`${stats.winCount}胜 / ${stats.lossCount}负`}>
            <span className="text-white/90">{stats.closedCount ? `${(stats.winRate * 100).toFixed(0)}%` : '—'}</span>
          </StatCard>
          <StatCard label="盈亏比 PF" sub="∑盈利 ÷ |∑亏损|">
            <span style={{ color: pf >= 1 ? UP : DOWN }}>{stats.closedCount ? (pf === Infinity ? '∞' : pf.toFixed(2)) : '—'}</span>
          </StatCard>
          <StatCard label="平均盈利 / 亏损" sub={`最佳 ${fmtUsd(stats.bestPnl)} · 最差 ${fmtUsd(stats.worstPnl)}`}>
            <span className="text-[16px]">
              <span style={{ color: UP }}>{fmtUsd(stats.avgWin)}</span>
              <span className="text-white/30 mx-1">/</span>
              <span style={{ color: DOWN }}>{fmtUsd(stats.avgLoss)}</span>
            </span>
          </StatCard>
        </div>

        {/* ── 图表区 ── */}
        <div className="grid grid-cols-12 gap-3 shrink-0">
          <Card title="已实现盈亏净值曲线" className="col-span-12 lg:col-span-7 h-[280px]">
            {equity.length >= 2
              ? <EChart option={equityOption} notMerge />
              : <div className="h-full flex items-center justify-center text-[12px] text-white/40">平仓 ≥2 笔后显示净值曲线</div>}
          </Card>
          <Card title="按策略盈亏分解" className="col-span-12 lg:col-span-5 h-[280px]">
            {stats.byStrategy.length
              ? <EChart option={strategyOption} notMerge />
              : <div className="h-full flex items-center justify-center text-[12px] text-white/40">暂无已平仓交易</div>}
          </Card>
        </div>

        {/* ── 新增交易 ── */}
        <Card title="记一笔" className="shrink-0">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/40">标的</span>
              <select className={inputCls} value={draft.coin} onChange={e => setD({ coin: e.target.value })}>
                {JOURNAL_COINS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/40">策略</span>
              <select className={inputCls} value={draft.strategy} onChange={e => setD({ strategy: e.target.value })}>
                {STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/40">状态</span>
              <select className={inputCls} value={draft.status} onChange={e => setD({ status: e.target.value as TradeStatus })}>
                <option value="closed">已平仓</option>
                <option value="open">持仓中</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/40">开仓日</span>
              <input type="date" className={inputCls} value={draft.openDate} onChange={e => setD({ openDate: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/40">平仓日</span>
              <input type="date" className={inputCls} value={draft.closeDate} disabled={draft.status === 'open'}
                onChange={e => setD({ closeDate: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/40">已实现盈亏 $</span>
              <input type="number" placeholder="如 1240 / -680" className={`${inputCls} w-[130px] tabular-nums`}
                value={draft.pnl} disabled={draft.status === 'open'}
                onChange={e => setD({ pnl: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
              <span className="text-[10px] text-white/40">备注</span>
              <input type="text" placeholder="为什么做这笔、复盘…" className={inputCls}
                value={draft.notes} onChange={e => setD({ notes: e.target.value })} />
            </label>
            <button onClick={addTrade}
              className="h-[30px] px-3 rounded-md bg-[#25e889]/15 text-[#25e889] ring-1 ring-inset ring-[#25e889]/30 text-[12px] font-semibold flex items-center gap-1.5 hover:bg-[#25e889]/25 transition-colors">
              <Plus size={14} /> 添加
            </button>
          </div>
        </Card>

        {/* ── 交易列表 ── */}
        <Card title={`交易记录 · ${trades.length}`} className="flex-1"
          right={empty ? (
            <button onClick={() => update(sampleTrades())}
              className="h-[26px] px-2.5 rounded-md bg-white/[0.06] text-white/65 ring-1 ring-inset ring-white/10 text-[11px] font-semibold flex items-center gap-1.5 hover:bg-white/[0.1] transition-colors">
              <FlaskConical size={13} /> 加载示例
            </button>
          ) : undefined}
        >
          {empty ? (
            <div className="h-[160px] flex flex-col items-center justify-center gap-2 text-white/40">
              <span className="text-[13px]">还没有交易记录</span>
              <span className="text-[11px]">用上面「记一笔」开始，或右上角加载示例看效果</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-white/40 text-[10px] uppercase tracking-wider">
                    <th className="text-left font-medium py-1.5 px-2">开仓</th>
                    <th className="text-left font-medium py-1.5 px-2">平仓</th>
                    <th className="text-left font-medium py-1.5 px-2">标的</th>
                    <th className="text-left font-medium py-1.5 px-2">策略</th>
                    <th className="text-left font-medium py-1.5 px-2">状态</th>
                    <th className="text-right font-medium py-1.5 px-2">盈亏</th>
                    <th className="text-left font-medium py-1.5 px-2">备注</th>
                    <th className="py-1.5 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map(t => (
                    <tr key={t.id} className="border-t border-white/[0.05] hover:bg-white/[0.025]">
                      <td className="py-1.5 px-2 tabular-nums text-white/60 whitespace-nowrap">{t.openDate}</td>
                      <td className="py-1.5 px-2 tabular-nums text-white/60 whitespace-nowrap">{t.closeDate ?? '—'}</td>
                      <td className="py-1.5 px-2 font-semibold text-white/75">{t.coin}</td>
                      <td className="py-1.5 px-2 text-white/75 whitespace-nowrap">{t.strategy}</td>
                      <td className="py-1.5 px-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${t.status === 'open' ? 'bg-[#4ea1ff]/15 text-[#4ea1ff]' : 'bg-white/[0.06] text-white/55'}`}>
                          {t.status === 'open' ? '持仓中' : '已平仓'}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold tabular-nums" style={{ color: t.status === 'open' ? MUTE : pnlColor(t.pnl) }}>
                        {t.status === 'open' ? '—' : fmtUsd(t.pnl)}
                      </td>
                      <td className="py-1.5 px-2 text-white/45 max-w-[280px] truncate">{t.notes ?? ''}</td>
                      <td className="py-1.5 px-2 text-right">
                        <button onClick={() => remove(t.id)} title="删除"
                          className="text-white/30 hover:text-[#FF5F57] transition-colors p-1">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

      </div>
    </div>
  );
};

export default JournalView;
