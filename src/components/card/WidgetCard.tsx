import React from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { WidgetCardSkeleton } from './WidgetCardSkeleton';
import { useWidgetCardActions } from './useWidgetCardActions';

export type WidgetCardAction = {
  id: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'normal' | 'danger';
};

export type WidgetCardStatus =
  | { type: 'ready' }
  | { type: 'loading'; skeleton?: React.ReactNode }
  | { type: 'empty'; title?: string; description?: string; action?: WidgetCardAction }
  | { type: 'error'; title?: string; description?: string; action?: WidgetCardAction }
  | { type: 'stale'; since?: number };

export type CardTone = 'blue' | 'red' | 'accent' | 'green';

function StatusPane({
  status,
}: {
  status: Exclude<WidgetCardStatus, { type: 'ready' } | { type: 'stale' }>;
}) {
  if (status.type === 'loading') {
    return status.skeleton ?? <WidgetCardSkeleton className="h-full w-full" />;
  }

  const title = status.title ?? (status.type === 'empty' ? '暂无数据' : '加载失败');
  const desc = status.description ?? (status.type === 'empty' ? '换个筛选条件或稍后再试。' : '请检查网络或稍后重试。');

  return (
    <div className="h-full w-full p-4">
      <div className="h-full w-full rounded-[14px] border border-white/6 bg-white/[0.03] p-4 flex flex-col justify-between">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-[12px] bg-rose-500/10 text-rose-400">
            <AlertTriangle size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-bold text-slate-100">{title}</div>
            <div className="mt-1 text-[11px] text-white/30 leading-snug">{desc}</div>
          </div>
        </div>

        {status.action && (
          <button
            type="button"
            onClick={status.action.onClick}
            className={cn(
              'mt-4 inline-flex items-center justify-center gap-2 rounded-[12px] px-3 py-2 text-[12px] font-bold',
              'bg-brand-blue/15 text-brand-blue hover:bg-brand-blue/20 transition-colors',
            )}
          >
            <RefreshCcw size={14} />
            {status.action.label}
          </button>
        )}
      </div>
    </div>
  );
}

function WidgetIcon({ tone, children }: { tone: CardTone; children: React.ReactNode }) {
  const iconClass = cn(
    'widget-icon',
    tone === 'blue' && 'ico-blue',
    tone === 'red' && 'ico-red',
    tone === 'accent' && 'ico-yellow',
    tone === 'green' && 'ico-green',
  );
  return <div className={iconClass}>{children}</div>;
}

export function WidgetCard({
  title,
  icon: Icon,
  subtitle,
  className,
  dragHandle = false,
  actions,
  status = { type: 'ready' },
  headerDensity = 'default',
  padding = 'default',
  tone = 'blue',
  logo,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  subtitle?: React.ReactNode;
  className?: string;
  dragHandle?: boolean;
  actions?: WidgetCardAction[];
  status?: WidgetCardStatus;
  headerDensity?: 'default' | 'compact';
  padding?: 'none' | 'default';
  tone?: CardTone;
  logo?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { actionsBaseOpacityClass } = useWidgetCardActions();

  const contentPad = padding === 'none' ? '' : 'pt-1';
  const showStatusPane = status.type !== 'ready' && status.type !== 'stale';

  return (
    <div className={cn(
      'w-full h-full @container relative rounded-[18px] overflow-hidden group/card',
      'widget-card',
      status.type === 'stale' && 'opacity-80',
      className
    )}>
      {/* Header */}
      <div className={cn('widget-head', dragHandle && 'widget-drag-handle cursor-move')}>
        <div className="widget-head-left">
          {logo ? logo : (Icon ? <WidgetIcon tone={tone}><Icon size={13} strokeWidth={2} /></WidgetIcon> : null)}
          <div className="min-w-0">
            <span className={cn('widget-name', subtitle ? '' : '')}>{title}</span>
            {subtitle && <div className="widget-meta">{subtitle}</div>}
          </div>
          {status.type === 'stale' && (
            <span
              className="ml-1 rounded-[6px] px-1.5 py-0.5 text-[9px] font-medium text-amber-300 bg-amber-500/10 ring-1 ring-inset ring-amber-500/20"
              title="实时数据可能已过期（连接中断或更新延迟）"
            >
              STALE
            </span>
          )}
        </div>

        {/* Header right (actions) */}
        {actions?.length ? (
          <div className={cn('widget-actions', actionsBaseOpacityClass)}>
            {actions.map(a => {
              const AIcon = a.icon;
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={a.disabled}
                  aria-label={a.label}
                  title={a.label}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    a.onClick();
                  }}
                  className={cn(
                    'btn',
                    a.tone === 'danger'
                      ? 'hover:bg-rose-500/15 hover:text-rose-400'
                      : '',
                    a.disabled && 'opacity-40 pointer-events-none',
                  )}
                >
                  <AIcon size={12} strokeWidth={2} />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Content */}
      <div className={cn('w-full', contentPad)}>
        {showStatusPane ? (
          <StatusPane status={status as any} />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
