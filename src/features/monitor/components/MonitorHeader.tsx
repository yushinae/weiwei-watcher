import React from 'react';
import { cn } from '../../../lib/utils';
import { MONITOR_RANGES, MONITOR_TENORS, type Coin, type MonitorRange, type MonitorTenor } from '../types';

function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
  accent,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  className?: string;
  size?: 'sm' | 'md';
  accent?: 'btc' | 'eth' | 'brand';
}) {
  const activeCls =
    accent === 'btc'
      ? 'bg-[color:var(--monitor-accent-btc)]/15 text-[color:var(--monitor-accent-btc)]'
      : accent === 'eth'
        ? 'bg-[color:var(--monitor-accent-eth)]/15 text-[color:var(--monitor-accent-eth)]'
        : 'bg-brand-blue/15 text-brand-blue';

  return (
    <div
      className={cn(
        'inline-flex gap-0.5 rounded-[10px] bg-surface-4/40 p-0.5 ring-1 ring-inset ring-border-subtle/70',
        size === 'sm' ? 'text-[11px]' : 'text-[12px]',
        className,
      )}
    >
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'relative rounded-[8px] px-3 py-1.5 font-bold tracking-[-0.01em] transition-colors',
            'text-slate-500 hover:text-slate-300',
            value === o.value && cn(activeCls, 'shadow-[0_0_0_1px_rgba(77,124,255,0.18)]'),
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MonitorHeader({
  coin,
  range,
  tenor,
  onCoinChange,
  onRangeChange,
  onTenorChange,
  right,
}: {
  coin: Coin;
  range: MonitorRange;
  tenor: MonitorTenor;
  onCoinChange: (c: Coin) => void;
  onRangeChange: (r: MonitorRange) => void;
  onTenorChange: (t: MonitorTenor) => void;
  right?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-[120] glass-nav h-[44px]">
      <div className="flex items-center gap-4 px-5 h-full">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-[10px] bg-surface-2 ring-1 ring-inset ring-border-subtle grid place-items-center">
            <div className="h-2.5 w-2.5 rounded-full bg-brand-blue shadow-[0_0_14px_var(--monitor-signal-glow)]" />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-extrabold text-slate-100 tracking-[-0.02em]">监控</div>
            <div className="text-[10px] text-text-muted tnum">Workspace · Live</div>
          </div>
        </div>

        <div className="ml-2 flex flex-wrap items-center gap-2">
          <Segmented<Coin>
            value={coin}
            onChange={onCoinChange}
            accent={coin === 'BTC' ? 'btc' : 'eth'}
            options={[
              { value: 'BTC', label: 'BTC' },
              { value: 'ETH', label: 'ETH' },
            ]}
          />

          <Segmented<MonitorRange>
            value={range}
            onChange={onRangeChange}
            accent="brand"
            size="sm"
            options={MONITOR_RANGES.map(r => ({ value: r, label: r === 'CUSTOM' ? '自定义' : r }))}
          />

          <Segmented<MonitorTenor>
            value={tenor}
            onChange={onTenorChange}
            accent="brand"
            size="sm"
            options={MONITOR_TENORS.map(t => ({ value: t, label: t }))}
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-[12px] bg-surface-2/60 px-3 py-2 ring-1 ring-inset ring-border-subtle/70">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-trade-up/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-trade-up" />
            </span>
            <span className="text-[11px] text-slate-400">实时</span>
          </div>
          {right}
        </div>
      </div>
    </div>
  );
}

