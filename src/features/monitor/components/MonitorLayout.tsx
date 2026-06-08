import React from 'react';
import { cn } from '../../../lib/utils';
import { MONITOR_TABS, type MonitorTabId, type Coin } from '../types';

function CoinSeg({ value, onChange }: { value: Coin; onChange: (c: Coin) => void }) {
  return (
    <div className="inline-flex gap-0.5 rounded-md bg-[#111111] p-0.5 ring-1 ring-inset ring-white/[0.055]">
      {(['BTC', 'ETH'] as Coin[]).map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            'rounded-[5px] px-2.5 py-0.5 text-[11px] font-semibold transition-colors duration-[120ms]',
            value === c
              ? 'bg-white/[0.075] text-white/88 ring-1 ring-inset ring-white/[0.09]'
              : 'text-white/48 hover:text-white/72',
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
        className="sticky top-0 z-[120] h-[38px] flex items-center px-4 gap-1 shrink-0 border-b border-white/[0.045]"
        style={{ background: '#181818' }}
      >
        <span className="text-[12px] font-semibold text-white/62 shrink-0 mr-2">监控</span>
        <div className="w-px h-4 bg-white/[0.055] mr-2 shrink-0" />

        {/* Tabs */}
        <div className="flex items-end h-full gap-0.5">
          {MONITOR_TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={cn(
                'relative h-full px-3 text-[12px] font-semibold tracking-normal transition-colors select-none outline-none focus-visible:text-white/90',
                tab === t.id ? 'text-white/88' : 'text-white/45 hover:text-white/70',
              )}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-t-full bg-[var(--nexus-accent)] shadow-[0_0_10px_rgba(30,144,255,0.35)]" />
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
