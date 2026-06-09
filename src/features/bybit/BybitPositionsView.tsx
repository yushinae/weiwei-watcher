import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Settings } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useEscapeKey } from '../../lib/useEscapeKey';
import { BybitSettingsPanel } from './BybitSettingsPanel';
import { useGlobalOptionBook } from '../optionsChain/optionBookStore';
import type { SimPosition } from '../optionsChain/simBook';
import { isEnvConfigured } from './auth';
import { useBybitAuthState, useBybitPositions } from './usePositions';
import type { BybitOptionPosition } from './rest';
import { bybitToImport } from './convert';
import { stageImport } from '../positionBuilder/import';
import PositionAnalytics, { DEMO_POSITIONS } from './PositionAnalytics';

// ─────────────────────────────────────────────────────────────────────────────
// Parses a Bybit option symbol like "BTC-25APR25-90000-C" into its parts.
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

interface ParsedSymbol {
  coin: string; expiry: string; expiryTs: number;
  strike: number; type: 'C' | 'P';
}

function parseSymbol(symbol: string): ParsedSymbol | null {
  const parts = symbol.split('-');
  if (parts.length !== 4) return null;
  const [coin, expStr, strikeStr, typeStr] = parts;
  if (typeStr !== 'C' && typeStr !== 'P') return null;
  const strike = parseInt(strikeStr);
  if (isNaN(strike)) return null;
  // expStr like "25APR25" (DDMMMYY)
  const day = parseInt(expStr.slice(0, 2));
  const mon = MONTH_MAP[expStr.slice(2, 5)];
  const yr  = 2000 + parseInt(expStr.slice(5));
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  const expiryTs = Date.UTC(yr, mon, day, 8, 0, 0);
  return { coin, expiry: expStr, expiryTs, strike, type: typeStr };
}

function daysUntil(ts: number): number {
  return (ts - Date.now()) / 86_400_000;
}

// ─────────────────────────────────────────────────────────────────────────────

const numFmt = (v: string | number | undefined, digits = 2) => {
  if (v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
};

const pnlColor = (v: string | number | undefined) => {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '0');
  if (isNaN(n) || n === 0) return 'text-white/55';
  return n > 0 ? 'text-trade-up' : 'text-trade-down';
};

// ─────────────────────────────────────────────────────────────────────────────

