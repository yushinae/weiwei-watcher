import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { MONITOR_TABS, type MonitorTabId, type Coin } from '../types';

function CoinSeg({ value, onChange }: { value: Coin; onChange: (c: Coin) => void }) {
  return (
    <div className="inline-flex gap-0.5 rounded-[8px] bg-white/[0.04] p-0.5 border border-white/[0.07]">
      {(['BTC', 'ETH'] as Coin[]).map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            'rounded-[6px] px-2.5 py-1 text-[11px] font-semibold transition-colors',
            value === c
              ? c === 'BTC'
                ? 'bg-amber-500/15 text-amber-300'
                : 'bg-blue-500/15 text-blue-300'
              : 'text-white/35 hover:text-white/60',
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

export function MonitorLayout({
  tab, onTabChange,
  coin, onCoinChange,
  children,
}: {
  tab: MonitorTabId;
  onTabChange: (t: MonitorTabId) => void;
  coin: Coin;
  onCoinChange: (c: Coin) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="sticky top-0 z-[120] h-[44px] flex items-center px-4 gap-1 shrink-0 border-b border-white/[0.06]"
        style={{ background: 'var(--base-dim)' }}
      >
        <span className="text-[13px] font-semibold text-white/60 shrink-0 mr-2">监控</span>
        <div className="w-px h-4 bg-white/[0.08] mr-2 shrink-0" />

        {/* Tabs */}
        <div className="flex items-end h-full gap-0.5">
          {MONITOR_TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={cn(
                'relative h-full px-3.5 text-[12px] font-semibold tracking-[-0.01em] transition-colors select-none',
                tab === t.id ? 'text-white/90' : 'text-white/35 hover:text-white/60',
              )}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t-full bg-[var(--nexus-accent)]" />
              )}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2 shrink-0">
          <CoinSeg value={coin} onChange={onCoinChange} />
          <div className="w-px h-4 bg-white/[0.08] mx-1 shrink-0" />
          <Link
            to="/position-builder"
            className="text-[11px] text-white/35 hover:text-[var(--nexus-accent)] transition-colors font-medium no-underline shrink-0"
          >
            头寸 →
          </Link>
        </div>
      </div>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
