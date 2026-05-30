import React from 'react';
import { cn } from '../../../lib/utils';
import { MONITOR_TABS, type MonitorTabId, type Coin } from '../types';

function CoinSeg({ value, onChange }: { value: Coin; onChange: (c: Coin) => void }) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg bg-[var(--color-bg-base)] p-0.5 ring-1 ring-inset ring-white/[0.07]">
      {(['BTC', 'ETH'] as Coin[]).map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors duration-[120ms]',
            value === c
              ? 'bg-[var(--color-surface-2)] text-white/90 ring-1 ring-inset ring-white/[0.10]'
              : 'text-white/55 hover:text-white/80',
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
        className="sticky top-0 z-[120] h-[44px] flex items-center px-4 gap-1 shrink-0 border-b border-white/[0.07]"
        style={{ background: 'var(--color-surface-3)' }}
      >
        <span className="text-[13px] font-semibold text-white/80 shrink-0 mr-2">监控</span>
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
                tab === t.id ? 'text-white/90' : 'text-white/55 hover:text-white/80',
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

        <CoinSeg value={coin} onChange={onCoinChange} />
      </div>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