export default function BybitPositionsView() {
  const navigate = useNavigate();
  const configured = useBybitAuthState();
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEscapeKey(settingsOpen, () => setSettingsOpen(false));
  const [demo, setDemo] = useState(false);
  const [tab, setTab] = useState<'positions' | 'history' | 'sim-options'>('positions');
  const optionBook = useGlobalOptionBook();
  const { positions: livePositions, loading, error, fetchedAt, refresh } = useBybitPositions();

  const positions = demo ? DEMO_POSITIONS : livePositions;

  const sendToStressTest = () => {
    const result = bybitToImport(positions);
    if (!result.primary) {
      alert('当前没有可导入的仓位（已过期或无法解析）');
      return;
    }
    if (result.skippedCoins.length > 0) {
      const skipDesc = result.skippedCoins.map(s => `${s.coin}×${s.count}`).join('、');
      const ok = confirm(
        `压力测试一次只能跑一个币种。\n将导入 ${result.primary.symbol} ${result.primary.legs.length} 条腿；\n${skipDesc} 这些会被跳过。\n\n继续？`
      );
      if (!ok) return;
    }
    stageImport(result.primary);
    navigate('/position-builder');
  };

  const totals = useMemo(() => {
    let unrealized = 0, delta = 0, gamma = 0, vega = 0, theta = 0;
    for (const p of positions) {
      const sizeSign = (p.side === 'Sell' ? -1 : 1);
      const size = parseFloat(p.size) || 0;
      const qty = sizeSign * size;
      unrealized += parseFloat(p.unrealisedPnl) || 0;
      delta += (parseFloat(p.delta ?? '0') || 0) * qty;
      gamma += (parseFloat(p.gamma ?? '0') || 0) * qty;
      vega  += (parseFloat(p.vega  ?? '0') || 0) * qty;
      theta += (parseFloat(p.theta ?? '0') || 0) * qty;
    }
    return { unrealized, delta, gamma, vega, theta };
  }, [positions]);

  const stale = fetchedAt > 0 && Date.now() - fetchedAt > 60_000;

  return (
    <div className="bybit-page-scope absolute inset-0 monitor-scope flex flex-col font-medium text-slate-200">
      {/* Header — L2 chrome */}
      <div className="sticky top-0 z-[120] h-[44px] flex items-center px-4 shrink-0 border-b border-white/[0.07]"
           style={{ background: 'var(--color-surface-3)' }}>
        <span className="text-[14px] font-semibold text-white/80 mr-3">头寸可视化 · Bybit</span>
        {/* Tab 切换 pill */}
        <div className="flex h-8 items-center gap-0.5 p-0.5 rounded-lg bg-[#17181E] mr-3">
          {([['positions', '当前持仓'], ['history', '历史记录'], ['sim-options', `模拟期权${optionBook.positions.length ? ` ${optionBook.positions.length}` : ''}`]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors duration-[120ms]',
                tab === key
                  ? 'bg-[#3A3F40] text-[var(--nexus-accent)]'
                  : 'text-white/55 hover:bg-[#3A3B40] hover:text-white/80',
              )}
            >{label}</button>
          ))}
        </div>
        {demo && (
          <span className="h-7 inline-flex items-center gap-1.5 px-2.5 text-[12px] rounded-lg border border-[var(--color-sev-mid)]/40 bg-[var(--color-sev-mid)]/10 text-[var(--color-sev-mid)]">
            示例数据
            <button onClick={() => setDemo(false)} className="opacity-70 hover:opacity-100">✕</button>
          </span>
        )}
        {configured && !demo && (
          <>
            <span className="text-[11px] text-white/55">
              {fetchedAt > 0 ? `更新于 ${new Date(fetchedAt).toLocaleTimeString()}` : '—'}
              {stale && <span className="ml-1 text-[var(--color-sev-mid)]">· 数据陈旧</span>}
            </span>
            <button
              onClick={refresh} disabled={loading}
              className="ml-3 h-7 px-3 text-[12px] rounded-lg bg-[#2B2D35] text-white/70 hover:bg-[#3A3B40] disabled:opacity-40 transition-colors"
            >{loading ? '刷新中…' : '刷新'}</button>
          </>
        )}
        {positions.length > 0 && (
          <button
            onClick={sendToStressTest}
            className="ml-2 h-7 px-3 text-[12px] rounded-lg border border-brand/40 bg-brand/10 text-brand hover:bg-brand/20 transition-colors"
            title="将当前仓位带入压力测试工具"
          >→ 压力测试</button>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setSettingsOpen(o => !o)}
          className={cn(
            'w-7 h-7 rounded-lg flex items-center justify-center border transition-colors duration-[120ms]',
            settingsOpen
              ? 'bg-[#3A3F40] text-[var(--nexus-accent)] border-transparent'
              : 'border-transparent text-white/55 hover:text-white/85 hover:bg-[#3A3B40]',
          )}
          title="API 设置"
          aria-label="API 设置"
        ><Settings size={14} /></button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-3 pt-3 pb-4">
        <div className="max-w-[1500px] mx-auto w-full flex flex-col gap-3">
          {settingsOpen && (
            <div className="widget-card p-4">
              <div className="text-[13px] text-white/55 mb-3">Bybit API 凭据</div>
              {isEnvConfigured() && (
                <div className="mb-3 text-[12px] rounded-lg px-3 py-2 border"
                  style={{ borderColor: 'rgba(40,200,64,0.30)', background: 'rgba(40,200,64,0.08)', color: 'var(--color-trade-up)' }}>
                  已通过 <span className="font-mono">.env</span>（<span className="font-mono">VITE_BYBIT_API_KEY</span>）配置 —— 下方手动输入会被忽略。
                </div>
              )}
              <BybitSettingsPanel onClose={() => setSettingsOpen(false)} />
              {!configured && (
                <div className="mt-3 pt-3 border-t border-white/[0.06]">
                  <button
                    onClick={() => { setDemo(true); setSettingsOpen(false); }}
                    className="h-8 px-4 rounded-lg text-[12px] font-semibold bg-[#2B2D35] text-white/70 hover:bg-[#3A3B40] transition-colors"
                  >使用示例数据</button>
                </div>
              )}
            </div>
          )}

          {tab === 'positions' && !configured && !demo && !settingsOpen && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-[14px] text-white/65 mb-1">暂无持仓</div>
              <div className="text-[12px] text-white/55">配置 Bybit API 后自动显示实时持仓</div>
            </div>
          )}

          {(tab === 'positions' && ((configured || demo))) && (
            <>
              <TotalsBar totals={totals} count={positions.length} />
              {error && !demo && (
                <div className="widget-card p-3 text-[12px] text-[var(--nexus-red)] ring-1 ring-inset ring-[var(--nexus-red)]/30 bg-[var(--nexus-red)]/[0.06]">
                  {error}
                </div>
              )}
              {!error && positions.length === 0 && !loading && !demo && (
                <div className="widget-card p-8 text-center text-[13px] text-white/50">
                  当前没有期权持仓
                </div>
              )}
              {positions.length > 0 && (
                <>
                  <PositionAnalytics positions={positions} />
                  <PositionsTable positions={positions} />
                </>
              )}
            </>
          )}

          {tab === 'history' && <TradeHistoryView />}
          {tab === 'sim-options' && <SimOptionsPositionsView book={optionBook} />}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TotalsBar({ totals, count }: { totals: { unrealized: number; delta: number; gamma: number; vega: number; theta: number }; count: number }) {
  const cell = (label: string, value: number, fmt: (v: number) => string, color?: string) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-white/55 font-semibold uppercase tracking-wider">{label}</span>
      <span className={cn('text-[16px] font-mono font-bold tnum', color ?? 'text-white/90')}>{fmt(value)}</span>
    </div>
  );
  return (
    // .widget-card forces flex-direction:column — keep the stats row in an inner div.
    <div className="widget-card p-4">
      <div className="flex items-center gap-x-10 gap-y-3 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-white/55 font-semibold uppercase tracking-wider">持仓</span>
          <span className="text-[16px] font-mono font-bold tnum text-white/90">{count}</span>
        </div>
        {cell('未实现 PnL', totals.unrealized,
          v => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
          totals.unrealized >= 0 ? 'text-trade-up' : 'text-trade-down')}
        {cell('净 Δ', totals.delta, v => v.toFixed(3))}
        {cell('净 Γ', totals.gamma, v => v.toFixed(4))}
        {cell('净 ν', totals.vega, v => v.toFixed(2))}
        {cell('净 Θ/日', totals.theta, v => v.toFixed(2))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SimOptionsPositionsView({ book }: { book: ReturnType<typeof useGlobalOptionBook> }) {
  const totalPnL = useMemo(() => book.positions.reduce((s, p) => s + p.unrealizedPnL, 0), [book.positions]);
  const totalDelta = useMemo(() => book.positions.reduce((s, p) => s + p.delta, 0), [book.positions]);
  const totalGamma = useMemo(() => book.positions.reduce((s, p) => s + p.gamma, 0), [book.positions]);
  const totalTheta = useMemo(() => book.positions.reduce((s, p) => s + p.theta, 0), [book.positions]);
  const totalVega = useMemo(() => book.positions.reduce((s, p) => s + p.vega, 0), [book.positions]);

  if (book.positions.length === 0) {
    return (
      <div className="widget-card p-8 text-center">
        <div className="text-[13px] text-white/50 mb-2">暂无模拟期权仓位</div>
        <div className="text-[11px] text-white/55">从顶部「期权」选择到期日，进入期权链下单后会出现在这里</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="widget-card p-4">
        <div className="flex items-center gap-x-10 gap-y-3 flex-wrap">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-white/55 font-semibold uppercase tracking-wider">模拟仓位</span>
            <span className="text-[16px] font-mono font-bold tnum text-white/90">{book.positions.length}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-white/55 font-semibold uppercase tracking-wider">未实现 PnL</span>
            <span className={cn('text-[16px] font-mono font-bold tnum', totalPnL >= 0 ? 'text-trade-up' : 'text-trade-down')}>
              {totalPnL >= 0 ? '+' : '-'}{Math.abs(totalPnL).toFixed(2)}$
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-white/55 font-semibold uppercase tracking-wider">净 Δ</span>
            <span className="text-[16px] font-mono font-bold tnum text-white/90">{totalDelta >= 0 ? '+' : ''}{totalDelta.toFixed(3)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-white/55 font-semibold uppercase tracking-wider">净 Γ</span>
            <span className="text-[16px] font-mono font-bold tnum text-white/90">{totalGamma.toFixed(4)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-white/55 font-semibold uppercase tracking-wider">净 Θ/日</span>
            <span className="text-[16px] font-mono font-bold tnum text-white/90">{totalTheta.toFixed(2)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-white/55 font-semibold uppercase tracking-wider">净 ν</span>
            <span className="text-[16px] font-mono font-bold tnum text-white/90">{totalVega.toFixed(2)}</span>
          </div>
          <div className="ml-auto text-[11px] text-white/40">模拟账本 · 不会真实下单</div>
        </div>
      </div>

      <div className="widget-card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-white/55 uppercase tracking-wider border-b border-white/[0.08]">
                <Th>合约</Th>
                <Th align="right">方向</Th>
                <Th align="right">数量</Th>
                <Th align="right">名义价值</Th>
                <Th align="right">均价</Th>
                <Th align="right">标记</Th>
                <Th align="right">未实现 PnL</Th>
                <Th align="right">Δ</Th>
                <Th align="right">Γ</Th>
                <Th align="right">Θ</Th>
                <Th align="right">ν</Th>
                <Th align="right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {book.positions.map(p => (
                <React.Fragment key={p.id}>
                  <SimPositionRow position={p} onClose={() => book.closePosition(p)} />
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SimPositionRow({ position, onClose }: { position: SimPosition; onClose: () => void }) {
  const parsed = parseSymbol(position.symbol);
  const signedQty = position.side === 'long' ? position.qty : -position.qty;
  return (
    <tr className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors">
      <Td>
        <div className="flex flex-col leading-tight">
          <span className="text-white/90 font-mono">{position.symbol}</span>
          {parsed && <span className="text-[10px] text-white/55">{parsed.coin} {parsed.type === 'C' ? 'Call' : 'Put'} · {parsed.expiry}</span>}
        </div>
      </Td>
      <Td align="right"><span className={position.side === 'long' ? 'text-trade-up' : 'text-trade-down'}>{position.side === 'long' ? '做多' : '做空'}</span></Td>
      <Td align="right" mono>{signedQty >= 0 ? '+' : ''}{signedQty.toFixed(2)}</Td>
      <Td align="right" mono>{(position.markPrice * position.qty).toFixed(2)}</Td>
      <Td align="right" mono>{position.avgEntryPrice.toFixed(2)}</Td>
      <Td align="right" mono>{position.markPrice.toFixed(2)}</Td>
      <Td align="right" mono className={position.unrealizedPnL >= 0 ? 'text-trade-up' : 'text-trade-down'}>
        {position.unrealizedPnL >= 0 ? '+' : '-'}{Math.abs(position.unrealizedPnL).toFixed(2)}$
      </Td>
      <Td align="right" mono>{position.delta >= 0 ? '+' : ''}{position.delta.toFixed(3)}</Td>
      <Td align="right" mono className="text-white/70">{position.gamma.toFixed(4)}</Td>
      <Td align="right" mono className="text-white/70">{position.theta.toFixed(2)}</Td>
      <Td align="right" mono className="text-white/70">{position.vega.toFixed(2)}</Td>
      <Td align="right">
        <button
          onClick={onClose}
          className="h-7 px-3 rounded-lg border border-[var(--color-trade-down)]/35 bg-[var(--color-trade-down)]/10 text-[11px] font-semibold text-[var(--color-trade-down)] hover:bg-[var(--color-trade-down)]/18 transition-colors"
        >平仓</button>
      </Td>
    </tr>
  );
}

function PositionsTable({ positions }: { positions: BybitOptionPosition[] }) {
  // Group by expiry then by coin for readability
  const sorted = useMemo(() => {
    return [...positions].sort((a, b) => {
      const pa = parseSymbol(a.symbol), pb = parseSymbol(b.symbol);
      const ta = pa?.expiryTs ?? 0, tb = pb?.expiryTs ?? 0;
      if (ta !== tb) return ta - tb;
      return (pa?.strike ?? 0) - (pb?.strike ?? 0);
    });
  }, [positions]);

  return (
    <div className="widget-card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[11px] text-white/55 uppercase tracking-wider border-b border-white/[0.08]">
              <Th>合约</Th>
              <Th>到期</Th>
              <Th align="right">行权</Th>
              <Th align="right">方向</Th>
              <Th align="right">数量</Th>
              <Th align="right">入场</Th>
              <Th align="right">标记</Th>
              <Th align="right">未实现 PnL</Th>
              <Th align="right">Δ</Th>
              <Th align="right">Γ</Th>
              <Th align="right">ν</Th>
              <Th align="right">Θ</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => {
              const parsed = parseSymbol(p.symbol);
              const dte = parsed ? daysUntil(parsed.expiryTs) : 0;
              const sideSign = p.side === 'Sell' ? -1 : 1;
              return (
                <tr key={p.symbol} className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors">
                  <Td>
                    <div className="flex flex-col leading-tight">
                      <span className="text-white/90 font-mono">{p.symbol}</span>
                      {parsed && <span className="text-[10px] text-white/55">{parsed.coin} {parsed.type === 'C' ? 'Call' : 'Put'}</span>}
                    </div>
                  </Td>
                  <Td>
                    {parsed ? (
                      <div className="flex flex-col leading-tight">
                        <span className="text-white/80">{parsed.expiry}</span>
                        <span className="text-[10px] text-white/55">{dte.toFixed(1)} 天</span>
                      </div>
                    ) : '—'}
                  </Td>
                  <Td align="right" mono>{parsed?.strike.toLocaleString('en-US') ?? '—'}</Td>
                  <Td align="right">
                    <span className={p.side === 'Sell' ? 'text-trade-down' : 'text-trade-up'}>
                      {p.side === 'Sell' ? '做空' : '做多'}
                    </span>
                  </Td>
                  <Td align="right" mono>{numFmt(p.size, 2)}</Td>
                  <Td align="right" mono>{numFmt(p.avgPrice, 2)}</Td>
                  <Td align="right" mono>{numFmt(p.markPrice, 2)}</Td>
                  <Td align="right" mono className={pnlColor(p.unrealisedPnl)}>
                    {(() => {
                      const n = parseFloat(p.unrealisedPnl);
                      if (isNaN(n)) return '—';
                      return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
                    })()}
                  </Td>
                  <Td align="right" mono>
                    {p.delta !== undefined ? (parseFloat(p.delta) * sideSign).toFixed(3) : '—'}
                  </Td>
                  <Td align="right" mono>{numFmt(p.gamma, 4)}</Td>
                  <Td align="right" mono>{numFmt(p.vega, 2)}</Td>
                  <Td align="right" mono>{numFmt(p.theta, 2)}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={cn('px-3 py-2 font-semibold', align === 'right' && 'text-right')}>{children}</th>;
}

function Td({ children, align = 'left', mono, className }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean; className?: string }) {
  return <td className={cn('px-3 py-2', align === 'right' && 'text-right', mono && 'font-mono tnum', className)}>{children}</td>;
}

// ── Trade History ────────────────────────────────────────────────────────────

interface TradeRecord {
  id: number;
  exchange: string;
  instrument: string;
  trade_type: string;
  direction: string;
  status: string;
  entry_time: string;
  entry_price: number;
  exit_time: string | null;
  exit_price: number | null;
  pnl: number | null;
  pnl_percent: number | null;
  holding_hours: number | null;
  thesis: string | null;
}

function TradeHistoryView() {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/trades/history')
      .then(r => r.json())
      .then(data => { if (!cancelled) { setTrades(data.trades ?? []); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const avgPnl = useMemo(() => {
    if (trades.length === 0) return 0;
    return trades.reduce((s, t) => s + (t.pnl ?? 0), 0) / trades.length;
  }, [trades]);

  const winRate = useMemo(() => {
    if (trades.length === 0) return 0;
    return trades.filter(t => (t.pnl ?? 0) > 0).length / trades.length * 100;
  }, [trades]);

  const totalPnl = useMemo(() => {
    return trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  }, [trades]);

  if (loading) {
    return (
      <div className="widget-card p-8 flex items-center justify-center">
        <div className="text-[13px] text-white/50">加载交易记录…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="widget-card p-3 text-[12px] text-[var(--nexus-red)] ring-1 ring-inset ring-[var(--nexus-red)]/30 bg-[var(--nexus-red)]/[0.06]">
        {error}
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="widget-card p-8 text-center">
        <div className="text-[13px] text-white/50 mb-2">暂无历史交易记录</div>
        <div className="text-[11px] text-white/55">平仓后的交易会在这里展示</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* History stats bar — four animated cards */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: '总交易', value: String(trades.length), color: 'text-white/85' },
          { label: '胜率', value: `${winRate.toFixed(0)}%`, color: winRate >= 50 ? 'text-trade-up' : 'text-trade-down' },
          { label: '平均盈亏', value: `${avgPnl >= 0 ? '+' : '-'}${Math.abs(avgPnl).toLocaleString('en-US', { maximumFractionDigits: 2 })}$`, color: avgPnl >= 0 ? 'text-trade-up' : 'text-trade-down' },
          { label: '总盈亏', value: `${totalPnl >= 0 ? '+' : '-'}${Math.abs(totalPnl).toLocaleString('en-US', { maximumFractionDigits: 2 })}$`, color: totalPnl >= 0 ? 'text-trade-up' : 'text-trade-down' },
        ].map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="widget-card !p-3 flex flex-col gap-1"
          >
            <span className="text-[11px] text-white/50 font-semibold uppercase tracking-wider">{card.label}</span>
            <span className={cn('text-[16px] font-mono font-bold tnum', card.color)}>{card.value}</span>
          </motion.div>
        ))}
      </div>

      {/* History table */}
      <div className="widget-card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-white/55 uppercase tracking-wider border-b border-white/[0.08]">
                <Th>合约</Th>
                <Th>方向</Th>
                <Th align="right">入场时间</Th>
                <Th align="right">出场时间</Th>
                <Th align="right">持仓</Th>
                <Th align="right">入场价</Th>
                <Th align="right">出场价</Th>
                <Th align="right">盈亏</Th>
                <Th align="right">ROI</Th>
                <Th>理由</Th>
              </tr>
            </thead>
            <tbody>
              {trades.map(t => {
                const pnl = t.pnl ?? 0;
                const pnlPct = t.pnl_percent ?? 0;
                const isWin = pnl > 0;
                return (
                  <tr key={t.id} className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors">
                    <Td>
                      <div className="flex flex-col leading-tight">
                        <span className="text-white/90 font-mono">{t.instrument}</span>
                        <span className="text-[10px] text-white/55">{t.exchange}</span>
                      </div>
                    </Td>
                    <Td>
                      <span className={t.direction === 'long' ? 'text-trade-up' : 'text-trade-down'}>
                        {t.direction === 'long' ? '做多' : '做空'}
                      </span>
                    </Td>
                    <Td align="right" mono>{t.entry_time ? new Date(t.entry_time).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</Td>
                    <Td align="right" mono>{t.exit_time ? new Date(t.exit_time).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</Td>
                    <Td align="right" mono>{t.holding_hours !== null ? `${t.holding_hours.toFixed(1)}h` : '—'}</Td>
                    <Td align="right" mono>{t.entry_price ? `$${t.entry_price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}</Td>
                    <Td align="right" mono>{t.exit_price ? `$${t.exit_price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}</Td>
                    <Td align="right" mono className={cn(isWin ? 'text-trade-up' : 'text-trade-down')}>
                      {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </Td>
                    <Td align="right" mono className={cn(isWin ? 'text-trade-up' : 'text-trade-down')}>
                      {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                    </Td>
                    <Td className="max-w-[200px]">
                      <span className="text-white/70 line-clamp-2 text-[11px] leading-snug">{t.thesis || '—'}</span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
