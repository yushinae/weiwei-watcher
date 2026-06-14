import React, { useMemo } from 'react';
import { cn } from '../../lib/utils';
import { instantiateTemplate, payoffAt, fitTone, fitLabel } from './helpers';
import { VIEW_LABELS, TAG_LABELS, SMALL_BUTTON_BASE, SMALL_BUTTON_ACTIVE } from './constants';
import type { StrategyTemplate, MarketPreset, MarketView, RankedTemplate } from './types';

// Titled section card used across the strategy builder layout.
export function Panel({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('bg-[#17181E] rounded-[8px] overflow-hidden min-h-0 flex flex-col', className)}>
      {(title || action) && (
        <div className="h-10 shrink-0 px-3 flex items-center justify-between border-b border-white/[0.06]">
          <div className="text-[13px] font-semibold text-white/75">{title}</div>
          {action}
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

// Sparkline preview of a template's expiry payoff, shown in the template picker.
export function MiniPayoff({ template, market }: { template: StrategyTemplate; market: MarketPreset }) {
  const points = useMemo(() => {
    if (template.legs.length === 0) return [];
    const baseLegs = instantiateTemplate(template, market, market.spot, market.iv);
    const xs = Array.from({ length: 28 }, (_, i) => market.spot * (0.84 + i * 0.012));
    return xs.map(S => baseLegs.reduce((sum, leg) => sum + payoffAt(leg, S, 0, market.iv, 'pnl'), 0));
  }, [market, template]);

  if (points.length === 0) {
    return <div className="h-10 rounded-[6px] bg-[#2B2D35]" />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points.map((p, index) => {
    const x = 2 + index * (92 / (points.length - 1));
    const y = 38 - ((p - min) / span) * 34;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const zeroY = 38 - ((0 - min) / span) * 34;

  return (
    <svg className="h-11 w-full" viewBox="0 0 98 42" aria-hidden="true">
      <line x1="2" x2="96" y1={Math.max(4, Math.min(38, zeroY))} y2={Math.max(4, Math.min(38, zeroY))} stroke="rgba(255,255,255,.18)" strokeWidth="1" />
      <path d={path} fill="none" stroke="var(--nexus-accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Left sidebar: market-view filter + ranked strategy template cards.
export function RecommendationSidebar({
  sidebarCollapsed, setSidebarCollapsed, marketView, setMarketView,
  rankedTemplates, weakTemplateCount, selectedTemplateId,
  expandedTemplateId, setExpandedTemplateId, applyTemplate, market,
}: {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (b: boolean) => void;
  marketView: MarketView;
  setMarketView: (v: MarketView) => void;
  rankedTemplates: RankedTemplate[];
  weakTemplateCount: number;
  selectedTemplateId: string;
  expandedTemplateId: string;
  setExpandedTemplateId: (s: string) => void;
  applyTemplate: (t: StrategyTemplate) => void;
  market: MarketPreset;
}) {
  return (
    <aside className={cn('strategy-builder-sidebar shrink-0 border-r border-white/[0.08] bg-[#101014] flex flex-col min-h-0 transition-[width] duration-150', sidebarCollapsed ? 'is-collapsed w-[48px]' : 'w-[288px]')}>
      <div className="h-12 px-3 flex items-center justify-between border-b border-white/[0.08]">
        {sidebarCollapsed ? (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className={cn('mx-auto h-7 w-7 text-[13px]', SMALL_BUTTON_BASE)}
            title="展开策略推荐"
            aria-label="展开策略推荐"
          >
            ›
          </button>
        ) : (
          <>
            <div>
              <div className="text-[14px] font-semibold text-white/85">策略推荐</div>
              <div className="text-[11px] text-white/45">{VIEW_LABELS[marketView].label} · {rankedTemplates.length} 个候选</div>
            </div>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className={cn('rounded-[4px] px-2 py-1 text-[11px]', SMALL_BUTTON_BASE)}
              title="收起策略推荐"
              aria-label="收起策略推荐"
            >
              收起
            </button>
          </>
        )}
      </div>

      {sidebarCollapsed ? (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-3 px-2 py-3">
          <div className="writing-vertical text-[12px] font-semibold tracking-[0.1em] text-white/48">策略推荐</div>
          <div className="rounded-[4px] bg-[#2B2D35] px-1.5 py-1 text-[10px] text-white/42">{rankedTemplates.length}</div>
        </div>
      ) : (
        <>
          <div className="p-3 border-b border-white/[0.08]">
            <div className="grid grid-cols-4 gap-1.5">
              {(['all', 'bullish', 'bearish', 'range', 'breakout', 'volUp', 'volDown', 'calendar'] as MarketView[]).map(view => (
                <button
                  key={view}
                  onClick={() => setMarketView(view)}
                  className={cn(
                    'h-8 text-[12px] font-semibold',
                    SMALL_BUTTON_BASE,
                    marketView === view && SMALL_BUTTON_ACTIVE,
                  )}
                >
                  {VIEW_LABELS[view].label}
                </button>
              ))}
            </div>
            <div className="mt-2 rounded-[6px] bg-[#17181E] px-2 py-2">
              <div className="text-[11px] leading-4 text-white/48">{VIEW_LABELS[marketView].hint}</div>
              {marketView !== 'all' && <div className="mt-1 text-[10px] text-white/30">{weakTemplateCount} 个低匹配策略已降权隐藏</div>}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
            {rankedTemplates.map(({ template, fit, reason }) => {
              const selected = template.id === selectedTemplateId;
              const expanded = template.id === expandedTemplateId;
              return (
                <article
                  key={template.id}
                  className={cn(
                    'strategy-template-card rounded-[8px] bg-[#17181E] border border-transparent transition-colors overflow-hidden',
                    selected && 'is-selected',
                  )}
                >
                  <button onClick={() => applyTemplate(template)} className="w-full text-left p-3">
                    <div className="flex gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-[14px] font-semibold text-white/88 truncate">{template.nameCn}</h3>
                          {selected && <span className="rounded-[4px] bg-white/[0.07] px-1.5 py-0.5 text-[10px] text-white/68">当前</span>}
                          {!selected && <span className={cn('rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold', fitTone(fit))}>{fitLabel(fit)}</span>}
                        </div>
                        <div className="mt-0.5 text-[12px] text-white/45">{template.nameEn}</div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {template.tags.map(tag => (
                            <span key={tag} className="rounded-[4px] bg-[#2B2D35] px-1.5 py-0.5 text-[10px] text-white/55">{TAG_LABELS[tag]}</span>
                          ))}
                        </div>
                      </div>
                      <div className="hidden w-[96px] shrink-0 min-[1120px]:block">
                        <MiniPayoff template={template} market={market} />
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-white/58">{template.summary}</p>
                    {expanded && (
                      <div className="mt-2 rounded-[6px] bg-[#2B2D35] px-2 py-1.5 text-[11px] leading-4 text-white/55">
                        <div>{reason}</div>
                        <div className="mt-1 text-white/45">{template.detail}</div>
                      </div>
                    )}
                  </button>
                  <div className="px-3 pb-3 flex items-center justify-between">
                    <button
                      onClick={() => setExpandedTemplateId(expanded ? '' : template.id)}
                      className="text-[11px] text-white/45 hover:text-white/75"
                    >
                      {expanded ? '收起' : '展开'}
                    </button>
                    <span className="rounded-[4px] bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-white/38">{template.legs.length || 0} 腿</span>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}
