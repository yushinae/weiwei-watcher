// Top-nav options picker. Inspired by exchange-style option menus: product groups
// are wide sections, underlyings are columns, and expiry dates align as rows.

import React from 'react';
import { cn } from '../../lib/utils';
import { UNDERLYING_GROUPS, tagColor, useOCStore, useUnderlyingExpiries, ocStore } from './store';
import type { ExpiryMeta } from './store';

const PANEL_STYLE: React.CSSProperties = {
  background: 'var(--color-dropdown, #1F1F1F)',
  border: '1px solid rgba(255,255,255,0.11)',
  borderRadius: 10,
  boxShadow: '0 28px 72px rgba(0,0,0,0.62), inset 0 1px 0 rgba(255,255,255,0.05)',
  overflow: 'hidden',
  width: 'min(760px, calc(100vw - 24px))',
  maxHeight: 'min(620px, calc(100vh - 72px))',
};

const COIN_GLYPH: Record<string, string> = { BTC: '₿', ETH: 'Ξ' };
const tagTone = (tag: string) => {
  if (tag === 'Bybit') return { text: '#f7a600', border: 'rgba(247,166,0,0.28)', bg: 'rgba(247,166,0,0.10)' };
  if (tag === 'Deribit') return { text: '#1E90FF', border: 'rgba(30,144,255,0.30)', bg: 'rgba(30,144,255,0.10)' };
  return { text: 'rgba(255,255,255,0.50)', border: 'rgba(255,255,255,0.14)', bg: 'rgba(255,255,255,0.055)' };
};

type MenuItem = { value: string; coin: string; tag?: string };
type MatrixGroup = {
  title: string;
  subtitle: string;
  tag: string;
  items: MenuItem[];
  accent?: string;
};

interface UnderlyingHeaderProps { value: string; coin: string; tag: string; onPick?: () => void }

