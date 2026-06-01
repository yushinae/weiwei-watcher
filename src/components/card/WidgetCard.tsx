import React, { useState, useCallback } from 'react';
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

type CardContextValue = {
  setHeaderRight: (node: React.ReactNode) => void;
};

const CardContext = React.createContext<CardContextValue>({
  setHeaderRight: () => {},
});

export function useCardHeader() {
  return React.useContext(CardContext);
}

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
      <div className="h-full w-full rounded-xl bg-surface-2 p-4 flex flex-col justify-between">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--nexus-red)]/12 text-[var(--nexus-red)]">
            <AlertTriangle size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-bold text-white/90">{title}</div>
            <div className="mt-1 text-[11px] text-white/55 leading-snug">{desc}</div>
          </div>
        </div>

        {status.action && (
          <button
            type="button"
            onClick={status.action.onClick}
            className={cn(
              'mt-4 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12px] font-bold',
              'bg-[var(--color-brand)]/15 text-[var(--color-brand)] hover:bg-[var(--color-brand)]/25 transition-colors',
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
  subtitle,
  className,
  dragHandle = false,
  actions,
  status = { type: 'ready' },
  updatedAt,
  dataSource,
  footer: footerProp,
  noScroll,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  className?: string;
  dragHandle?: boolean;
  actions?: WidgetCardAction[];
  status?: WidgetCardStatus;
  headerDensity?: 'default' | 'compact';
  padding?: 'none' | 'default';
  tone?: CardTone;
  updatedAt?: string;
  dataSource?: string;
  footer?: React.ReactNode;
  noScroll?: boolean;
  children: React.ReactNode;
}) {
  const { actionsBaseOpacityClass } = useWidgetCardActions();
  const [headerRight, setHeaderRight] = useState<React.ReactNode>(null);
  const setHeaderRightCb = useCallback(setHeaderRight, []);

  const showStatusPane = status.type !== 'ready' && status.type !== 'stale';

  return (
    <CardContext.Provider value={{ setHeaderRight: setHeaderRightCb }}>
      <div className={cn(
        'w-full h-full @container relative rounded-xl overflow-hidden group/card',
        'widget-card',
        status.type === 'stale' && 'opacity-80',
        className
      )}>
        {/* Header */}
        <div className={cn('widget-head', dragHandle && 'widget-drag-handle cursor-move')}>
          <div className="widget-head-left">
            <div className="min-w-0">
              <span className={cn('widget-name', subtitle ? '' : '')}>{title}</span>
              {subtitle && <div className="widget-meta">{subtitle}</div>}
            </div>
            {status.type === 'stale' && (
              <span
                className="ml-1 rounded-[6px] px-1.5 py-0.5 text-[9px] font-medium text-[var(--nexus-yellow)] bg-[var(--nexus-yellow)]/12 ring-1 ring-inset ring-[var(--nexus-yellow)]/25"
                title="实时数据可能已过期（连接中断或更新延迟）"
              >
                STALE
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {headerRight}
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
                          ? 'hover:bg-[var(--nexus-red)]/15 hover:text-[var(--nexus-red)]'
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
        </div>

        {/* Content — 滚动钳制容器 */}
        <div className={cn('widget-body', noScroll && 'overflow-hidden')}>
          {showStatusPane ? (
            <StatusPane status={status as any} />
          ) : (
            children
          )}
        </div>

        {/* Footer */}
        {(footerProp || updatedAt || dataSource) && (
          <div className="widget-foot">
            {footerProp ?? (
              <>
                {updatedAt && <span className="widget-foot-time">更新 {updatedAt}</span>}
                {dataSource && <span className="widget-foot-source">{dataSource}</span>}
              </>
            )}
          </div>
        )}
      </div>
    </CardContext.Provider>
  );
}
