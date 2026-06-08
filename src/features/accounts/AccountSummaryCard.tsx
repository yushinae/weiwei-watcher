// 决策页用：真实账户概览（替掉旧的手动持仓小卡）。
// 已实现/本月/未实现盈亏 + 全账户净 $Delta/$Vega + 真实持仓列表。数据来自「账户」页同步的本地缓存。
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, ArrowRight } from 'lucide-react';
import { getAccounts } from './store';
import { getBook } from './bookStore';
import { fetchAllPositions } from './sync';
import { loadAllFills } from './fillStore';
import { fromAccounts, buildBooks, totals } from '../portfolioRisk/aggregate';
import { useLiveSpot } from '../optionsChain/liveData';
import type { UnifiedPosition } from './types';

const UP = '#28C840';
const DOWN = '#FF5F57';
const MUTE = 'rgba(255,255,255,0.5)';

const fmtUsd = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : a.toFixed(0);
  return `${v < 0 ? '-' : v > 0 ? '+' : ''}$${s}`;
};
const sgn = (v: number) => (v > 0 ? UP : v < 0 ? DOWN : MUTE);
const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

const Tile = ({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) => (
  <div className="flex-1 min-w-[110px] flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-white/[0.03] ring-1 ring-inset ring-white/[0.06]">
    <span className="text-[9px] uppercase tracking-wider text-white/40">{label}</span>
    <span className="text-[16px] font-bold tabular-nums leading-none" style={{ color }}>{value}</span>
    {sub && <span className="text-[9px] text-white/35">{sub}</span>}
  </div>
);

export const AccountSummaryCard: React.FC = () => {
  const navigate = useNavigate();
  const [positions, setPositions] = useState<UnifiedPosition[]>(() => getBook());
  const [fills, setFills] = useState(() => loadAllFills());
  const hasAccounts = getAccounts().length > 0;

  useEffect(() => {
    let alive = true;
    if (hasAccounts) {
      void fetchAllPositions().then(p => { if (alive) { setPositions(p); setFills(loadAllFills()); } });
    }
    return () => { alive = false; };
  }, [hasAccounts]);

  const btcSpot = useLiveSpot('BTC');
  const ethSpot = useLiveSpot('ETH');

  const realized = useMemo(() => fills.reduce((s, f) => s + f.closedPnl - f.fee, 0), [fills]);
  const thisMonth = useMemo(
    () => fills.filter(f => f.time >= monthStart).reduce((s, f) => s + f.closedPnl - f.fee, 0),
    [fills],
  );
  const unreal = useMemo(() => positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0), [positions]);
  const tot = useMemo(
    () => totals(buildBooks(fromAccounts(positions, { BTC: btcSpot ?? 0, ETH: ethSpot ?? 0 }))),
    [positions, btcSpot, ethSpot],
  );

  if (!hasAccounts) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-5 text-center">
        <Wallet size={20} className="text-white/30" />
        <span className="text-[12px] text-white/55">还没接入交易所账户</span>
        <button onClick={() => navigate('/accounts')}
          className="inline-flex items-center gap-1.5 h-[28px] px-3 rounded-md bg-[var(--color-brand)]/15 text-[var(--color-brand)] ring-1 ring-inset ring-[var(--color-brand)]/30 text-[11px] font-semibold hover:bg-[var(--color-brand)]/25 transition-colors">
          去「账户」接入 <ArrowRight size={12} />
        </button>
      </div>
    );
  }

  const sorted = [...positions].sort((a, b) => b.notionalUsd - a.notionalUsd).slice(0, 6);

  return (
    <div className="flex flex-col gap-2.5">
      {/* 概览 tiles */}
      <div className="flex gap-2 flex-wrap">
        <Tile label="已实现盈亏" value={fmtUsd(realized)} color={sgn(realized)} sub={`${fills.length} 笔 · 扣费`} />
        <Tile label="本月" value={fmtUsd(thisMonth)} color={sgn(thisMonth)} />
        <Tile label="未实现盈亏" value={fmtUsd(unreal)} color={sgn(unreal)} sub={`${positions.length} 持仓`} />
        <Tile label="净 $Delta" value={fmtUsd(tot.netDelta)} color={sgn(tot.netDelta)} sub={tot.netDelta > 0 ? '偏多' : tot.netDelta < 0 ? '偏空' : '中性'} />
        <Tile label="净 $Vega/1%" value={fmtUsd(tot.netVega)} color={sgn(tot.netVega)} sub={tot.netVega < 0 ? '净空波动' : tot.netVega > 0 ? '净多波动' : '中性'} />
      </div>

      {/* 真实持仓 */}
      {positions.length === 0 ? (
        <div className="text-[11px] text-white/40 text-center py-2">无持仓</div>
      ) : (
        <div className="flex flex-col gap-1">
          {sorted.map((p, i) => (
            <div key={`${p.venue}-${p.coin}-${i}`} className="flex items-center gap-2.5 px-2 py-1 rounded-md hover:bg-white/[0.025] text-[11px]">
              <span className="text-white/45 w-[64px] shrink-0">{p.venue}</span>
              <span className="font-bold text-white/80 w-[40px]">{p.coin}</span>
              <span className="text-white/40 w-[36px]">{p.kind === 'perp' ? '永续' : p.kind === 'option' ? '期权' : '现货'}</span>
              <span className="tabular-nums w-[60px]" style={{ color: p.size >= 0 ? UP : DOWN }}>{p.size > 0 ? '+' : ''}{p.size}</span>
              <span className="text-white/45 tabular-nums ml-auto">名义 {fmtUsd(p.notionalUsd).replace('+', '')}</span>
              <span className="tabular-nums font-semibold w-[64px] text-right" style={{ color: p.unrealizedPnl != null ? sgn(p.unrealizedPnl) : MUTE }}>
                {p.unrealizedPnl != null ? fmtUsd(p.unrealizedPnl) : '—'}
              </span>
            </div>
          ))}
          <button onClick={() => navigate('/accounts')}
            className="self-end inline-flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70 transition-colors mt-0.5">
            全部账户 <ArrowRight size={11} />
          </button>
        </div>
      )}
    </div>
  );
};

export default AccountSummaryCard;
