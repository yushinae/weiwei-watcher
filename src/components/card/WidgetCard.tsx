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

function StatusPane({
  status,
  headerDensity,
}: {
  status: Exclude<WidgetCardStatus, { type: 'ready' } | { type: 'stale' }>;
  headerDensity: 'default' | 'compact';
}) {
  if (status.type === 'loading') {
    return status.skeleton ?? <WidgetCardSkeleton headerDensity={headerDensity} className="h-full w-full" />;
  }

  const title = status.title ?? (status.type === 'empty' ? '暂无数据' : '加载失败');
  const desc = status.description ?? (status.type === 'empty' ? '换个筛选条件或稍后再试。' : '请检查网络或稍后重试。');

  return (
    <div className="h-full w-full p-4">
      <div className="h-full w-full rounded-[14px] border border-border-subtle bg-bg-card p-4 flex flex-col justify-between">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-[12px] bg-rose-500/10 text-rose-400">
            <AlertTriangle size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-extrabold text-slate-100">{title}</div>
            <div className="mt-1 text-[11px] text-text-muted leading-snug">{desc}</div>
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
  children: React.ReactNode;
}) {
  const { actionsBaseOpacityClass } = useWidgetCardActions();

  const headerH = headerDensity === 'compact' ? 36 : 32;
  const contentPad =
    padding === 'none' ? '' : headerDensity === 'compact' ? 'pt-9 px-2 pb-2' : 'pt-8 px-2 pb-2';

  const headerLeftCls = cn(
    'absolute top-0 left-0 z-50',
    dragHandle && 'widget-drag-handle cursor-move',
  );

  const showStatusPane = status.type !== 'ready' && status.type !== 'stale';

  return (
    <div className={cn('w-full h-full @container relative rounded-[10px] overflow-hidden group/card widget-card', className)}>
      {/* Header left (title / icon / subtitle) */}
      <div className={headerLeftCls}>
        <div
          className={cn(
            'flex items-center gap-2 px-2.5 rounded-br-[10px] transition-colors',
            'bg-transparent hover:bg-white/10',
          )}
          style={{ height: headerH }}
        >
          {Icon && <Icon size={14} className="text-brand-blue shrink-0" />}
          <div className="min-w-0 flex items-baseline gap-2">
            <span className="text-[11px] font-bold text-slate-300 whitespace-nowrap overflow-hidden text-ellipsis @max-[150px]:hidden">
              {title}
            </span>
            {subtitle && (
              <span className="text-[10px] text-text-muted whitespace-nowrap overflow-hidden text-ellipsis @max-[220px]:hidden">
                {subtitle}
              </span>
            )}
          </div>
          {status.type === 'stale' && (
            <span
              className="ml-1 rounded-[8px] px-2 py-0.5 text-[10px] font-bold text-amber-300 bg-amber-500/10 ring-1 ring-inset ring-amber-500/20"
              title="实时数据可能已过期（连接中断或更新延迟）"
            >
              STALE
            </span>
          )}
        </div>
      </div>

      {/* Header right (actions) */}
      {actions?.length ? (
        <div className={cn('absolute top-0 right-0 z-50 flex items-center p-1 transition-opacity', actionsBaseOpacityClass)}>
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
                  'p-1.5 rounded-[8px] transition-colors outline-none',
                  'focus-visible:ring-2 focus-visible:ring-brand-blue/50 focus-visible:ring-offset-0',
                  a.tone === 'danger'
                    ? 'text-slate-400 hover:text-rose-400 hover:bg-rose-500/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/10',
                  a.disabled && 'opacity-40 pointer-events-none',
                )}
              >
                <AIcon size={13} strokeWidth={2} />
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Content */}
      <div className={cn('w-full h-full overflow-hidden relative', contentPad)}>
        {showStatusPane ? (
          <StatusPane status={status as any} headerDensity={headerDensity} />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

