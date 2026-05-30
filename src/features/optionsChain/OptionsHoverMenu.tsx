// Deribit-style 标的 + 到期日 picker. Underlyings are column headers; each column
// lists its own expiry dates below (like Deribit's expiry dropdown). Self-styled so
// it can render inside the global nav as well as the page.

import React, { useState } from 'react';
import { cn } from '../../lib/utils';
import { UNDERLYING_GROUPS, sourceOf, tagColor, useOCStore, useUnderlyingExpiries, ocStore } from './store';
import type { DataSource } from './chainModel';

const SOURCES: { key: DataSource; label: string }[] = [
  { key: 'deribit', label: 'Deribit' },
  { key: 'bybit', label: 'Bybit' },
];

const PANEL_STYLE: React.CSSProperties = {
  background: 'var(--color-dropdown, #1F1F1F)',  // L2 下拉
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,                               // 弹窗/下拉 10px
  boxShadow: '0 24px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)',
  overflow: 'hidden',
  // Fixed min width so switching Deribit↔Bybit doesn't shrink the panel and
  // drop the cursor outside it (which would close the hover menu).
  minWidth: 484,
  maxWidth: 'calc(100vw - 24px)',
};

const COIN_GLYPH: Record<string, string> = { BTC: '₿', ETH: 'Ξ' };

interface ExpiryColumnProps { value: string; coin: string; tag: string; onPick?: () => void }

function ExpiryColumn({ value, coin, tag, onPick }: ExpiryColumnProps) {
  const underlying = useOCStore(s => s.underlying);
  const expiryIdx = useOCStore(s => s.expiryIdx);
  const map = useUnderlyingExpiries();
  const expiries = map[value] ?? [];
  const isActiveCol = underlying === value;

  return (
    <div className="flex flex-col w-[104px] shrink-0">
      {/* Header card */}
      <button
        onClick={() => { ocStore.setUnderlying(value); ocStore.setExpiryIdx(0); onPick?.(); }}
        className={cn('flex items-center gap-1.5 h-[42px] px-2 rounded-[8px] border transition-colors mb-1.5')}
        style={{
          background: isActiveCol ? 'rgba(30,144,255,0.10)' : 'rgba(255,255,255,0.03)',
          borderColor: isActiveCol ? 'var(--db-accent, #1E90FF)' : 'rgba(255,255,255,0.08)',
        }}
      >
        <span className="text-[14px] font-bold" style={{ color: tagColor(tag) }}>{COIN_GLYPH[coin] ?? coin[0]}</span>
        <div className="flex flex-col items-start leading-none">
          <span className="text-[12px] font-extrabold text-white/90 font-mono">{value}</span>
          <span className="text-[9px] font-bold mt-0.5" style={{ color: tagColor(tag) }}>{tag}</span>
        </div>
      </button>

      {/* Expiry pills */}
      <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto pr-0.5">
        {expiries.length === 0 && <div className="text-[11px] text-white/25 px-1 py-2">—</div>}
        {expiries.map((e, i) => {
          const on = isActiveCol && i === expiryIdx;
          return (
            <button
              key={e.key}
              onClick={() => { ocStore.setUnderlying(value); ocStore.setExpiryIdx(i); onPick?.(); }}
              className="h-[26px] rounded-[6px] text-[11px] font-bold font-mono tabular-nums transition-colors text-center"
              style={{
                background: on ? 'var(--db-accent, #1E90FF)' : 'rgba(255,255,255,0.04)',
                color: on ? '#0b0b0b' : 'rgba(255,255,255,0.72)',
              }}
              onMouseEnter={ev => { if (!on) (ev.currentTarget.style.background = 'rgba(255,255,255,0.09)'); }}
              onMouseLeave={ev => { if (!on) (ev.currentTarget.style.background = 'rgba(255,255,255,0.04)'); }}
            >
              {e.dateLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function OptionsHoverMenu({
  onMouseEnter, onMouseLeave, onPick, className,
}: {
  onMouseEnter?: React.MouseEventHandler;
  onMouseLeave?: React.MouseEventHandler;
  onPick?: () => void;
  className?: string;
}) {
  const current = useOCStore(s => s.underlying);
  const [src, setSrc] = useState<DataSource>(() => sourceOf(ocStore.getState().underlying));
  // Follow external source changes (e.g. picking from the page).
  React.useEffect(() => { setSrc(sourceOf(current)); }, [current]);

  const groups = UNDERLYING_GROUPS.filter(g => g.source === src);

  return (
    <div className={className} style={PANEL_STYLE} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {/* Header: title + source toggle */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-[12px] font-extrabold text-white/80">选择期权</span>
        <div className="flex rounded-lg p-0.5 gap-0.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {SOURCES.map(s => (
            <button key={s.key} onClick={() => setSrc(s.key)} className="px-2.5 py-0.5 rounded-md text-[11px] font-bold transition-colors"
              style={{ background: src === s.key ? 'var(--db-accent, #1E90FF)' : 'transparent', color: src === s.key ? '#0b0b0b' : 'rgba(255,255,255,0.55)' }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-stretch px-3 pb-3 gap-3" style={{ overflowX: 'auto' }}>
        {groups.map((g, gi) => (
          <React.Fragment key={g.title}>
            {gi > 0 && <div className="w-px self-stretch" style={{ background: 'rgba(255,255,255,0.08)' }} />}
            <div className="flex flex-col">
              <div className="text-[11px] font-bold text-white/40 uppercase tracking-wider mb-2 px-0.5 whitespace-nowrap">{g.title}</div>
              <div className="flex gap-2">
                {g.items.map(it => (
                  <React.Fragment key={it.value}>
                    <ExpiryColumn value={it.value} coin={it.coin} tag={g.tag} onPick={onPick} />
                  </React.Fragment>
                ))}
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
