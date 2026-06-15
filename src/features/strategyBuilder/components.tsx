import React, { useMemo } from 'react';
import { cn } from '../../lib/utils';
import { AnimatedNumber } from '../../components/AnimatedNumber';
import { bsDelta, bsGamma, bsVega, bsTheta, heatColor } from '../../registry/lib/bs-math';
import { instantiateTemplate, payoffAt, fitTone, fitLabel, formatPrice, formatMoney, formatCompact, legSign, years } from './helpers';
import { VIEW_LABELS, TAG_LABELS, SMALL_BUTTON_BASE, SMALL_BUTTON_ACTIVE } from './constants';
import type { StrategyTemplate, MarketPreset, MarketView, RankedTemplate, LegKind, LegSide, OptionType, OptionContract, StrategyLeg, ValueMode } from './types';

type AddContractRow = { strike: number; call: OptionContract | null; put: OptionContract | null; isAtm: boolean; inStrategy: boolean };

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

// "+ 添加合约" dropdown: quick-add buttons + a strike grid with bid/ask add buttons.
export function AddContractMenu({
  visibleChainLabel, hasRealChain, chainRows, addLeg, addContractLeg, onClose,
}: {
  visibleChainLabel: string;
  hasRealChain: boolean;
  chainRows: AddContractRow[];
  addLeg: (kind: LegKind, side: LegSide, type?: OptionType) => void;
  addContractLeg: (contract: OptionContract, side: LegSide) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 top-10 z-20 w-[560px] max-w-[calc(100vw-380px)] overflow-hidden rounded-[8px] border border-white/[0.08] bg-[rgba(21,23,25,.96)] shadow-[0_8px_25px_rgba(0,0,0,.4)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-3 py-2">
        <div>
          <div className="text-[12px] font-semibold text-white/78">添加合约</div>
          <div className="text-[10px] text-white/38">{visibleChainLabel} · {hasRealChain ? 'Deribit' : '合成报价'} · Bid 卖出 / Ask 买入</div>
        </div>
        <button onClick={onClose} className="h-6 w-6 rounded-[4px] text-white/45 hover:bg-white/[0.08] hover:text-white/75">×</button>
      </div>
      <div className="grid grid-cols-[132px_1fr] min-h-[300px]">
        <div className="border-r border-white/[0.08] p-2">
          <div className="px-1 pb-1.5 text-[11px] text-white/40">快捷添加</div>
          {[
            ['buy', 'call', '买入 看涨'],
            ['sell', 'call', '卖出 看涨'],
            ['buy', 'put', '买入 看跌'],
            ['sell', 'put', '卖出 看跌'],
          ].map(([side, type, label]) => (
            <button key={`${side}-${type}`} onClick={() => addLeg('option', side as LegSide, type as OptionType)} className="mb-1 w-full rounded-[4px] px-2 py-1.5 text-left text-[12px] text-white/70 hover:bg-white/[0.08]">
              {label}
            </button>
          ))}
          <div className="mt-2 border-t border-white/[0.08] px-1 py-1.5 text-[11px] text-white/40">标的</div>
          <button onClick={() => addLeg('underlying', 'buy')} className="mb-1 w-full rounded-[4px] px-2 py-1.5 text-left text-[12px] text-white/70 hover:bg-white/[0.08]">买入 标的</button>
          <button onClick={() => addLeg('underlying', 'sell')} className="w-full rounded-[4px] px-2 py-1.5 text-left text-[12px] text-white/70 hover:bg-white/[0.08]">卖出 标的</button>
        </div>
        <div className="max-h-[340px] overflow-auto p-2">
          <table className="w-full min-w-[390px] border-separate border-spacing-0 text-center text-[12px]">
            <thead className="sticky top-0 z-10 bg-[rgba(21,23,25,.98)]">
              <tr>
                <th className="px-2 py-1.5 text-right text-[11px] font-medium text-[#24AE64]/75">C Bid</th>
                <th className="px-2 py-1.5 text-right text-[11px] font-medium text-[#EF454A]/75">C Ask</th>
                <th className="px-2 py-1.5 text-center text-[11px] font-semibold text-white/62">Strike</th>
                <th className="px-2 py-1.5 text-left text-[11px] font-medium text-[#EF454A]/75">P Ask</th>
                <th className="px-2 py-1.5 text-left text-[11px] font-medium text-[#24AE64]/75">P Bid</th>
              </tr>
            </thead>
            <tbody>
              {chainRows.map(row => (
                <tr key={row.strike} className={cn((row.isAtm || row.inStrategy) && 'strategy-chain-row-selected')}>
                  <td className="border-t border-white/[0.04] px-1 py-1 text-right">
                    {row.call ? <button onClick={() => addContractLeg(row.call!, 'sell')} className="h-6 min-w-14 rounded-[4px] px-1.5 text-right tnum text-[#24AE64] hover:bg-[#3A3B40]">{formatPrice(row.call.bid, 2)}</button> : <span className="text-white/20">—</span>}
                  </td>
                  <td className="border-t border-white/[0.04] px-1 py-1 text-right">
                    {row.call ? <button onClick={() => addContractLeg(row.call!, 'buy')} className="h-6 min-w-14 rounded-[4px] px-1.5 text-right tnum text-[#EF454A] hover:bg-[#3A3B40]">{formatPrice(row.call.ask, 2)}</button> : <span className="text-white/20">—</span>}
                  </td>
                  <td className={cn('border-t border-white/[0.04] px-2 py-1.5 text-center tnum font-semibold', row.isAtm ? 'text-white/90' : row.inStrategy ? 'text-white/84' : 'text-white/72')}>{row.strike.toLocaleString()}</td>
                  <td className="border-t border-white/[0.04] px-1 py-1 text-left">
                    {row.put ? <button onClick={() => addContractLeg(row.put!, 'buy')} className="h-6 min-w-14 rounded-[4px] px-1.5 text-left tnum text-[#EF454A] hover:bg-[#3A3B40]">{formatPrice(row.put.ask, 2)}</button> : <span className="text-white/20">—</span>}
                  </td>
                  <td className="border-t border-white/[0.04] px-1 py-1 text-left">
                    {row.put ? <button onClick={() => addContractLeg(row.put!, 'sell')} className="h-6 min-w-14 rounded-[4px] px-1.5 text-left tnum text-[#24AE64] hover:bg-[#3A3B40]">{formatPrice(row.put.bid, 2)}</button> : <span className="text-white/20">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Analysis tab: portfolio + per-leg greeks cards.
export function GreeksView({ greeks, legs, iv, ivMultiplier, spot }: {
  greeks: { delta: number; gamma: number; vega: number; theta: number };
  legs: StrategyLeg[];
  iv: number;
  ivMultiplier: number;
  spot: number;
}) {
  return (
    <div className="h-full overflow-auto">
      <div className="grid grid-cols-4 gap-2">
        {[
          ['Delta', greeks.delta, '标的价格变化 1 时组合价值的近似变化'],
          ['Gamma', greeks.gamma, 'Delta 对标的价格变化的敏感度'],
          ['Vega', greeks.vega, '隐含波动率变化 1% 时组合价值变化'],
          ['Theta', greeks.theta, '时间流逝 1 天的组合价值变化'],
        ].map(([label, value, hint]) => (
          <div key={label} className="rounded-[8px] bg-[#2B2D35] p-4">
            <div className="text-[12px] text-white/45">{label}</div>
            <div className={cn('mt-2 text-[24px] font-semibold tnum', Number(value) >= 0 ? 'text-[#24AE64]' : 'text-[#EF454A]')}>
              <AnimatedNumber value={Number(value)} format={v => formatMoney(v, 3)} duration={0.18} />
            </div>
            <div className="mt-3 text-[12px] leading-5 text-white/48">{hint}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-[8px] bg-[#2B2D35] p-3">
        <div className="mb-2 text-[13px] font-semibold text-white/72">逐腿 Greeks</div>
        <div className="space-y-1">
          {legs.map((leg, index) => {
            const scale = legSign(leg.side) * leg.qty;
            const legIv = Math.max(5, (leg.iv ?? iv) * ivMultiplier);
            const delta = leg.kind === 'underlying' ? scale : scale * bsDelta(spot, leg.strike ?? spot, years(leg.expiryDays), legIv, leg.type === 'put' ? 'P' : 'C');
            const gamma = leg.kind === 'underlying' ? 0 : scale * bsGamma(spot, leg.strike ?? spot, years(leg.expiryDays), legIv);
            const vega = leg.kind === 'underlying' ? 0 : scale * bsVega(spot, leg.strike ?? spot, years(leg.expiryDays), legIv);
            const theta = leg.kind === 'underlying' ? 0 : scale * bsTheta(spot, leg.strike ?? spot, years(leg.expiryDays), legIv);
            return (
              <div key={leg.id} className="grid grid-cols-5 rounded-[6px] bg-[#17181E] px-3 py-2 text-[12px]">
                <div className="text-white/72">#{index + 1} {leg.kind === 'underlying' ? '标的' : `${leg.strike} ${leg.type === 'call' ? 'C' : 'P'}`}</div>
                <div className="tnum text-white/55">Δ {formatMoney(delta, 3)}</div>
                <div className="tnum text-white/55">Γ {formatMoney(gamma, 5)}</div>
                <div className="tnum text-white/55">ν {formatMoney(vega, 2)}</div>
                <div className="tnum text-white/55">Θ {formatMoney(theta, 2)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Analysis tab: P&L heat-matrix across price rows × time columns.
export function TableView({ timeColumns, priceRows, tableData, tableAbsMax, spot, valueMode }: {
  timeColumns: number[];
  priceRows: number[];
  tableData: number[][];
  tableAbsMax: number;
  spot: number;
  valueMode: ValueMode;
}) {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-center text-[12px]">
        <thead className="sticky top-0 z-10 bg-[#17181E]">
          <tr>
            <th className="w-24 px-2 py-2 text-left text-white/50">标的</th>
            <th className="w-16 px-2 py-2 text-right text-white/50">涨幅</th>
            {timeColumns.map(day => <th key={day} className="px-2 py-2 text-white/50">{day === 0 ? '现在' : `T+${day}D`}</th>)}
          </tr>
        </thead>
        <tbody>
          {priceRows.map((price, row) => (
            <tr key={price}>
              <td className="border-t border-white/[0.04] px-2 py-1.5 text-left font-semibold tnum text-white/78">{formatCompact(price)}</td>
              <td className="border-t border-white/[0.04] px-2 py-1.5 text-right tnum text-white/42">{((price / spot - 1) * 100).toFixed(1)}%</td>
              {tableData[row].map((value, col) => (
                <td
                  key={`${price}-${col}`}
                  className="border-t border-white/[0.04] px-2 py-1.5 tnum text-black/85"
                  style={{ background: heatColor(value, tableAbsMax) }}
                >
                  {valueMode === 'pnlPercent' ? `${value.toFixed(1)}%` : formatMoney(value, 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Header stats: current expiry · ATM IV · total open interest.
export function HeaderStatsStrip({ visibleChainLabel, atmContract, iv, chain }: {
  visibleChainLabel: string;
  atmContract: { iv: number } | null | undefined;
  iv: number;
  chain: { oi: number }[];
}) {
  return (
    <div className="hidden xl:grid grid-cols-3 gap-px overflow-hidden rounded-[6px] bg-black">
      <div className="bg-[#2B2D35] px-3 py-1.5">
        <div className="text-[10px] text-white/38">当前期限</div>
        <div className="tnum text-[12px] font-semibold text-white/78">{visibleChainLabel}</div>
      </div>
      <div className="bg-[#2B2D35] px-3 py-1.5">
        <div className="text-[10px] text-white/38">ATM IV</div>
        <div className="tnum text-[12px] font-semibold text-white/78">
          <AnimatedNumber value={atmContract?.iv ?? iv} format={value => `${value.toFixed(1)}%`} duration={0.18} />
        </div>
      </div>
      <div className="bg-[#2B2D35] px-3 py-1.5">
        <div className="text-[10px] text-white/38">Open Interest</div>
        <div className="tnum text-[12px] font-semibold text-white/78">
          <AnimatedNumber value={chain.reduce((sum, item) => sum + item.oi, 0)} format={formatCompact} duration={0.18} />
        </div>
      </div>
    </div>
  );
}
