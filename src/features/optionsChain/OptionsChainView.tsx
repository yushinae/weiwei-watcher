// ═══════════════════════════════════════════════════════════════════════════════
// Options Chain View — professional-grade options chain grid.
// Layout (11 columns):
//
//   CALLS ←                                       → PUTS
//   Last  IV%  Delta  Bid/Ask   OI  │ Strike │ OI  Bid/Ask  Delta  IV%  Last
//
// Data source: Bybit public tickers (no auth needed), 30s polling.
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from 'react';
import { Loader2, AlertCircle, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useOptionChain } from './bybitTickers';
import type { ExpiryGroup, BybitOptionTicker } from './bybitTickers';

// ── Types ─────────────────────────────────────────────────────────────────────

type Coin = 'BTC' | 'ETH';

// ── Formatting ────────────────────────────────────────────────────────────────

const pct = (v: number | null, d = 1) =>
  v != null && !isNaN(v) ? (v * 100).toFixed(d) + '%' : '—';

const pctShort = (v: number | null) =>
  v != null && !isNaN(v) ? (v * 100).toFixed(1) : '—';

const usd = (v: number | null, d = 2) =>
  v != null && !isNaN(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';

const usdCompact = (v: number | null) => {
  if (v == null || isNaN(v)) return '—';
  if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  return v.toPrecision(3);
};

const usdInt = (v: number | null) =>
  v != null && !isNaN(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';

const greek = (v: number | null, d = 3) =>
  v != null && !isNaN(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—';

const strikeFmt = (v: number) =>
  v >= 1000 ? (v / 1000).toFixed(1) + 'K' : String(v);

const daysLabel = (d: number) =>
  d < 1 ? '<1d' : d < 7 ? Math.round(d) + 'd' : Math.round(d / 7) + 'w';

// ── Delta color ───────────────────────────────────────────────────────────────

const deltaColor = (v: number | null) => {
  if (v == null || isNaN(v)) return 'text-white/30';
  return v > 0 ? 'text-trade-up' : 'text-trade-down';
};

const priceColor = (v: number | null) =>
  v != null && !isNaN(v) && v !== 0 ? 'text-white/80' : 'text-white/30';

// ── Header ────────────────────────────────────────────────────────────────────

const HEADER_CLS = 'text-[10px] font-medium text-white/35 uppercase tracking-wider';

function ChainHeader() {
  return (
    <div
      className={cn(
        'sticky top-0 z-10 grid grid-cols-[56px_48px_48px_75px_44px_60px_44px_75px_48px_48px_56px]',
        'gap-x-1 px-2 py-2 bg-card border-b border-white/10',
      )}
    >
      {/* Calls */}
      <div className={HEADER_CLS + ' text-right'}>Last</div>
      <div className={HEADER_CLS + ' text-right'}>IV%</div>
      <div className={HEADER_CLS + ' text-right'}>Δ</div>
      <div className={HEADER_CLS + ' text-right'}>Bid / Ask</div>
      <div className={HEADER_CLS + ' text-right'}>OI</div>

      {/* Strike */}
      <div className={HEADER_CLS + ' text-center text-white/45'}></div>

      {/* Puts */}
      <div className={HEADER_CLS + ' text-left'}>OI</div>
      <div className={HEADER_CLS + ' text-left'}>Bid / Ask</div>
      <div className={HEADER_CLS + ' text-left'}>Δ</div>
      <div className={HEADER_CLS + ' text-left'}>IV%</div>
      <div className={HEADER_CLS + ' text-left'}>Last</div>
    </div>
  );
}

// ── Single row ────────────────────────────────────────────────────────────────

interface RowProps {
  strike: number;
  call?: BybitOptionTicker;
  put?: BybitOptionTicker;
  isAtm: boolean;
  spot: number;
}

const CELL_CLS = 'flex items-center';
const RIGHT = 'justify-end';
const LEFT = 'justify-start';
const CENTER = 'justify-center';
const MONO = 'font-mono tabular-nums text-[11px] leading-tight';

function ChainRow({ strike, call, put, isAtm, spot }: RowProps) {
  const isAbove = strike > spot;
  const isBelow = strike < spot;

  return (
    <div
      className={cn(
        'grid grid-cols-[56px_48px_48px_75px_44px_60px_44px_75px_48px_48px_56px]',
        'gap-x-1 px-2 py-1.5 border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors cursor-pointer',
        isAtm && 'bg-brand/[0.06] border-y border-brand/[0.15]',
      )}
    >
      {/* === CALLS === */}
      <div className={cn(CELL_CLS, RIGHT, MONO, priceColor(call?.lastPrice ?? null))}>
        {call ? usdCompact(call.lastPrice) : '—'}
      </div>
      <div className={cn(CELL_CLS, RIGHT, MONO, 'text-white/70')}>
        {call ? pctShort(call.markIv) : '—'}
      </div>
      <div className={cn(CELL_CLS, RIGHT, MONO, deltaColor(call?.delta ?? null))}>
        {call ? greek(call.delta, 2) : '—'}
      </div>
      <div className={cn(CELL_CLS, RIGHT, MONO, 'text-white/45 text-[10px]')}>
        {call ? usdCompact(call.bidPrice) + '/' + usdCompact(call.askPrice) : '—'}
      </div>
      <div className={cn(CELL_CLS, RIGHT, MONO, 'text-white/55')}>
        {call ? usdInt(call.openInterest) : '—'}
      </div>

      {/* === STRIKE === */}
      <div
        className={cn(
          CELL_CLS, CENTER, MONO, 'text-xs font-bold',
          isAtm
            ? 'text-brand'
            : isAbove
              ? 'text-trade-down/60'
              : isBelow
                ? 'text-trade-up/60'
                : 'text-white/60',
        )}
      >
        {strikeFmt(strike)}
      </div>

      {/* === PUTS === */}
      <div className={cn(CELL_CLS, LEFT, MONO, 'text-white/55')}>
        {put ? usdInt(put.openInterest) : '—'}
      </div>
      <div className={cn(CELL_CLS, LEFT, MONO, 'text-white/45 text-[10px]')}>
        {put ? usdCompact(put.bidPrice) + '/' + usdCompact(put.askPrice) : '—'}
      </div>
      <div className={cn(CELL_CLS, LEFT, MONO, deltaColor(put?.delta ?? null))}>
        {put ? greek(put.delta, 2) : '—'}
      </div>
      <div className={cn(CELL_CLS, LEFT, MONO, 'text-white/70')}>
        {put ? pctShort(put.markIv) : '—'}
      </div>
      <div className={cn(CELL_CLS, LEFT, MONO, priceColor(put?.lastPrice ?? null))}>
        {put ? usdCompact(put.lastPrice) : '—'}
      </div>
    </div>
  );
}

// ── Expiry tab bar ────────────────────────────────────────────────────────────

interface ExpiryTabsProps {
  expiries: ExpiryGroup[];
  active: number;
  onSelect: (i: number) => void;
  spot: number;
}

function ExpiryTabs({ expiries, active, onSelect, spot }: ExpiryTabsProps) {
  const [showAll, setShowAll] = useState(false);
  // Show first 6 by default, full list when "more" is clicked
  const visible = showAll ? expiries : expiries.slice(0, 6);

  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
      {visible.map((e, i) => {
        const actualIdx = showAll ? i : i; // fine because visible maps directly
        const globalIdx = expiries.indexOf(e);
        return (
          <button
            key={e.label}
            onClick={() => onSelect(globalIdx)}
            className={cn(
              'flex flex-col items-center px-2.5 py-1.5 rounded-lg transition-all whitespace-nowrap',
              globalIdx === active
                ? 'bg-brand/15 text-brand'
                : 'text-white/45 hover:text-white/80 hover:bg-white/[0.05]',
            )}
          >
            <span className="text-[12px] font-semibold leading-tight">{e.label}</span>
            <span className="text-[10px] opacity-60 leading-tight">{daysLabel(e.daysToExp)}</span>
            <span className={cn(
              'text-[10px] leading-tight font-mono',
              globalIdx === active ? 'text-brand/70' : 'text-white/30',
            )}>
              {(e.atmStrike >= 1000 ? (e.atmStrike / 1000).toFixed(1) + 'K' : String(e.atmStrike))}
            </span>
          </button>
        );
      })}
      {expiries.length > 6 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex items-center px-2 py-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/[0.05] text-[11px]"
        >
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showAll && 'rotate-180')} />
        </button>
      )}
    </div>
  );
}

