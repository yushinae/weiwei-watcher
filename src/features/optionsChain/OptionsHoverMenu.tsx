// Reusable 标的 + 到期日 picker panel. Self-styled (does not depend on the
// .db-oc-root CSS scope) so it can render inside the global nav as well as the page.

import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { dteLabel } from './chainModel';
import { UNDERLYINGS, tagColor, useOCStore, ocStore } from './store';

const PANEL_STYLE: React.CSSProperties = {
  background: '#1f1f1f',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 12,
  boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
  overflow: 'hidden',
};

export function OptionsHoverMenu({
  onMouseEnter, onMouseLeave, onPick, className,
}: {
  onMouseEnter?: React.MouseEventHandler;
  onMouseLeave?: React.MouseEventHandler;
  /** Called after any selection (e.g. to navigate to the page / close the menu). */
  onPick?: () => void;
  className?: string;
}) {
  const underlying = useOCStore(s => s.underlying);
  const expiryIdx = useOCStore(s => s.expiryIdx);
  const expiries = useOCStore(s => s.expiries);

  return (
    <div className={cn('w-[420px]', className)} style={PANEL_STYLE} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div className="flex">
        {/* 标的 */}
        <div className="flex-1 border-r border-white/[0.08] py-2">
          <div className="px-3 pb-1.5 text-[11px] font-bold text-white/35 uppercase tracking-wider">标的</div>
          {UNDERLYINGS.map(u => {
            const on = u.value === underlying;
            return (
              <button key={u.value}
                className="flex items-center gap-2.5 h-[34px] px-3 w-full text-left text-[13px] font-semibold text-white/80 hover:bg-white/[0.06] transition-colors"
                onClick={() => { ocStore.setUnderlying(u.value); onPick?.(); }}>
                <span className={cn('w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center shrink-0', on ? 'border-transparent' : 'border-white/20')}
                  style={{ background: on ? 'var(--db-accent, #25e889)' : 'rgba(255,255,255,0.04)' }}>
                  {on && <Check size={12} className="text-black" strokeWidth={3} />}
                </span>
                <span className="flex-1 font-mono font-bold">{u.value}</span>
                <span className="text-[10px] font-bold" style={{ color: tagColor(u.tag) }}>{u.tag}</span>
              </button>
            );
          })}
        </div>
        {/* 到期日 */}
        <div className="w-[160px] py-2">
          <div className="px-3 pb-1.5 text-[11px] font-bold text-white/35 uppercase tracking-wider">到期日</div>
          <div className="max-h-[300px] overflow-auto">
            {expiries.length === 0 && <div className="px-3 py-2 text-[12px] text-white/35">暂无（前往期权链）</div>}
            {expiries.map((e, i) => {
              const on = i === expiryIdx;
              return (
                <button key={e.key}
                  className="flex items-center gap-2 h-[34px] px-3 w-full text-left text-[13px] hover:bg-white/[0.06] transition-colors"
                  onClick={() => { ocStore.setExpiryIdx(i); onPick?.(); }}>
                  <span className="flex-1">
                    <span className="font-semibold" style={{ color: on ? 'var(--db-accent, #25e889)' : 'rgba(255,255,255,0.8)' }}>{e.label}</span>
                    <span className="ml-2 text-white/35 text-[11px]">{dteLabel(e.daysToExp)}</span>
                  </span>
                  {on && <Check size={12} style={{ color: 'var(--db-accent, #25e889)' }} strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
