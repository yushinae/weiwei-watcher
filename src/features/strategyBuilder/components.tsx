import React, { useMemo } from 'react';
import { cn } from '../../lib/utils';
import { instantiateTemplate, payoffAt } from './helpers';
import type { StrategyTemplate, MarketPreset } from './types';

// Titled section card used across the strategy builder layout.
export function Panel({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('bg-[#17181E] rounded-[8px] overflow-hidden min-h-0 flex flex-col', className)}>
      {(title || action) && (
        <div className="h-10 shrink-0 px-3 flex items-center justify-between border-b border-white/[0.06]">
          <div className="text-[13px] font-semibold text-white/75">{title}</div>
          {action}
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

// Sparkline preview of a template's expiry payoff, shown in the template picker.
export function MiniPayoff({ template, market }: { template: StrategyTemplate; market: MarketPreset }) {
  const points = useMemo(() => {
    if (template.legs.length === 0) return [];
    const baseLegs = instantiateTemplate(template, market, market.spot, market.iv);
    const xs = Array.from({ length: 28 }, (_, i) => market.spot * (0.84 + i * 0.012));
    return xs.map(S => baseLegs.reduce((sum, leg) => sum + payoffAt(leg, S, 0, market.iv, 'pnl'), 0));
  }, [market, template]);

  if (points.length === 0) {
    return <div className="h-10 rounded-[6px] bg-[#2B2D35]" />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points.map((p, index) => {
    const x = 2 + index * (92 / (points.length - 1));
    const y = 38 - ((p - min) / span) * 34;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const zeroY = 38 - ((0 - min) / span) * 34;

  return (
    <svg className="h-11 w-full" viewBox="0 0 98 42" aria-hidden="true">
      <line x1="2" x2="96" y1={Math.max(4, Math.min(38, zeroY))} y2={Math.max(4, Math.min(38, zeroY))} stroke="rgba(255,255,255,.18)" strokeWidth="1" />
      <path d={path} fill="none" stroke="var(--nexus-accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