const UnderlyingHeader: React.FC<UnderlyingHeaderProps> = ({ value, coin, tag, onPick }) => {
  const underlying = useOCStore(s => s.underlying);
  const isActiveCol = underlying === value;
  const tone = tagTone(tag);

  return (
    <button
      onClick={() => { ocStore.setUnderlying(value); ocStore.setExpiryIdx(0); onPick?.(); }}
      className="relative flex h-[42px] min-w-0 items-center gap-2 rounded-[8px] border px-2.5 text-left transition-colors overflow-hidden"
      style={{
        background: isActiveCol ? 'rgba(79,147,221,0.10)' : 'rgba(255,255,255,0.040)',
        borderColor: isActiveCol ? 'rgba(79,147,221,0.40)' : 'rgba(255,255,255,0.070)',
      }}
      onMouseEnter={ev => { if (!isActiveCol) ev.currentTarget.style.background = 'rgba(255,255,255,0.065)'; }}
      onMouseLeave={ev => { if (!isActiveCol) ev.currentTarget.style.background = 'rgba(255,255,255,0.040)'; }}
      title={value}
    >
      {isActiveCol && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-[var(--db-accent,#4F93DD)]" />}
      <span
        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold"
        style={{
          color: tone.text,
          background: tone.bg,
        }}
      >
        {COIN_GLYPH[coin] ?? coin[0]}
      </span>
      <span className="flex min-w-0 flex-col leading-none">
        <span className={cn('truncate font-mono text-[12px] font-extrabold', isActiveCol ? 'text-white/95' : 'text-white/78')}>{value}</span>
        <span className="mt-1 truncate text-[9px] font-bold text-white/36">{tag}</span>
      </span>
    </button>
  );
};

interface ExpiryCellProps { item: MenuItem; tag: string; expiry: ExpiryMeta; index: number; onPick?: () => void }

const ExpiryCell: React.FC<ExpiryCellProps> = ({ item, tag, expiry, index, onPick }) => {
  const underlying = useOCStore(s => s.underlying);
  const expiryIdx = useOCStore(s => s.expiryIdx);
  const on = underlying === item.value && index === expiryIdx;
  const tone = tagTone(item.tag ?? tag);

  return (
    <button
      onClick={() => { ocStore.setUnderlying(item.value); ocStore.setExpiryIdx(index); onPick?.(); }}
      className="h-[31px] rounded-[7px] border px-2 text-center font-mono text-[11px] font-bold tabular-nums transition-colors"
      style={{
        background: on ? 'rgba(79,147,221,0.16)' : 'rgba(255,255,255,0.042)',
        borderColor: on ? 'rgba(79,147,221,0.42)' : 'rgba(255,255,255,0.055)',
        color: on ? '#EAF4FF' : 'rgba(255,255,255,0.70)',
        boxShadow: on ? `inset 0 0 0 1px ${tone.border}` : undefined,
      }}
      onMouseEnter={ev => { if (!on) ev.currentTarget.style.background = 'rgba(255,255,255,0.075)'; }}
      onMouseLeave={ev => { if (!on) ev.currentTarget.style.background = 'rgba(255,255,255,0.042)'; }}
      title={`${item.value} ${expiry.dateLabel}`}
    >
      {expiry.dateLabel}
    </button>
  );
};

function EmptyExpiryCell() {
  return <div className="h-[31px] rounded-[7px] border border-dashed border-white/[0.035] bg-white/[0.018]" />;
}

interface MatrixSectionProps extends MatrixGroup { expiryMap: Record<string, ExpiryMeta[]>; onPick?: () => void }

const MatrixSection: React.FC<MatrixSectionProps> = ({ title, subtitle, tag, items, expiryMap, onPick, accent }) => {
  const maxRows = Math.max(0, ...items.map(it => (expiryMap[it.value] ?? []).length));
  const tone = tagTone(tag);

  return (
    <section className="min-w-0 flex-1">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent ?? tagColor(tag) }} />
            <h3 className="text-[13px] font-extrabold leading-none text-white/88">{title}</h3>
          </div>
          <div className="mt-1 text-[10px] font-semibold leading-none text-white/34">{subtitle}</div>
        </div>
        <span
          className="shrink-0 rounded-[5px] border px-1.5 py-0.5 text-[9px] font-extrabold uppercase leading-none"
          style={{ color: tone.text, borderColor: tone.border, background: tone.bg }}
        >
          {tag}
        </span>
      </div>

      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(104px, 1fr))` }}
      >
        {items.map(it => <UnderlyingHeader key={it.value} value={it.value} coin={it.coin} tag={it.tag ?? tag} onPick={onPick} />)}

        {maxRows === 0 && items.map(it => (
          <div key={`${it.value}-empty`} className="h-[31px] rounded-[7px] border border-white/[0.04] bg-white/[0.025] px-2 text-center text-[11px] font-semibold leading-[31px] text-white/25">
            加载中
          </div>
        ))}

        {Array.from({ length: maxRows }).map((_, rowIndex) => (
          <React.Fragment key={`row-${rowIndex}`}>
            {items.map(it => {
              const expiry = expiryMap[it.value]?.[rowIndex];
              return expiry
                ? <ExpiryCell key={`${it.value}-${expiry.key}`} item={it} tag={it.tag ?? tag} expiry={expiry} index={rowIndex} onPick={onPick} />
                : <EmptyExpiryCell key={`${it.value}-empty-${rowIndex}`} />;
            })}
          </React.Fragment>
        ))}

        {items.map(it => (
          <button
            key={`${it.value}-combo`}
            onClick={() => { ocStore.setUnderlying(it.value); ocStore.setExpiryIdx(0); onPick?.(); }}
            className="mt-1 h-[30px] rounded-[7px] border px-2 text-[11px] font-extrabold transition-colors"
            style={{
              background: 'rgba(255,255,255,0.030)',
              borderColor: 'rgba(255,255,255,0.075)',
              color: 'rgba(255,255,255,0.58)',
            }}
            onMouseEnter={ev => {
              ev.currentTarget.style.background = 'rgba(79,147,221,0.10)';
              ev.currentTarget.style.borderColor = 'rgba(79,147,221,0.30)';
              ev.currentTarget.style.color = '#EAF4FF';
            }}
            onMouseLeave={ev => {
              ev.currentTarget.style.background = 'rgba(255,255,255,0.030)';
              ev.currentTarget.style.borderColor = 'rgba(255,255,255,0.075)';
              ev.currentTarget.style.color = 'rgba(255,255,255,0.58)';
            }}
          >
            {it.coin} 组合
          </button>
        ))}
      </div>
    </section>
  );
};

export function OptionsHoverMenu({
  onMouseEnter, onMouseLeave, onPick, className,
}: {
  onMouseEnter?: React.MouseEventHandler;
  onMouseLeave?: React.MouseEventHandler;
  onPick?: () => void;
  className?: string;
}) {
  const current = useOCStore(s => s.underlying);
  const expiryMap = useUnderlyingExpiries(); // fetched once for the whole menu
  const currentExpiries = expiryMap[current] ?? [];
  const currentExpiry = currentExpiries[ocStore.getState().expiryIdx]?.dateLabel ?? '加载中';
  const inverseGroup = UNDERLYING_GROUPS.find(g => g.title.startsWith('Inverse'));
  const usdcGroup = UNDERLYING_GROUPS.find(g => g.title.includes('USDC'));
  const usdtGroup = UNDERLYING_GROUPS.find(g => g.title.includes('USDT'));
  const leftGroups: MatrixGroup[] = inverseGroup ? [{
    title: 'Inverse Options',
    subtitle: 'Coin settled',
    tag: inverseGroup.tag,
    items: inverseGroup.items,
    accent: 'rgba(255,255,255,0.50)',
  }] : [];
  const linearItems: MenuItem[] = [
    ...(usdcGroup?.items.map(it => ({ ...it, tag: usdcGroup.tag })) ?? []),
    ...(usdtGroup?.items.map(it => ({ ...it, tag: usdtGroup.tag })) ?? []),
  ];
  const linearGroup: MatrixGroup | null = linearItems.length > 0 ? {
    title: 'Linear Options',
    subtitle: usdtGroup ? 'USDC / USDT settled' : 'USDC settled',
    tag: usdtGroup ? 'USDC / USDT' : usdcGroup?.tag ?? 'Linear',
    items: linearItems,
    accent: 'var(--db-accent,#4F93DD)',
  } : null;

  return (
    <div className={className} style={PANEL_STYLE} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-3 py-3">
        <div className="flex flex-col leading-none min-w-0">
          <span className="text-[13px] font-extrabold text-white/88">期权链</span>
          <span className="mt-1 text-[10px] font-semibold text-white/34">Inverse · Linear · BTC / ETH</span>
        </div>
        <div className="min-w-[172px] rounded-[8px] border border-white/[0.07] bg-white/[0.035] px-2.5 py-2 text-right leading-none">
          <div className="text-[9px] font-bold uppercase text-white/30">当前</div>
          <div className="mt-1 truncate font-mono text-[12px] font-extrabold text-white/82">{current}</div>
          <div className="mt-1 truncate font-mono text-[10px] font-bold text-[var(--db-accent,#4F93DD)]">{currentExpiry}</div>
        </div>
      </div>

      <div
        className="grid gap-3 overflow-auto p-3 md:grid-cols-[252px_1px_minmax(0,1fr)]"
        style={{ maxHeight: 'min(540px, calc(100vh - 150px))' }}
      >
        <div className="min-w-0 rounded-[9px] border border-white/[0.075] bg-white/[0.030] p-3">
          {leftGroups.map(g => <MatrixSection key={`${g.title}-${g.subtitle}`} {...g} expiryMap={expiryMap} onPick={onPick} />)}
        </div>

        <div className="hidden w-px self-stretch bg-white/[0.075] md:block" />

        <div className="min-w-0 rounded-[9px] border border-white/[0.075] bg-white/[0.030] p-3">
          {linearGroup && <MatrixSection {...linearGroup} expiryMap={expiryMap} onPick={onPick} />}
        </div>
      </div>
    </div>
  );
}
