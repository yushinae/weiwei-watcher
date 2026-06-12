// 资产总览面板 — Bybit 暗色风格
// 展示：总权益、各所拆分、Greeks 仪表、账户健康。
// 复用 AccountSummaryCard 的现有数据获取逻辑（getAccounts / loadAllFills / fetchAllPositions / getBook）。
import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Activity, AlertTriangle, Clock } from 'lucide-react';
import { getAccounts, hydrateAccountsFromBackend } from './store';
import { getBook } from './bookStore';
import { fetchAllPositions, getLastAccountSyncErrors } from './sync';
import { loadAllFills, hydrateFillsFromBackend } from './fillStore';
import { fromAccounts, buildBooks, totals } from '../portfolioRisk/aggregate';
import { useLiveSpot } from '../optionsChain/liveData';
import type { UnifiedPosition, Venue } from './types';

// ── Constants ───────────────────────────────────────────────────────────────

const VENUE_LABEL: Record<Venue, string> = {
  Hyperliquid: 'Hyperliquid',
  Bybit: 'Bybit',
  Deribit: 'Deribit',
  Binance: 'Binance',
};

const MONTH_MS = 30 * 86400_000;

// ── Format helpers ──────────────────────────────────────────────────────────

const fmtUsd = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : a.toFixed(0);
  return `${v < 0 ? '-' : v > 0 ? '+' : ''}$${s}`;
};

const fmtUsdPlain = (v: number) =>
  `$${v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : v >= 1 ? 2 : 4 })}`;

const fmtTime = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const freshnessLabel = (ms: number | null): { label: string; color: string } => {
  if (!ms) return { label: '待同步', color: 'var(--color-sev-mid)' };
  const ago = Date.now() - ms;
  if (ago < 60_000) return { label: '实时', color: 'var(--color-sev-calm)' };
  if (ago < 300_000) return { label: '1m–5m', color: 'var(--color-sev-low)' };
  if (ago < 900_000) return { label: '5m–15m', color: 'var(--color-sev-mid)' };
  return { label: '>15m', color: 'var(--color-sev-extreme)' };
};

const sgnColor = (v: number) =>
  v > 0 ? 'var(--color-trade-up)' : v < 0 ? 'var(--color-trade-down)' : 'rgba(255,255,255,0.5)';

// ── Sub-components ──────────────────────────────────────────────────────────

/** 数据块（L3 tile） */
const DataTile: React.FC<{
  label: string;
  value: string;
  color?: string;
  sub?: string;
  className?: string;
}> = ({ label, value, color, sub, className }) => (
  <div className={`dashboard-inner-tile flex-1 min-w-[120px] flex flex-col gap-1 px-3 py-2.5 rounded-lg ${className ?? ''}`}>
    <span className="text-[9px] uppercase tracking-wider text-white/42 font-medium">{label}</span>
    <span
      className="text-[20px] sm:text-[24px] font-bold tabular-nums leading-none transition-colors"
      style={{ color: color ?? 'rgba(255,255,255,0.85)' }}
    >
      {value}
    </span>
    {sub && <span className="text-[10px] text-white/45 leading-tight">{sub}</span>}
  </div>
);

