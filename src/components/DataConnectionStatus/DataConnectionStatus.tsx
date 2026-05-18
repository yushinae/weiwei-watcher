import React, { useMemo, useState } from 'react';
import { Activity, RefreshCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Popover } from '../popup/Popup';
import { useStatusStreamSSE } from '../../api/streams';

function statusTone(s: string) {
  if (s === 'open') return 'good';
  if (s === 'connecting') return 'warn';
  if (s === 'disabled') return 'muted';
  if (s === 'degraded') return 'bad';
  if (s === 'closed') return 'bad';
  return 'muted';
}

export function DataConnectionStatus() {
  const [open, setOpen] = useState(false);
  const { data, error } = useStatusStreamSSE();

  const summary = useMemo(() => {
    const sources = data?.sources ?? [];
    const tones = sources.map((s) => statusTone(s.state));
    const tone = tones.includes('bad') ? 'bad' : tones.includes('warn') ? 'warn' : tones.includes('good') ? 'good' : 'muted';
    return { tone, count: sources.length };
  }, [data]);

  const dotCls =
    summary.tone === 'good'
      ? 'bg-trade-up shadow-[0_0_12px_rgba(30,201,140,0.45)]'
      : summary.tone === 'warn'
        ? 'bg-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.35)]'
        : summary.tone === 'bad'
          ? 'bg-trade-down shadow-[0_0_12px_rgba(255,77,106,0.35)]'
          : 'bg-slate-600';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn(
          'inline-flex items-center gap-2 rounded-[10px] px-3 py-2',
          'bg-surface-2/60 ring-1 ring-inset ring-border-subtle/70',
          'hover:bg-surface-2/80 transition-colors',
        )}
      >
        <span className="text-[11px] font-extrabold tracking-[0.2em] text-slate-300">DATA</span>
        <span className={cn('h-2 w-2 rounded-full', dotCls)} />
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        panelZ={200}
        backdropZ={199}
        panelClassName="w-[420px] p-3"
        panelStyle={{ right: 8, top: 54, position: 'fixed' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-text-muted">Connections</div>
            <div className="mt-1 text-[13px] font-extrabold text-slate-100 tracking-[-0.01em] flex items-center gap-2">
              <Activity size={14} className="text-brand-blue" />
              本地数据接入状态
            </div>
            {error && <div className="mt-1 text-[11px] text-trade-down">SSE: {error}</div>}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="p-2 rounded-[10px] text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
            title="刷新页面"
            aria-label="刷新页面"
          >
            <RefreshCcw size={16} />
          </button>
        </div>

        <div className="mt-3 rounded-[12px] border border-border-subtle bg-bg-card/70 overflow-hidden">
          <div className="px-3 py-2 border-b border-border-subtle text-[10px] font-bold tracking-[0.16em] uppercase text-text-muted">
            SOURCES
          </div>
          <div className="p-3 font-mono text-[11px] leading-5 tnum text-slate-200">
            {(data?.sources ?? []).length ? (
              (data?.sources ?? []).map((s) => (
                <div key={s.source} className="flex items-center justify-between gap-3">
                  <span className="text-slate-300">{s.source}</span>
                  <span className={cn(
                    'px-2 py-0.5 rounded-[8px] text-[10px] font-bold',
                    statusTone(s.state) === 'good' && 'bg-trade-up/10 text-trade-up ring-1 ring-inset ring-trade-up/20',
                    statusTone(s.state) === 'warn' && 'bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-500/20',
                    statusTone(s.state) === 'bad' && 'bg-trade-down/10 text-trade-down ring-1 ring-inset ring-trade-down/20',
                    statusTone(s.state) === 'muted' && 'bg-slate-500/10 text-slate-400 ring-1 ring-inset ring-slate-500/20',
                  )}>
                    {String(s.state).toUpperCase()}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-text-muted">尚未收到状态数据（请确认本地 server 已启动）。</div>
            )}
          </div>
        </div>
      </Popover>
    </div>
  );
}

