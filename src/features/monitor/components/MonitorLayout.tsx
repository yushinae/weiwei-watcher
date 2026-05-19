import React from 'react';
import { cn } from '../../../lib/utils';
import { MONITOR_TABS, type MonitorTabId } from '../types';

export function MonitorLayout({
  tab,
  onTabChange,
  children,
}: {
  tab: MonitorTabId;
  onTabChange: (t: MonitorTabId) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 glass-nav border-t-0">
        <div className="flex items-end gap-1" style={{ marginTop: 0 }}>
          {MONITOR_TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={cn(
                'relative h-10 select-none px-3.5 text-[13px] font-extrabold tracking-[-0.01em] transition-colors',
                tab === t.id ? 'text-slate-100' : 'text-slate-500 hover:text-slate-300',
              )}
            >
              {t.label}
              {tab === t.id && (
                <span
                  className={cn(
                    'absolute bottom-0 left-2 right-2 h-[2px] rounded-t-full',
                    'bg-gradient-to-r from-brand-blue/95 via-brand-blue/70 to-brand-blue/20',
                    'shadow-[0_0_14px_var(--monitor-signal-glow)]',
                  )}
                />
              )}
            </button>
          ))}
          <div className="ml-auto h-10" />
        </div>
      </div>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