/** 各所拆分行 */
const VenueRow: React.FC<{
  venue: Venue;
  unrealPnl: number;
  notional: number;
  positionCount: number;
}> = ({ venue, unrealPnl, notional, positionCount }) => (
  <div className="flex items-center gap-2.5 px-3 py-2 rounded-md text-[11px] transition-colors hover:bg-[var(--color-surface-5)]" style={{ transitionDuration: '160ms', transitionTimingFunction: 'var(--ease-emphasis)' }}>
    <span className="text-white/55 w-[90px] shrink-0 font-medium">{VENUE_LABEL[venue]}</span>
    <span className="tabular-nums font-semibold w-[90px] shrink-0 text-right" style={{ color: sgnColor(unrealPnl) }}>
      {fmtUsd(unrealPnl)}
    </span>
    <span className="tabular-nums text-white/65 w-[80px] shrink-0 text-right">{fmtUsdPlain(notional)}</span>
    <span className="text-white/45 tabular-nums w-[32px] shrink-0 text-right">{positionCount}</span>
    {/* 微条：未实现盈亏相对名义的比例 */}
    <div className="flex-1 h-[3px] rounded-full overflow-hidden bg-white/[0.06] min-w-[40px]">
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${Math.min(Math.abs((notional > 0 ? unrealPnl / notional : 0) * 100), 100)}%`,
          background: 'var(--color-brand)',
        }}
      />
    </div>
  </div>
);

/** Greek 方向指示条 */
const GreekBar: React.FC<{
  label: string;
  value: number;
  unit: string;
  detail?: string;
}> = ({ label, value, unit, detail }) => {
  const absVal = Math.abs(value);
  const fmtVal = absVal >= 1e6
    ? (absVal / 1e6).toFixed(2) + 'M'
    : absVal >= 1e3
      ? (absVal / 1e3).toFixed(1) + 'K'
      : absVal.toFixed(0);
  const direction = value > 0 ? '偏多' : value < 0 ? '偏空' : '中性';
  const color = value > 0 ? 'var(--color-trade-up)' : value < 0 ? 'var(--color-trade-down)' : 'rgba(255,255,255,0.4)';

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg bg-[var(--color-surface-2)]">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wider text-white/42 font-medium">{label}</span>
        <span className="text-[9px] text-white/40">{unit}</span>
      </div>
      <div className="flex items-end gap-1.5">
        <span className="text-[22px] font-bold tabular-nums leading-none" style={{ color }}>
          {value < 0 ? '-' : ''}${fmtVal}
        </span>
        <span className="text-[11px] font-medium mb-[2px]" style={{ color }}>{direction}</span>
      </div>
      {detail && <span className="text-[10px] text-white/45 leading-tight">{detail}</span>}
    </div>
  );
};

// ── Main Component ──────────────────────────────────────────────────────────

export const AssetOverviewPanel: React.FC = () => {
  const [positions, setPositions] = useState<UnifiedPosition[]>(() => getBook());
  const [fills, setFills] = useState(() => loadAllFills());
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const hasAccounts = getAccounts().length > 0;

  const btcSpot = useLiveSpot('BTC');
  const ethSpot = useLiveSpot('ETH');

  // ── 初始化和自动同步 ──
  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.all([hydrateAccountsFromBackend(), hydrateFillsFromBackend()]);
      if (!alive) return;
      setFills(loadAllFills());
      if (getAccounts().length > 0) {
        setSyncing(true);
        try {
          const p = await fetchAllPositions();
          if (alive) setPositions(p);
          if (alive) setLastSyncAt(Date.now());
        } finally {
          if (alive) setSyncing(false);
        }
      }
    })();
    return () => { alive = false; };
  }, [hasAccounts]);

  // ── 汇总计算 ──
  const realized = useMemo(() => fills.reduce((s, f) => s + f.closedPnl - f.fee, 0), [fills]);
  const thisMonth = useMemo(
    () => fills.filter(f => f.time >= Date.now() - MONTH_MS).reduce((s, f) => s + f.closedPnl - f.fee, 0),
    [fills],
  );
  const unreal = useMemo(() => positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0), [positions]);
  const totalNotional = useMemo(() => positions.reduce((s, p) => s + p.notionalUsd, 0), [positions]);
  // 总权益近似 = 保证金（名义作为代理） + 已实现盈亏 + 未实现盈亏
  const totalEquity = realized + unreal;
  // 24h 变化（近 24h 已实现盈亏）
  const dayAgo = Date.now() - 86400_000;
  const dayRealized = useMemo(
    () => fills.filter(f => f.time >= dayAgo).reduce((s, f) => s + f.closedPnl - f.fee, 0),
    [fills],
  );

  // 各所拆分
  const venueStats = useMemo(() => {
    const m = new Map<Venue, { unrealPnl: number; notional: number; count: number }>();
    for (const p of positions) {
      const e = m.get(p.venue) ?? { unrealPnl: 0, notional: 0, count: 0 };
      e.unrealPnl += p.unrealizedPnl ?? 0;
      e.notional += p.notionalUsd;
      e.count += 1;
      m.set(p.venue, e);
    }
    return [...m.entries()].sort((a, b) => b[1].notional - a[1].notional);
  }, [positions]);

  // Greeks
  const books = useMemo(
    () => buildBooks(fromAccounts(positions, { BTC: btcSpot ?? 0, ETH: ethSpot ?? 0 })),
    [positions, btcSpot, ethSpot],
  );
  const tot = useMemo(() => totals(books), [books]);

  // 同步健康
  const syncErrors = useMemo(() => getLastAccountSyncErrors(), []);
  const freshness = freshnessLabel(lastSyncAt);
  const totalPositions = positions.length;
  const totalAccounts = getAccounts().length;

  // ── 空状态 ──
  if (!hasAccounts) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
        <Activity size={20} className="text-white/45" />
        <span className="text-[12px] text-white/55">还没有接入交易所账户</span>
        <span className="text-[10px] text-white/35">添加 API key 或钱包地址后，自动同步持仓和盈亏</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* ── Section 1：总资产卡 ── */}
      <div className="flex gap-2 flex-wrap">
        <DataTile
          label="总权益"
          value={fmtUsd(totalEquity)}
          color={sgnColor(totalEquity)}
          sub={`名义 ${fmtUsdPlain(totalNotional)} · ${totalPositions} 持仓`}
        />
        <DataTile
          label="24h 变化"
          value={fmtUsd(dayRealized)}
          color={sgnColor(dayRealized)}
          sub={dayRealized >= 0 ? '近 24h 盈利' : '近 24h 亏损'}
        />
        <DataTile
          label="本月盈亏"
          value={fmtUsd(thisMonth)}
          color={sgnColor(thisMonth)}
          sub={`${fills.length} 笔成交`}
        />
        <DataTile
          label="未实现盈亏"
          value={fmtUsd(unreal)}
          color={sgnColor(unreal)}
          sub={unreal >= 0 ? '浮动浮盈' : '浮动浮亏'}
        />
      </div>

      {/* ── Section 2：各所拆分 ── */}
      {venueStats.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5 px-3 py-1.5 text-[9px] uppercase tracking-wider text-white/35 font-medium">
            <span className="w-[90px]">交易所</span>
            <span className="w-[90px] text-right">未实现盈亏</span>
            <span className="w-[80px] text-right">名义规模</span>
            <span className="w-[32px] text-right">持仓</span>
            <span className="flex-1 min-w-[40px]" />
          </div>
          {venueStats.map(([venue, stat]) => (
            <VenueRow
              key={venue}
              venue={venue}
              unrealPnl={stat.unrealPnl}
              notional={stat.notional}
              positionCount={stat.count}
            />
          ))}
        </div>
      )}

      {/* ── Section 3：Greeks 仪表 ── */}
      <div className="flex gap-2 flex-wrap">
        <GreekBar
          label="净 Delta"
          value={tot.netDelta}
          unit="$Δ 名义"
          detail={
            books.length > 0
              ? books.map(b => `${b.coin} $${(Math.abs(b.netDelta) >= 1e6 ? (b.netDelta / 1e6).toFixed(2) + 'M' : (Math.abs(b.netDelta) >= 1e3 ? (b.netDelta / 1e3).toFixed(1) + 'K' : b.netDelta.toFixed(0)))}`).join(' · ')
              : undefined
          }
        />
        <GreekBar
          label="净 Vega"
          value={tot.netVega}
          unit="每 1% IV"
          detail={
            tot.netVega < 0
              ? '净空波动 → IV 上升不利，下降有利'
              : tot.netVega > 0
                ? '净多波动 → IV 上升有利，下降不利'
                : 'Vega 中性'
          }
        />
        <GreekBar
          label="净 Gamma"
          value={tot.netGamma}
          unit="$Γ / 1%"
          detail={
            books.length > 0
              ? `凸性 ${tot.netGamma >= 0 ? '正（有利震荡）' : '负（不利震荡）'}`
              : undefined
          }
        />
        <GreekBar
          label="净 Theta"
          value={tot.netTheta}
          unit="$/天"
          detail={
            tot.netTheta > 0
              ? '正 θ → 每天收时间值'
              : tot.netTheta < 0
                ? '负 θ → 每天耗时间值'
                : 'Theta 中性'
          }
        />
      </div>

      {/* ── Section 4：账户健康 ── */}
      <div className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-lg bg-[var(--color-surface-2)]">
        {/* 同步状态点 */}
        <div className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: syncing ? 'var(--color-brand)' : freshness.color }}
          />
          <span className="text-[10px] text-white/50" style={{ color: freshness.color }}>
            {syncing ? '同步中…' : freshness.label}
          </span>
        </div>

        {/* 上次同步时间 */}
        <div className="flex items-center gap-1 text-[10px] text-white/40">
          <Clock size={10} />
          <span>{lastSyncAt ? fmtTime(lastSyncAt) : '未同步'}</span>
        </div>

        {/* 账户 / 持仓 计数 */}
        <div className="flex items-center gap-1 text-[10px] text-white/40">
          <Activity size={10} />
          <span>{totalAccounts} 个账户 · {totalPositions} 个持仓</span>
        </div>

        {/* 同步错误 */}
        {syncErrors.length > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-[var(--color-sev-extreme)]">
            <AlertTriangle size={10} />
            <span>{syncErrors.length} 个同步错误</span>
          </div>
        )}

        {syncing && (
          <RefreshCw size={12} className="text-white/30 animate-spin ml-auto" />
        )}

        {/* 数据新鲜度说明 */}
        <span className="ml-auto text-[9px] text-white/30">
          数据来源：各交易所 · 本地缓存
        </span>
      </div>
    </div>
  );
};

export default AssetOverviewPanel;
