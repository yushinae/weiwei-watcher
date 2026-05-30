// ═══════════════════════════════════════════════════════════════════════════════
// Options Chain View — displays Bybit option chain with expiry tabs and strike
// grid showing IV, bid/ask, Greeks, and volume/OI.
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useOptionChain } from './bybitTickers';
import type { ExpiryGroup, BybitOptionTicker } from './bybitTickers';

// ── Formatting ────────────────────────────────────────────────────────────────

const pct = (v: number | null, decimals = 1) =>
  v !== null && !isNaN(v) ? `${(v * 100).toFixed(decimals)}%` : '—';

const usd = (v: number | null, decimals = 2) =>
  v !== null && !isNaN(v) ? v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '—';

const usdInt = (v: number | null) =>
  v !== null && !isNaN(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';

const greek4 = (v: number | null) =>
  v !== null && !isNaN(v) ? v.toFixed(4) : '—';

const strikeFmt = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v);

// ── Coin toggle ───────────────────────────────────────────────────────────────

type Coin = 'BTC' | 'ETH';

const COINS: Coin[] = ['BTC', 'ETH'];

// ── Expiry tab ────────────────────────────────────────────────────────────────

function ExpiryTabs({
  expiries,
  active,
  onSelect,
}: {
  expiries: ExpiryGroup[];
  active: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-none">
      {expiries.map((e, i) => (
        <button
          key={e.label}
          onClick={() => onSelect(i)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
            i === active
              ? 'bg-brand/20 text-brand'
              : 'text-white/55 hover:text-white/80 hover:bg-white/5',
          )}
        >
          <span className="tabular-nums">{e.label}</span>
          <span className="ml-1.5 text-[10px] text-white/40">
            {e.daysToExp < 1 ? '<1d' : `${Math.round(e.daysToExp)}d`}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Strike row ────────────────────────────────────────────────────────────────

function StrikeRow({
  strike,
  call,
  put,
  isAtm,
  spot,
}: {
  strike: number;
  call: BybitOptionTicker | undefined;
  put: BybitOptionTicker | undefined;
  isAtm: boolean;
  spot: number;
}) {
  const isAboveSpot = strike > spot;
  const isBelowSpot = strike < spot;

  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_80px_70px_70px_1fr] gap-x-2 items-center px-3 py-1.5 text-xs border-b border-white/5 last:border-0',
        isAtm && 'bg-brand/8 border-y border-brand/20',
      )}
    >
      {/* Call IV */}
      <div className={cn('text-right font-mono tabular-nums', call ? 'text-white/80' : 'text-white/20')}>
        {call ? pct(call.markIv) : '—'}
      </div>

      {/* Call bid/ask */}
      <div className="text-right font-mono tabular-nums text-white/50 text-[11px]">
        {call ? `${usd(call.bidPrice)} / ${usd(call.askPrice, 1)}` : '—'}
      </div>

      {/* Strike */}
      <div
        className={cn(
          'text-center font-mono tabular-nums text-sm font-semibold',
          isAtm ? 'text-brand' : isAboveSpot ? 'text-trade-up/70' : isBelowSpot ? 'text-trade-down/70' : 'text-white/70',
        )}
      >
        {strikeFmt(strike)}
      </div>

      {/* Put bid/ask */}
      <div className="text-left font-mono tabular-nums text-white/50 text-[11px]">
        {put ? `${usd(put.bidPrice)} / ${usd(put.askPrice, 1)}` : '—'}
      </div>

      {/* Put IV */}
      <div className={cn('text-left font-mono tabular-nums', put ? 'text-white/80' : 'text-white/20')}>
        {put ? pct(put.markIv) : '—'}
      </div>
    </div>
  );
}

// ── Column headers ────────────────────────────────────────────────────────────

function ChainHeader() {
  return (
    <div className="grid grid-cols-[1fr_80px_70px_70px_1fr] gap-x-2 px-3 py-2 text-[10px] font-medium text-white/40 uppercase tracking-wider border-b border-white/10">
      <div className="text-right">Call IV</div>
      <div className="text-right">Bid / Ask</div>
      <div className="text-center">Strike</div>
      <div className="text-left">Bid / Ask</div>
      <div className="text-left">Put IV</div>
    </div>
  );
}

// ── Detail popover ────────────────────────────────────────────────────────────