// ── Summary stats bar ─────────────────────────────────────────────────────────

function SummaryBar({ data }: { data: { coin: Coin; spot: number; expiries: ExpiryGroup[] } }) {
  const totalCalls = data.expiries.reduce((s, e) => s + e.calls.length, 0);
  const totalPuts = data.expiries.reduce((s, e) => s + e.puts.length, 0);
  const totalOI = data.expiries.reduce((s, e) =>
    s + e.calls.reduce((a, c) => a + c.openInterest, 0) + e.puts.reduce((a, p) => a + p.openInterest, 0), 0);

  return (
    <div className="flex items-center gap-3 text-[10px] text-white/35">
      <span>{data.coin} <span className="font-mono text-white/60">{usdInt(data.spot)}</span></span>
      <span className="w-px h-3 bg-white/10" />
      <span>{totalCalls + totalPuts} strikes</span>
      <span className="w-px h-3 bg-white/10" />
      <span>{data.expiries.length} expiries</span>
      <span className="w-px h-3 bg-white/10" />
      <span>OI {usdInt(totalOI)}</span>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

const COINS: Coin[] = ['BTC', 'ETH'];

export default function OptionsChainView() {
  const [coin, setCoin] = useState<Coin>('BTC');
  const [expiryIdx, setExpiryIdx] = useState(0);
  const [selectedRow, setSelectedRow] = useState<{
    strike: number; call?: BybitOptionTicker; put?: BybitOptionTicker;
  } | null>(null);

  const { data, loading, error } = useOptionChain(coin);

  const expiry = data?.expiries[expiryIdx];
  const safeIdx = expiry ? expiryIdx : 0;

  // Merge calls/puts by strike, sorted descending
  const allStrikes = useMemo(() => {
    if (!expiry) return [];
    const strikes = new Set<number>();
    expiry.calls.forEach(c => strikes.add(c.strike));
    expiry.puts.forEach(p => strikes.add(p.strike));
    return [...strikes].sort((a, b) => b - a);
  }, [expiry]);

  return (
    <div className="p-4 h-full flex flex-col select-none">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-white/85">Options Chain</h1>
          {data && <SummaryBar data={data} />}
        </div>

        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-white/30" />}
          <div className="flex rounded-lg bg-[var(--color-bg-base)] p-0.5 gap-0.5">
            {COINS.map(c => (
              <button
                key={c}
                onClick={() => { setCoin(c); setExpiryIdx(0); setSelectedRow(null); }}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-semibold transition-colors',
                  coin === c ? 'bg-brand/20 text-brand' : 'text-white/45 hover:text-white/80',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Expiry tabs ── */}
      {data && (
        <div className="mb-3 shrink-0">
          <ExpiryTabs
            expiries={data.expiries}
            active={safeIdx}
            onSelect={(i) => { setExpiryIdx(i); setSelectedRow(null); }}
            spot={data.spot}
          />
        </div>
      )}

      {/* ── Loading / Error ── */}
      {loading && !data && (
        <div className="flex items-center gap-2 text-white/40 text-xs py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading option chain...
        </div>
      )}
      {error && !data && (
        <div className="flex items-center gap-2 text-trade-down text-xs py-12 justify-center">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* ── Chain grid ── */}
      {expiry && (
        <div className="flex-1 min-h-0 rounded-xl border border-white/10 bg-card overflow-hidden flex flex-col">
          {/* Column header (sticky) */}
          <ChainHeader />

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">
            {allStrikes.length === 0 && (
              <div className="py-12 text-center text-white/25 text-xs">No options data for this expiry</div>
            )}
            {allStrikes.map(strike => {
              const call = expiry.calls.find(c => c.strike === strike);
              const put = expiry.puts.find(p => p.strike === strike);
              const isAtm = strike === expiry.atmStrike;
              return (
                <div
                  key={strike}
                  onClick={() =>
                    setSelectedRow(
                      selectedRow?.strike === strike ? null : { strike, call, put },
                    )
                  }
                >
                  <ChainRow strike={strike} call={call} put={put} isAtm={isAtm} spot={data.spot} />
                  {/* Detail row */}
                  {selectedRow?.strike === strike && (
                    <DetailRow
                      coin={coin}
                      spot={data.spot}
                      strike={strike}
                      call={call}
                      put={put}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom spot bar */}
          <div className="shrink-0 border-t border-white/10 bg-card/80 px-3 py-1.5 text-[10px] text-white/35 flex items-center justify-between">
            <span>Index Price</span>
            <span className="font-mono text-white/60">{usdInt(data.spot)} USDT</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detail expandable row ─────────────────────────────────────────────────────

function DetailRow({
  coin,
  spot,
  strike,
  call,
  put,
}: {
  coin: Coin;
  spot: number;
  strike: number;
  call?: BybitOptionTicker;
  put?: BybitOptionTicker;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 px-4 py-3 bg-white/[0.02] border-b border-white/[0.06] text-[11px]">
      {/* Call detail */}
      <div>
        {call ? (
          <div className="grid grid-cols-3 gap-x-4 gap-y-1">
            <DetailItem label="Mark IV" value={pct(call.markIv, 2)} />
            <DetailItem label="Bid IV" value={pct(call.bidIv, 2)} />
            <DetailItem label="Ask IV" value={pct(call.askIv, 2)} />
            <DetailItem label="Gamma" value={greek(call.gamma)} />
            <DetailItem label="Vega" value={usd(call.vega, 2)} />
            <DetailItem label="Theta" value={usd(call.theta, 2)} />
            <DetailItem label="Volume 24h" value={usdInt(call.volume24h)} />
            <DetailItem label="Turnover" value={usd(call.turnover24h)} />
            <DetailItem label="Change 24h" value={pct(call.change24h, 2)} color={call.change24h > 0 ? 'text-trade-up' : call.change24h < 0 ? 'text-trade-down' : undefined} />
          </div>
        ) : (
          <div className="text-white/25 italic">No call data</div>
        )}
      </div>

      {/* Put detail */}
      <div>
        {put ? (
          <div className="grid grid-cols-3 gap-x-4 gap-y-1">
            <DetailItem label="Mark IV" value={pct(put.markIv, 2)} />
            <DetailItem label="Bid IV" value={pct(put.bidIv, 2)} />
            <DetailItem label="Ask IV" value={pct(put.askIv, 2)} />
            <DetailItem label="Gamma" value={greek(put.gamma)} />
            <DetailItem label="Vega" value={usd(put.vega, 2)} />
            <DetailItem label="Theta" value={usd(put.theta, 2)} />
            <DetailItem label="Volume 24h" value={usdInt(put.volume24h)} />
            <DetailItem label="Turnover" value={usd(put.turnover24h)} />
            <DetailItem label="Change 24h" value={pct(put.change24h, 2)} color={put.change24h > 0 ? 'text-trade-up' : put.change24h < 0 ? 'text-trade-down' : undefined} />
          </div>
        ) : (
          <div className="text-white/25 italic">No put data</div>
        )}
      </div>
    </div>
  );
}

function DetailItem({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-white/35">{label}</span>
      <span className={cn('font-mono tabular-nums text-white/70', color)}>{value}</span>
    </div>
  );
}
