import React from 'react';
import { cn } from '../../lib/utils';

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
    <div className={cn('stat-hl', tone === 'red' && 'hl-red', className)}>
      <span className={cn('big', tone === 'blue' ? 'big blue' : 'big red')}>{value}</span>
      {sub && <span className="sub">{sub}</span>}
      {chg && <span className={cn('chg', chgDir === 'up' ? 'up' : chgDir === 'down' ? 'down' : '')}>{chg}</span>}
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
    <div className={cn('m-grid', `c${columns}`, className)}>
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
    <div className={cn('m-item', className)}>
      <label>{label}</label>
      <span className="v">{value}</span>
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
    <div className={cn('ticker-row', className)}>
      <span className="ticker-name">{name}</span>
      <span className="ticker-price">{price}</span>
      {chg && <span className={cn('ticker-chg', chgDir === 'up' ? 'up' : chgDir === 'down' ? 'down' : '')}>{chg}</span>}
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
    <div className={cn('gamma-zone', className)}>
      <span className="l">{label}</span>
      <span className="v">{value}</span>
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
    <div className={cn('breakdown', className)}>
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
    <div className={cn('bd-item', className)}>
      <span className="l">{label}</span>
      <span className="v">{value}</span>
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
    <div className={cn('list-num', className)}>
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
    <div className={cn('list-item', className)}>
      <span className="num">{num}</span>
      <span className="text">{text}</span>
      {tag && <span className={cn('tag', tagType)}>{tag}</span>}
      {value && <span className="val-r">{value}</span>}
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
    <div className={cn('pred', className)}>
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
    <div className={cn('pred-item', className)}>
      <div className="p-top">
        <span className="p-l">{label}</span>
        {date && <span className="p-r">{date}</span>}
      </div>
      <div className="pred-bar">
        <div className={cn('fill', pctDir)} style={{ width: barWidth }} />
      </div>
      <div className="p-bot">
        <span className={cn('p-pct', pctDir)}>{pct}</span>
        {value && <span className="p-date">{value}</span>}
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
    <div className={cn('section-label', className)}>
      <span className="l">{left}</span>
      {right && <span className="r">{right}</span>}
    </div>
  );
}