function DetailPopover({
  ticker,
  onClose,
}: {
  ticker: BybitOptionTicker | null;
  onClose: () => void;
}) {
  if (!ticker) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 w-56 rounded-xl border border-white/10 bg-[#1C1C1C] shadow-2xl p-3 text-[11px]"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-white/90">{ticker.symbol}</span>
        <button onClick={onClose} className="text-white/30 hover:text-white/60 text-base leading-none">&times;</button>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <span className="text-white/50">Mark IV</span><span className="text-right font-mono">{pct(ticker.markIv)}</span>
        <span className="text-white/50">Bid IV</span><span className="text-right font-mono">{pct(ticker.bidIv)}</span>
        <span className="text-white/50">Ask IV</span><span className="text-right font-mono">{pct(ticker.askIv)}</span>
        <span className="text-white/50">Delta</span><span className="text-right font-mono">{greek4(ticker.delta)}</span>
        <span className="text-white/50">Gamma</span><span className="text-right font-mono">{greek4(ticker.gamma)}</span>
        <span className="text-white/50">Vega</span><span className="text-right font-mono">{usd(ticker.vega, 2)}</span>
        <span className="text-white/50">Theta</span><span className="text-right font-mono">{usd(ticker.theta, 2)}</span>
        <span className="text-white/50">OI</span><span className="text-right font-mono">{usdInt(ticker.openInterest)}</span>
        <span className="text-white/50">Vol 24h</span><span className="text-right font-mono">{usdInt(ticker.volume24h)}</span>
        <span className="text-white/50">Mark Price</span><span className="text-right font-mono">{usd(ticker.markPrice, 2)}</span>
      </div>
    </motion.div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function OptionsChainView() {
  const [coin, setCoin] = useState<Coin>('BTC');
  const [expiryIdx, setExpiryIdx] = useState(0);
  const [detailTicker, setDetailTicker] = useState<BybitOptionTicker | null>(null);

  const { data, loading, error } = useOptionChain(coin);

  const expiry = data?.expiries[expiryIdx];
  // Reset expiry index when coin changes or expiries shrink
  const safeIdx = expiry ? expiryIdx : 0;

  // Merge calls and puts by strike
  const allStrikes = expiry
    ? [...new Set([
        ...expiry.calls.map(c => c.strike),
        ...expiry.puts.map(p => p.strike),
      ])].sort((a, b) => b - a) // descending: highest strike first
    : [];

  return (
    <div className="p-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-base font-semibold text-white/90">Options Chain</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/40">
            {data ? `${data.expiries.length} expiries` : ''}
          </span>
          <div className="flex rounded-lg bg-[#111] p-0.5 gap-0.5">
            {COINS.map(c => (
              <button
                key={c}
                onClick={() => { setCoin(c); setExpiryIdx(0); setDetailTicker(null); }}
                className={cn(
                  'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                  coin === c ? 'bg-brand/20 text-brand' : 'text-white/50 hover:text-white/80',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center gap-2 text-white/50 text-xs py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading option chain...
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-trade-down text-xs py-8 justify-center">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Expiry tabs */}
          <div className="relative mb-3">
            <ExpiryTabs
              expiries={data.expiries}
              active={safeIdx}
              onSelect={(i) => { setExpiryIdx(i); setDetailTicker(null); }}
            />
          </div>

          {/* Chain table */}
          {expiry && (
            <div className="relative flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/10 bg-card">
              <ChainHeader />
              <div className="relative">
                {allStrikes.map(strike => {
                  const call = expiry.calls.find(c => c.strike === strike);
                  const put = expiry.puts.find(p => p.strike === strike);
                  const isAtm = strike === expiry.atmStrike;
                  return (
                    <div
                      key={strike}
                      className="relative cursor-pointer"
                      onClick={() => setDetailTicker(detailTicker?.strike === strike ? null : (call || put || null))}
                    >
                      <StrikeRow
                        strike={strike}
                        call={call}
                        put={put}
                        isAtm={isAtm}
                        spot={data.spot}
                      />
                      <AnimatePresence>
                        {detailTicker?.strike === strike && (
                          <DetailPopover
                            ticker={detailTicker}
                            onClose={() => setDetailTicker(null)}
                          />
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
              {allStrikes.length === 0 && (
                <div className="py-8 text-center text-white/30 text-xs">No options data available</div>
              )}

              {/* Spot price bar */}
              <div className="sticky bottom-0 border-t border-white/10 bg-card px-3 py-1.5 text-[11px] text-white/40 flex justify-between">
                <span>Spot</span>
                <span className="font-mono">{usdInt(data.spot)} USDT</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
