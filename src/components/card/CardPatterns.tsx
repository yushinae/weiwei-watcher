import React from 'react';
import { cn } from '../../lib/utils';

/* HIG 字体层次：
   - 数据值: 14px semibold/bold, tabular-nums
   - 标签: 9px regular/medium, uppercase
   - 小字: 10px regular
*/

/* Stat Highlight */
export function StatHl({
  value,
  sub,
  chg,
  chgDir,
  tone = 'blue',
  className,
}: {
  value: React.ReactNode;
  sub?: React.ReactNode;
  chg?: React.ReactNode;
  chgDir?: 'up' | 'down';
  tone?: 'blue' | 'red';
  className?: string;
}) {
  return (
    <div className={cn(
      'flex items-baseline gap-3 px-3 py-2.5 rounded-[12px]',
      'bg-white/[0.03] border border-white/[0.04]',
      tone === 'red' ? 'bg-[rgba(255,69,58,0.06)]' : 'bg-[rgba(77,124,255,0.06)]',
      className
    )}>
      <span className={cn(
        'text-[20px] font-bold tnum leading-none',
        tone === 'blue' ? 'text-[var(--nexus-accent)]' : 'text-[var(--nexus-red)]'
      )}>{value}</span>
      {sub && <span className="text-[11px] font-medium text-white/40">{sub}</span>}
      {chg && <span className={cn(
        'text-[12px] font-semibold tnum ml-auto',
        chgDir === 'up' ? 'up' : chgDir === 'down' ? 'down' : ''
      )}>{chg}</span>}
    </div>
  );
}

/* Metric Grid */
export function MGrid({
  columns = 4,
  children,
  className,
}: {
  columns?: 2 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      'grid gap-3',
      columns === 4 && 'grid-cols-4',
      columns === 3 && 'grid-cols-3',
      columns === 2 && 'grid-cols-2',
      className
    )}>
      {children}
    </div>
  );
}

/* Metric Item */
export function MItem({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label className="text-[9px] font-medium uppercase tracking-[0.06em] text-white/20">{label}</label>
      <span className="text-[14px] font-semibold tnum text-white/90">{value}</span>
    </div>
  );
}

/* Ticker Row */
export function TickerRow({
  name,
  price,
  chg,
  chgDir,
  className,
}: {
  name: React.ReactNode;
  price: React.ReactNode;
  chg?: React.ReactNode;
  chgDir?: 'up' | 'down';
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3 mb-3', className)}>
      <span className="text-[13px] font-semibold text-white/50">{name}</span>
      <span className="text-[18px] font-bold tnum text-white/90">{price}</span>
      {chg && <span className={cn('text-[12px] font-semibold tnum', chgDir === 'up' ? 'up' : chgDir === 'down' ? 'down' : '')}>{chg}</span>}
    </div>
  );
}

/* Gamma Zone */
export function GammaZone({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      'flex justify-between items-center mt-3 px-2.5 py-2 rounded-[8px]',
      'bg-white/[0.02] text-[11px]',
      className
    )}>
      <span className="text-white/25">{label}</span>
      <span className="font-medium tnum text-white/50">{value}</span>
    </div>
  );
}

/* Breakdown Grid */
export function Breakdown({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      'grid grid-cols-2 gap-1 mt-1 pt-2.5 border-t border-white/[0.05]',
      className
    )}>
      {children}
    </div>
  );
}

/* Breakdown Item */
export function BdItem({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex justify-between items-center text-[11px] py-0.5', className)}>
      <span className="text-white/25">{label}</span>
      <span className="font-medium tnum text-white/50">{value}</span>
    </div>
  );
}

/* List Number */
export function ListNum({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {children}
    </div>
  );
}

/* List Item */
export function ListItem({
  num,
  text,
  tag,
  tagType,
  value,
  className,
}: {
  num: string | number;
  text: React.ReactNode;
  tag?: React.ReactNode;
  tagType?: 'hot' | 'new';
  value?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      'flex items-baseline gap-2 py-1 text-[13px] leading-snug border-b border-white/[0.04] last:border-none',
      className
    )}>
      <span className="font-medium tnum text-[11px] text-white/20 w-[18px] text-right shrink-0">{num}</span>
      <span className="text-white/85 flex-1">{text}</span>
      {tag && <span className={cn(
        'text-[9px] font-medium px-1.5 py-0.5 rounded-[3px] shrink-0',
        tagType === 'hot' && 'bg-amber-500/15 text-amber-400',
        tagType === 'new' && 'bg-emerald-500/12 text-emerald-400',
      )}>{tag}</span>}
      {value && <span className="font-medium tnum text-[11px] text-white/20 shrink-0">{value}</span>}
    </div>
  );
}

/* Prediction List */
export function PredList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {children}
    </div>
  );
}

/* Prediction Item */
export function PredItem({
  label,
  date,
  pct,
  pctDir,
  barWidth,
  value,
  className,
}: {
  label: React.ReactNode;
  date?: React.ReactNode;
  pct: string;
  pctDir: 'yes' | 'no';
  barWidth: string;
  value?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('', className)}>
      <div className="flex justify-between mb-1">
        <span className="text-[12px] font-semibold text-white/85">{label}</span>
        {date && <span className="text-[10px] tnum font-medium text-white/20">{date}</span>}
      </div>
      <div className="h-[3px] rounded-full bg-white/[0.04] overflow-hidden">
        <div className={cn(
          'h-full rounded-full transition-[width] duration-300',
          pctDir === 'yes' ? 'bg-[var(--nexus-green)]' : 'bg-[var(--nexus-red)]'
        )} style={{ width: barWidth }} />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className={cn(
          'text-[10px] font-bold tnum',
          pctDir === 'yes' ? 'up' : 'down'
        )}>{pct}</span>
        {value && <span className="text-[10px] text-white/20">{value}</span>}
      </div>
    </div>
  );
}

/* Section Label */
export function SectionLabel({
  left,
  right,
  className,
}: {
  left: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      'flex items-center justify-between mb-3 pb-2 border-b border-white/[0.04]',
      className
    )}>
      <span className="text-[9px] font-medium uppercase tracking-[0.10em] text-white/20">{left}</span>
      {right && <span className="text-[10px] text-white/20">{right}</span>}
    </div>
  );
}
