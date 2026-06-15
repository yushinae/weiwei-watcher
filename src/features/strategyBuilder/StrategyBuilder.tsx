import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';
import echarts from '../../components/echart/echartsCore';
import { AnimatedNumber } from '../../components/AnimatedNumber';
import { bsDelta, bsGamma, bsTheta, bsVega } from '../../registry/lib/bs-math';
import { cn } from '../../lib/utils';
import type {
  OptionType, LegSide, LegKind, ViewMode, ValueMode,
  MarketView, StrategyLeg, StrategyTemplate, OptionContract,
  DeribitBookSummary, ReviewItem, AxisDragState,
} from './types';
import {
  AXIS_MAX_TICKS, AXIS_MIN_TICK_GAP, MARKETS, EXPIRIES,
  TEMPLATES, INPUT_CLS, SELECT_CLS,
  SMALL_BUTTON_BASE, SMALL_BUTTON_ACTIVE,
} from './constants';
import {
  roundToStep, years, optionPrice, formatMoney, formatAbsMoney, formatPrice,
  formatCompact, formatSignedPercent, formatSpotValue, exposureText, reviewTone,
  legSign, payoffAt, buildChain, deribitSummaryToContract, findContract,
  priceLegFromContract, makeLegFromContract, instantiateTemplate, rankTemplateForView,
  pickAxisStrikes, axisPositionPct, buildAxisLegLayout,
} from './helpers';
import { Panel, RecommendationSidebar, AddContractMenu, GreeksView, TableView, HeaderStatsStrip, AnalysisControls } from './components';

// Types, the strategy-template catalog, and styling constants now live in ./types
// and ./constants (imported above). Pure helpers + the component follow.

// Pure helpers (pricing / payoff / chain / Deribit parsing / formatting) now live
// in ./helpers — imported above. Panel + MiniPayoff (presentational) follow.


export function StrategyBuilder() {
  const [marketSymbol, setMarketSymbol] = useState('BTC');
  const market = useMemo(() => MARKETS.find(item => item.symbol === marketSymbol) ?? MARKETS[0], [marketSymbol]);
  const [spot, setSpot] = useState(market.spot);
  const [iv, setIv] = useState(market.iv);
  const [selectedExpiry, setSelectedExpiry] = useState(30);
  const [contracts, setContracts] = useState<OptionContract[]>([]);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [marketView, setMarketView] = useState<MarketView>('all');
  const [expandedTemplateId, setExpandedTemplateId] = useState('long-call');
  const [selectedTemplateId, setSelectedTemplateId] = useState('long-call');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [legs, setLegs] = useState<StrategyLeg[]>(() => instantiateTemplate(TEMPLATES[1], MARKETS[0], MARKETS[0].spot, MARKETS[0].iv));
  const [ivMultiplier, setIvMultiplier] = useState(1);
  const [rangePct, setRangePct] = useState(6);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [valueMode, setValueMode] = useState<ValueMode>('pnl');
  const [addOpen, setAddOpen] = useState(false);
  const [axisDrag, setAxisDrag] = useState<AxisDragState | null>(null);
  const [axisTickCount, setAxisTickCount] = useState(AXIS_MAX_TICKS);
  const [selectedLegId, setSelectedLegId] = useState<string | null>('long-call-0');
  const [legEditorOpen, setLegEditorOpen] = useState(false);
  const [legEditorAnchor, setLegEditorAnchor] = useState<{ left: number; top: number } | null>(null);
  const [riskMenuOpen, setRiskMenuOpen] = useState(false);
  const [axisMenu, setAxisMenu] = useState<{ strike: number; x: number; y: number; width: number } | null>(null);
  const [axisTooltip, setAxisTooltip] = useState<{ strike: number; leftPx: number; topPx: number; callOi: number; putOi: number } | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [analysisDayRatio, setAnalysisDayRatio] = useState(0.5);
  const chainLoadedSymbolRef = useRef<string | null>(null);
  const axisSurfaceRef = useRef<HTMLDivElement | null>(null);
  const suppressAxisClickRef = useRef(false);
  const axisDragRef = useRef<AxisDragState | null>(null);

  const activeTemplate = useMemo(() => TEMPLATES.find(item => item.id === selectedTemplateId) ?? TEMPLATES[1], [selectedTemplateId]);
  const rankedTemplates = useMemo(() => {
    return TEMPLATES
      .map(template => rankTemplateForView(template, marketView))
      .filter(item => marketView === 'all' || item.fit !== 'weak' || item.template.id === selectedTemplateId)
      .sort((a, b) => b.score - a.score || a.template.legs.length - b.template.legs.length || a.template.nameCn.localeCompare(b.template.nameCn));
  }, [marketView, selectedTemplateId]);
  const weakTemplateCount = useMemo(() => (
    TEMPLATES.map(template => rankTemplateForView(template, marketView)).filter(item => item.fit === 'weak').length
  ), [marketView]);

  useEffect(() => {
    let cancelled = false;

    async function loadChain() {
      setChainLoading(true);
      setChainError(null);
      try {
        const res = await fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${marketSymbol}&kind=option`);
        const json = await res.json();
        const parsed = ((json.result ?? []) as DeribitBookSummary[])
          .map(deribitSummaryToContract)
          .filter((item): item is OptionContract => Boolean(item))
          .filter(item => item.days > 0)
          .sort((a, b) => a.expiryTs - b.expiryTs || a.strike - b.strike);

        if (cancelled) return;
        setContracts(parsed);

        if (parsed.length > 0) {
          const underlying = parsed.find(item => Number.isFinite(item.underlyingPrice))?.underlyingPrice;
          if (underlying) setSpot(underlying);

          const uniqueExpiries = Array.from(new Map(parsed.map(item => [item.expiryTs, item])).values())
            .sort((a, b) => a.expiryTs - b.expiryTs);
          const target = uniqueExpiries.reduce((best, item) =>
            Math.abs(item.days - 30) < Math.abs(best.days - 30) ? item : best,
            uniqueExpiries[0],
          );
          setSelectedExpiry(target.days);

          const atm = parsed
            .filter(item => item.expiryTs === target.expiryTs)
            .reduce((best, item) =>
              Math.abs(item.strike - (underlying ?? market.spot)) < Math.abs(best.strike - (underlying ?? market.spot)) ? item : best,
            );
          setIv(atm.iv || market.iv);

          if (chainLoadedSymbolRef.current !== marketSymbol) {
            const currentTemplate = TEMPLATES.find(item => item.id === selectedTemplateId) ?? TEMPLATES[1];
            setLegs(instantiateTemplate(currentTemplate, market, underlying ?? market.spot, atm.iv || market.iv, parsed));
            chainLoadedSymbolRef.current = marketSymbol;
          }
        }
      } catch (error) {
        if (!cancelled) {
          setContracts([]);
          setChainError(error instanceof Error ? error.message : '期权链加载失败');
        }
      } finally {
        if (!cancelled) setChainLoading(false);
      }
    }

    loadChain();
    return () => { cancelled = true; };
  }, [market.spot, market.iv, marketSymbol]);

  const expiryChoices = useMemo(() => {
    const real = Array.from(new Map<number, OptionContract>(contracts.map(item => [item.expiryTs, item])).values())
      .sort((a, b) => a.expiryTs - b.expiryTs)
      .slice(0, 8)
      .map(item => ({ label: item.expiryLabel, days: item.days, expiryTs: item.expiryTs }));
    return real.length > 0 ? real : EXPIRIES.map(item => ({ ...item, expiryTs: Date.now() + item.days * 86_400_000 }));
  }, [contracts]);

  const selectedExpiryInfo = useMemo(() => {
    return expiryChoices.reduce((best, item) =>
      Math.abs(item.days - selectedExpiry) < Math.abs(best.days - selectedExpiry) ? item : best,
      expiryChoices[0],
    );
  }, [expiryChoices, selectedExpiry]);

  const chain = useMemo(() => {
    const realChain = contracts.filter(item => item.expiryTs === selectedExpiryInfo?.expiryTs);
    return realChain.length > 0 ? realChain : buildChain(market, spot, selectedExpiry, 0);
  }, [contracts, market, selectedExpiry, selectedExpiryInfo?.expiryTs, spot]);
  const strikes = useMemo(() => Array.from(new Set<number>(chain.map(item => item.strike))).sort((a, b) => a - b), [chain]);
  const axisStrikes = useMemo(() => pickAxisStrikes(strikes, spot, legs, axisTickCount), [axisTickCount, legs, spot, strikes]);
  const axisOiScale = useMemo(() => {
    const values = axisStrikes.flatMap(strike => [
      chain.find(item => item.strike === strike && item.type === 'call')?.oi ?? 0,
      chain.find(item => item.strike === strike && item.type === 'put')?.oi ?? 0,
    ]).filter(value => value > 0).sort((a, b) => a - b);
    if (values.length === 0) return 1;
    return Math.max(1, values[Math.floor((values.length - 1) * 0.86)]);
  }, [axisStrikes, chain]);
  const axisLegLayout = useMemo(() => {
    const buy = buildAxisLegLayout(axisStrikes, legs, 'buy');
    const sell = buildAxisLegLayout(axisStrikes, legs, 'sell');
    return new Map<string, { leftPct: number; top: number; lane: number }>([...buy, ...sell]);
  }, [axisStrikes, legs]);
  const hasRealChain = chain.some(item => !item.synthetic);
  const visibleChainLabel = selectedExpiryInfo?.label ?? `${selectedExpiry}D`;
  const atmContract = useMemo(() => {
    if (chain.length === 0) return null;
    return chain.reduce((best, item) =>
      Math.abs(item.strike - spot) < Math.abs(best.strike - spot) ? item : best,
      chain[0],
    );
  }, [chain, spot]);

  useEffect(() => {
    if (contracts.length === 0) return;
    setLegs(prev => prev.map(leg => {
      if (leg.kind !== 'option') return { ...leg, entry: spot };
      const contract = findContract(contracts, leg.strike, leg.type, leg.expiryDays, leg.expiryTs);
      return priceLegFromContract(leg, contract, spot, iv);
    }));
  }, [contracts, iv, spot]);

  const maxExpiry = Math.max(selectedExpiry, ...legs.map(leg => leg.expiryDays), 1);
  const averageLegIv = useMemo(() => {
    const ivs = legs
      .filter((leg): leg is StrategyLeg & { kind: 'option' } => leg.kind === 'option')
      .map(leg => leg.iv ?? iv)
      .filter(Number.isFinite);
    if (ivs.length === 0) return iv;
    return ivs.reduce((sum, value) => sum + value, 0) / ivs.length;
  }, [iv, legs]);
  const scenarioIv = Math.max(5, averageLegIv * ivMultiplier);

  useEffect(() => {
    if (!lastSavedAt) return undefined;
    const timer = window.setTimeout(() => setLastSavedAt(null), 1600);
    return () => window.clearTimeout(timer);
  }, [lastSavedAt]);

  const priceRows = useMemo(() => {
    const rows = 15;
    return Array.from({ length: rows }, (_, index) => {
      const pct = rangePct - (index * 2 * rangePct) / (rows - 1);
      return roundToStep(spot * (1 + pct / 100), market.step / 5);
    });
  }, [market.step, rangePct, spot]);
  const timeColumns = useMemo(() => {
    const points = [0, 0.16, 0.33, 0.5, 0.67, 0.84, 1];
    return points.map(point => Math.round(maxExpiry * point));
  }, [maxExpiry]);
  const chartPrices = useMemo(() => {
    return Array.from({ length: 121 }, (_, index) => spot * (1 - rangePct / 100) + (spot * (2 * rangePct / 100) * index) / 120);
  }, [rangePct, spot]);

  const netPremium = useMemo(() => legs.reduce((sum, leg) => sum + legSign(leg.side) * leg.qty * leg.entry, 0), [legs]);
  const expiryPnl = useMemo(() => chartPrices.map(price => legs.reduce((sum, leg) => sum + payoffAt(leg, price, 0, iv, 'pnl', ivMultiplier), 0)), [chartPrices, iv, ivMultiplier, legs]);
  const currentPnl = useMemo(() => chartPrices.map(price => legs.reduce((sum, leg) => sum + payoffAt(leg, price, leg.expiryDays, iv, 'pnl', ivMultiplier), 0)), [chartPrices, iv, ivMultiplier, legs]);
  const analysisDay = Math.round(maxExpiry * analysisDayRatio);
  const analysisPnl = useMemo(() => chartPrices.map(price => legs.reduce((sum, leg) => {
    const remaining = Math.max(0, leg.expiryDays - analysisDay);
    return sum + payoffAt(leg, price, remaining, iv, 'pnl', ivMultiplier);
  }, 0)), [analysisDay, chartPrices, iv, ivMultiplier, legs]);
  const maxProfit = useMemo(() => expiryPnl.length ? Math.max(...expiryPnl) : 0, [expiryPnl]);
  const maxLoss = useMemo(() => expiryPnl.length ? Math.min(...expiryPnl) : 0, [expiryPnl]);
  const breakeven = useMemo(() => {
    const values: number[] = [];
    for (let i = 1; i < chartPrices.length; i += 1) {
      const prev = expiryPnl[i - 1];
      const next = expiryPnl[i];
      if (prev === 0 || prev * next < 0) {
        const x = chartPrices[i - 1] + (chartPrices[i] - chartPrices[i - 1]) * (-prev / (next - prev || 1));
        values.push(x);
      }
    }
    return values;
  }, [chartPrices, expiryPnl]);

  const greeks = useMemo(() => {
    return legs.reduce((acc, leg) => {
      const scale = legSign(leg.side) * leg.qty;
      if (leg.kind === 'underlying') {
        acc.delta += scale;
        return acc;
      }
      const K = leg.strike ?? spot;
      const T = years(leg.expiryDays);
      const type = leg.type === 'put' ? 'P' : 'C';
      const legIv = Math.max(5, (leg.iv ?? iv) * ivMultiplier);
      acc.delta += scale * bsDelta(spot, K, T, legIv, type);
      acc.gamma += scale * bsGamma(spot, K, T, legIv);
      acc.vega += scale * bsVega(spot, K, T, legIv);
      acc.theta += scale * bsTheta(spot, K, T, legIv);
      return acc;
    }, { delta: 0, gamma: 0, vega: 0, theta: 0 });
  }, [iv, ivMultiplier, legs, spot]);

  const optionLegs = useMemo(() => legs.filter(leg => leg.kind === 'option'), [legs]);
  const selectedLeg = useMemo(() => legs.find(leg => leg.id === selectedLegId) ?? null, [legs, selectedLegId]);
  const selectedLegIndex = selectedLeg ? legs.findIndex(leg => leg.id === selectedLeg.id) : -1;
  const nearestBreakeven = useMemo(() => {
    if (breakeven.length === 0) return null;
    return breakeven.reduce((best, value) => (
      Math.abs(value - spot) < Math.abs(best - spot) ? value : best
    ), breakeven[0]);
  }, [breakeven, spot]);
  const nearestBreakevenPct = nearestBreakeven ? ((nearestBreakeven / spot) - 1) * 100 : null;
  const hasCalendarStructure = useMemo(() => {
    const expiries = new Set(optionLegs.map(leg => leg.expiryTs ?? leg.expiryDays));
    return expiries.size > 1;
  }, [optionLegs]);
  const nakedShortCall = useMemo(() => {
    const shortCallQty = optionLegs
      .filter(leg => leg.side === 'sell' && leg.type === 'call')
      .reduce((sum, leg) => sum + leg.qty, 0);
    const longCallQty = optionLegs
      .filter(leg => leg.side === 'buy' && leg.type === 'call')
      .reduce((sum, leg) => sum + leg.qty, 0);
    const longUnderlyingQty = legs
      .filter(leg => leg.kind === 'underlying' && leg.side === 'buy')
      .reduce((sum, leg) => sum + leg.qty, 0);
    return shortCallQty > longCallQty + longUnderlyingQty;
  }, [legs, optionLegs]);
  const nakedShortPut = useMemo(() => {
    return optionLegs.some(leg => (
      leg.side === 'sell'
      && leg.type === 'put'
      && !optionLegs.some(peer => peer.side === 'buy' && peer.type === 'put' && (peer.strike ?? 0) < (leg.strike ?? 0))
    ));
  }, [optionLegs]);
  const directionLabel = exposureText(greeks.delta, '看涨', '看跌');
  const volatilityLabel = exposureText(greeks.vega, '做多波动', '做空波动', '波动中性');
  const carryLabel = exposureText(greeks.theta, '收时间价值', '付时间价值', '时间中性');
  const upsideSlope = useMemo(() => legs.reduce((sum, leg) => {
    if (leg.kind === 'underlying') return sum + legSign(leg.side) * leg.qty;
    if (leg.type === 'call') return sum + legSign(leg.side) * leg.qty;
    return sum;
  }, 0), [legs]);
  const profitBoundLabel = upsideSlope > 0.01 ? '上行潜力大' : '有限';
  const lossBoundLabel = upsideSlope < -0.01 || nakedShortPut ? '尾部亏损大' : '有限';
  const strategyHeadline = `${market.symbol} ${visibleChainLabel} · ${activeTemplate.nameCn} · ${directionLabel} · ${volatilityLabel}`;

  const reviewItems = useMemo<ReviewItem[]>(() => {
    if (legs.length === 0) {
      return [{ level: 'watch', title: '还没有组合腿', detail: '先选择模板或添加合约，审查面板会自动生成风险结论。' }];
    }

    const items: ReviewItem[] = [];
    if (nakedShortCall) {
      items.push({ level: 'danger', title: '存在裸卖 Call 风险', detail: '上方价格快速突破时亏损可能不封顶，需要保护腿或明确止损。' });
    }
    if (nakedShortPut) {
      items.push({ level: 'danger', title: '存在裸卖 Put 风险', detail: '下跌尾部风险较重，建议检查保证金、最大亏损和保护 Put。' });
    }
    if (maxLoss < -Math.max(spot * 0.18, Math.abs(netPremium) * 3)) {
      items.push({ level: 'watch', title: '最大亏损偏大', detail: `到期曲线最低约 -${formatAbsMoney(maxLoss, 0)}，需要确认这不是超出账户承受范围的仓位。` });
    }
    if (nearestBreakevenPct !== null && Math.abs(nearestBreakevenPct) > rangePct * 0.7) {
      items.push({ level: 'watch', title: '盈亏平衡离现价较远', detail: `最近盈亏平衡在 ${formatCompact(nearestBreakeven ?? spot)}，距离现价 ${formatSignedPercent(nearestBreakevenPct)}。` });
    }
    if (Math.abs(greeks.delta) > 1.5) {
      items.push({ level: 'watch', title: '方向暴露较重', detail: `组合 Delta 为 ${formatMoney(greeks.delta, 2)}，更像方向仓而不是中性策略。` });
    }
    if (hasCalendarStructure) {
      items.push({ level: 'ok', title: '跨期限结构', detail: '组合含不同到期日，重点观察期限结构、近月衰减和远月 IV 变化。' });
    }
    if (Math.abs(greeks.vega) > 18 && Math.abs(ivMultiplier - 1) > 0.2) {
      items.push({ level: 'watch', title: '波动率情景要复核', detail: '组合 Vega 较明显，隐波倍率会显著改变中途盈亏。' });
    }
    if (items.length === 0) {
      items.push({ level: 'ok', title: '结构风险清晰', detail: '当前组合没有明显裸卖或异常暴露，继续检查入场价和目标行情即可。' });
    }
    return items.slice(0, 4);
  }, [greeks.delta, greeks.vega, hasCalendarStructure, ivMultiplier, legs.length, maxLoss, nakedShortCall, nakedShortPut, nearestBreakeven, nearestBreakevenPct, netPremium, rangePct, spot]);

  const tradePlan = useMemo(() => {
    const premiumLabel = netPremium <= 0
      ? `净收入 ${formatAbsMoney(netPremium, 2)}`
      : `净支出 ${formatAbsMoney(netPremium, 2)}`;
    const beLabel = breakeven.length
      ? breakeven.map(value => formatCompact(value)).join(' / ')
      : '暂无明确盈亏平衡';
    return [
      ['入场检查', `${premiumLabel}，使用 ${hasRealChain ? 'Deribit Bid/Ask' : '合成报价'} 估算成交。`],
      ['有效行情', `${directionLabel}，${volatilityLabel}，${carryLabel}。`],
      ['关键价位', `现价 ${formatCompact(spot)}，盈亏平衡 ${beLabel}。`],
      ['风控边界', `${lossBoundLabel} -${formatAbsMoney(maxLoss, 0)}，${profitBoundLabel} ${formatMoney(maxProfit, 0)}。`],
    ];
  }, [breakeven, carryLabel, directionLabel, hasRealChain, lossBoundLabel, maxLoss, maxProfit, netPremium, profitBoundLabel, spot, volatilityLabel]);

  const tableData = useMemo(() => {
    return priceRows.map(price => {
      return timeColumns.map(elapsed => {
        const raw = legs.reduce((sum, leg) => {
          const remaining = Math.max(0, leg.expiryDays - elapsed);
          return sum + payoffAt(leg, price, remaining, iv, valueMode, ivMultiplier);
        }, 0);
        return valueMode === 'pnlPercent' ? (Math.abs(netPremium) > 0 ? raw / Math.abs(netPremium) * 100 : 0) : raw;
      });
    });
  }, [iv, ivMultiplier, legs, netPremium, priceRows, timeColumns, valueMode]);
  const tableAbsMax = useMemo(() => Math.max(1, ...tableData.flat().map(value => Math.abs(value))), [tableData]);
  const chainRows = useMemo(() => {
    return strikes.map(strike => {
      const call = chain.find(item => item.strike === strike && item.type === 'call') ?? null;
      const put = chain.find(item => item.strike === strike && item.type === 'put') ?? null;
      return {
        strike,
        call,
        put,
        callSpread: call ? Math.max(0, call.ask - call.bid) : 0,
        putSpread: put ? Math.max(0, put.ask - put.bid) : 0,
        oi: (call?.oi ?? 0) + (put?.oi ?? 0),
        isAtm: Math.abs(strike - spot) <= market.step / 2,
        inStrategy: legs.some(leg => leg.kind === 'option' && leg.strike === strike && leg.expiryTs === selectedExpiryInfo?.expiryTs),
      };
    });
  }, [chain, legs, market.step, selectedExpiryInfo?.expiryTs, spot, strikes]);
  const legChainByExpiry = useMemo(() => {
    return expiryChoices.reduce<Record<number, OptionContract[]>>((acc, expiry) => {
      const byExpiry = contracts.filter(item => item.expiryTs === expiry.expiryTs);
      acc[expiry.expiryTs] = byExpiry.length > 0 ? byExpiry : buildChain(market, spot, expiry.days, 0);
      return acc;
    }, {});
  }, [contracts, expiryChoices, market, spot]);
  const selectedLegExpiry = useMemo(() => {
    if (!selectedLeg) return selectedExpiryInfo;
    return expiryChoices.find(item => item.expiryTs === selectedLeg.expiryTs)
      ?? expiryChoices.find(item => item.days === selectedLeg.expiryDays)
      ?? selectedExpiryInfo;
  }, [expiryChoices, selectedExpiryInfo, selectedLeg]);
  const selectedLegChain = useMemo(() => {
    if (selectedLeg?.kind !== 'option') return chain;
    return selectedLegExpiry?.expiryTs ? (legChainByExpiry[selectedLegExpiry.expiryTs] ?? chain) : chain;
  }, [chain, legChainByExpiry, selectedLeg, selectedLegExpiry?.expiryTs]);
  const selectedLegStrikes = useMemo(() => (
    Array.from(new Set<number>(selectedLegChain.map(item => item.strike))).sort((a, b) => a - b)
  ), [selectedLegChain]);
  const selectedLegOption = useMemo(() => {
    if (selectedLeg?.kind !== 'option') return null;
    return findContract(selectedLegChain, selectedLeg.strike, selectedLeg.type, selectedLeg.expiryDays, selectedLeg.expiryTs ?? selectedLegExpiry?.expiryTs);
  }, [selectedLeg, selectedLegChain, selectedLegExpiry?.expiryTs]);

  const curveOption = useMemo(() => ({
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 58, right: 18, top: 20, bottom: 36 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(11,15,23,0.94)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#fff', fontSize: 11 },
    },
    xAxis: {
      type: 'value',
      min: Math.min(...chartPrices),
      max: Math.max(...chartPrices),
      axisLine: { lineStyle: { color: '#404347' } },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      axisLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: '#404347' } },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      axisLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 10 },
    },
    series: [
      {
        name: '当前',
        type: 'line',
        symbol: 'none',
        lineStyle: { color: '#ff9c2e', width: 2 },
        data: chartPrices.map((price, index) => [price, currentPnl[index]]),
      },
      {
        name: '到期',
        type: 'line',
        symbol: 'none',
        lineStyle: { color: '#24AE64', width: 2 },
        data: chartPrices.map((price, index) => [price, expiryPnl[index]]),
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          data: [{ xAxis: spot, lineStyle: { color: 'rgba(255,255,255,.35)', type: 'dotted' }, label: { show: false } }],
        },
      },
      {
        name: `T+${analysisDay}D`,
        type: 'line',
        symbol: 'none',
        lineStyle: { color: 'rgba(255,255,255,.62)', width: 1.5, type: 'dashed' },
        data: chartPrices.map((price, index) => [price, analysisPnl[index]]),
      },
      {
        name: '盈亏平衡',
        type: 'scatter',
        symbol: 'diamond',
        symbolSize: 9,
        itemStyle: { color: '#24AE64' },
        data: breakeven.map(price => [price, 0]),
      },
    ],
  }), [analysisDay, analysisPnl, breakeven, chartPrices, currentPnl, expiryPnl, spot]);

  useEffect(() => {
    const axis = axisSurfaceRef.current;
    if (!axis) return undefined;
    const updateTickCount = () => {
      const next = Math.max(9, Math.min(AXIS_MAX_TICKS, Math.floor(axis.clientWidth / AXIS_MIN_TICK_GAP) + 1));
      setAxisTickCount(current => (current === next ? current : next));
    };
    updateTickCount();
    const observer = new ResizeObserver(updateTickCount);
    observer.observe(axis);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (legs.length === 0) {
      if (selectedLegId !== null) setSelectedLegId(null);
      return;
    }
    if (selectedLegId && !legs.some(leg => leg.id === selectedLegId)) {
      setSelectedLegId(legs[0].id);
      setLegEditorOpen(false);
    }
  }, [legs, selectedLegId]);

  useEffect(() => {
    if (viewMode === 'curve' && valueMode !== 'pnl') {
      setValueMode('pnl');
    }
  }, [valueMode, viewMode]);

  function applyTemplate(template: StrategyTemplate) {
    const nextLegs = instantiateTemplate(template, market, spot, iv, contracts);
    setSelectedTemplateId(template.id);
    setExpandedTemplateId(template.id);
    setLegs(nextLegs);
    setSelectedLegId(nextLegs[0]?.id ?? null);
    setLegEditorOpen(false);
    setLegEditorAnchor(null);
    setRiskMenuOpen(false);
    setAddOpen(false);
  }

  function changeMarket(nextSymbol: string) {
    const next = MARKETS.find(item => item.symbol === nextSymbol) ?? MARKETS[0];
    setMarketSymbol(next.symbol);
    setSpot(next.spot);
    setIv(next.iv);
    setSelectedExpiry(30);
    setContracts([]);
    chainLoadedSymbolRef.current = null;
    const template = TEMPLATES.find(item => item.id === selectedTemplateId) ?? TEMPLATES[1];
    const nextLegs = instantiateTemplate(template, next, next.spot, next.iv);
    setLegs(nextLegs);
    setSelectedLegId(nextLegs[0]?.id ?? null);
    setLegEditorOpen(false);
    setLegEditorAnchor(null);
    setRiskMenuOpen(false);
  }

  function addLeg(kind: LegKind, side: LegSide, type?: OptionType) {
    if (kind === 'underlying') {
      const nextLeg: StrategyLeg = {
        id: `leg-${Date.now()}`,
        kind,
        side,
        qty: 1,
        expiryDays: 0,
        entry: spot,
      };
      setLegs(prev => [...prev, nextLeg]);
      setSelectedLegId(nextLeg.id);
      setLegEditorOpen(true);
      setLegEditorAnchor(null);
      setRiskMenuOpen(false);
    } else {
      const selectedChain = chain.length > 0 ? chain : buildChain(market, spot, selectedExpiry, 0);
      const strike = selectedChain.reduce((best, contract) =>
        Math.abs(contract.strike - spot) < Math.abs(best.strike - spot) ? contract : best,
        selectedChain[0],
      )?.strike ?? roundToStep(spot, market.step);
      const baseLeg: StrategyLeg = {
        id: `leg-${Date.now()}`,
        kind,
        side,
        type,
        strike,
        expiryDays: selectedExpiry,
        expiryTs: selectedExpiryInfo?.expiryTs,
        qty: 1,
        entry: optionPrice(spot, strike, years(selectedExpiry), iv, type ?? 'call'),
      };
      const nextLeg = priceLegFromContract(baseLeg, findContract(selectedChain, strike, type, selectedExpiry, selectedExpiryInfo?.expiryTs), spot, iv);
      setLegs(prev => [...prev, nextLeg]);
      setSelectedLegId(nextLeg.id);
      setLegEditorOpen(true);
      setLegEditorAnchor(null);
      setRiskMenuOpen(false);
    }
    setAddOpen(false);
  }

  function addContractLeg(contract: OptionContract, side: LegSide) {
    const nextLeg = makeLegFromContract(contract, side);
    setSelectedTemplateId('custom');
    setExpandedTemplateId('custom');
    setLegs(prev => [...prev, nextLeg]);
    setSelectedLegId(nextLeg.id);
    setLegEditorOpen(true);
    setLegEditorAnchor(null);
    setRiskMenuOpen(false);
    setAddOpen(false);
    setAxisMenu(null);
  }

  function updateLeg(id: string, patch: Partial<StrategyLeg>) {
    setLegs(prev => prev.map(leg => {
      if (leg.id !== id) return leg;
      const next = { ...leg, ...patch };
      if (next.kind === 'option') {
        const expiry = expiryChoices.find(item => item.days === next.expiryDays)
          ?? expiryChoices.find(item => item.expiryTs === next.expiryTs)
          ?? selectedExpiryInfo;
        const candidateChain = expiry?.expiryTs ? (legChainByExpiry[expiry.expiryTs] ?? chain) : chain;
        const contract = findContract(candidateChain, next.strike, next.type, next.expiryDays, expiry?.expiryTs);
        return priceLegFromContract(next, contract, spot, iv);
      } else {
        next.entry = spot;
      }
      return next;
    }));
  }

  function moveStrategyToStrike(anchorLegId: string, strike: number, dragSnapshot?: Pick<AxisDragState, 'anchorStartStrike' | 'startStrikes'>) {
    setLegs(prev => {
      const anchor = prev.find(item => item.id === anchorLegId);
      const anchorStartStrike = dragSnapshot?.anchorStartStrike ?? (anchor?.kind === 'option' ? anchor.strike : null);
      if (!anchor || anchor.kind !== 'option' || !anchorStartStrike) return prev;
      const startStrikes = dragSnapshot?.startStrikes ?? prev
        .filter((leg): leg is StrategyLeg & { strike: number } => leg.kind === 'option' && Number.isFinite(leg.strike))
        .map(leg => ({ id: leg.id, strike: leg.strike }));
      const rawOffset = strike - anchorStartStrike;
      const minStart = Math.min(...startStrikes.map(item => item.strike));
      const maxStart = Math.max(...startStrikes.map(item => item.strike));
      const minStrike = strikes[0] ?? minStart;
      const maxStrike = strikes[strikes.length - 1] ?? maxStart;
      const offset = Math.max(minStrike - minStart, Math.min(maxStrike - maxStart, rawOffset));
      if (offset === 0) return prev;
      return prev.map(leg => {
        if (leg.kind !== 'option') return leg;
        const start = startStrikes.find(item => item.id === leg.id);
        const nextStrike = (start?.strike ?? leg.strike ?? anchorStartStrike) + offset;
        const contract = findContract(chain, nextStrike, leg.type, leg.expiryDays, leg.expiryTs);
        return priceLegFromContract({ ...leg, strike: nextStrike }, contract, spot, iv);
      });
    });
    setSelectedLegId(anchorLegId);
  }

  function strikeFromAxisX(x: number, axisWidth: number) {
    if (axisStrikes.length === 0) return null;
    const trackWidth = Math.max(1, axisWidth - 32);
    const ratio = Math.max(0, Math.min(1, (x - 16) / trackWidth));
    const index = Math.max(0, Math.min(axisStrikes.length - 1, Math.round(ratio * (axisStrikes.length - 1))));
    return axisStrikes[index];
  }

  function setAxisDragState(next: AxisDragState | null) {
    axisDragRef.current = next;
    setAxisDrag(next);
  }

  function startAxisDrag(event: React.PointerEvent<HTMLButtonElement>, legId: string) {
    if (event.button !== 0) return;
    const axis = event.currentTarget.closest('.strategy-axis-surface');
    const rect = axis?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setAxisMenu(null);
    setSelectedLegId(legId);
    setAxisDragState({
      legId,
      pointerId: event.pointerId,
      axisLeft: rect.left,
      axisWidth: rect.width,
      startX: event.clientX - rect.left,
      x: event.clientX - rect.left,
      moved: false,
      lastStrike: legs.find(leg => leg.id === legId && leg.kind === 'option')?.strike ?? null,
      anchorStartStrike: legs.find(leg => leg.id === legId && leg.kind === 'option')?.strike ?? null,
      startStrikes: legs
        .filter((leg): leg is StrategyLeg & { strike: number } => leg.kind === 'option' && Number.isFinite(leg.strike))
        .map(leg => ({ id: leg.id, strike: leg.strike })),
    });
  }

  function updateAxisDragFromPointer(clientX: number, pointerId: number) {
    const drag = axisDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    const nextX = clientX - drag.axisLeft;
    const clampedX = Math.max(16, Math.min(drag.axisWidth - 16, nextX));
    const nextStrike = strikeFromAxisX(clampedX, drag.axisWidth);
    const nextDrag = {
      ...drag,
      x: clampedX,
      moved: drag.moved || Math.abs(nextX - drag.startX) > 3,
      lastStrike: nextStrike ?? drag.lastStrike,
    };
    setAxisDragState(nextDrag);

    if (nextStrike !== null && nextStrike !== drag.lastStrike) {
      moveStrategyToStrike(drag.legId, nextStrike, drag);
    }
  }

  function updateAxisDrag(event: React.PointerEvent<HTMLButtonElement>) {
    updateAxisDragFromPointer(event.clientX, event.pointerId);
  }

  function finishAxisDragFromPointer(pointerId: number) {
    const drag = axisDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    setAxisDragState(null);
    if (drag.moved) {
      suppressAxisClickRef.current = true;
      window.setTimeout(() => { suppressAxisClickRef.current = false; }, 0);
      const nextStrike = strikeFromAxisX(drag.x, drag.axisWidth);
      if (nextStrike !== null && nextStrike !== drag.lastStrike) moveStrategyToStrike(drag.legId, nextStrike, drag);
    }
  }

  function finishAxisDrag(event: React.PointerEvent<HTMLButtonElement>) {
    finishAxisDragFromPointer(event.pointerId);
  }

  useEffect(() => {
    if (!axisDrag) return undefined;
    const handleMove = (event: PointerEvent) => {
      updateAxisDragFromPointer(event.clientX, event.pointerId);
    };
    const handleEnd = (event: PointerEvent) => {
      finishAxisDragFromPointer(event.pointerId);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
    };
  }, [axisDrag]);

  function addAxisLeg(strike: number, side: LegSide, type: OptionType) {
    const contract = findContract(chain, strike, type, selectedExpiry, selectedExpiryInfo?.expiryTs)
      ?? chain.find(item => item.strike === strike && item.type === type)
      ?? null;
    if (contract) {
      addContractLeg(contract, side);
      return;
    }
    const baseLeg: StrategyLeg = {
      id: `leg-${Date.now()}`,
      kind: 'option',
      side,
      type,
      strike,
      expiryDays: selectedExpiry,
      expiryTs: selectedExpiryInfo?.expiryTs,
      qty: 1,
      entry: optionPrice(spot, strike, years(selectedExpiry), iv, type),
    };
    const nextLeg = priceLegFromContract(baseLeg, null, spot, iv);
    setSelectedTemplateId('custom');
    setExpandedTemplateId('custom');
    setLegs(prev => [...prev, nextLeg]);
    setSelectedLegId(nextLeg.id);
    setLegEditorOpen(true);
    setLegEditorAnchor(null);
    setRiskMenuOpen(false);
    setAxisMenu(null);
  }

  function removeLeg(id: string) {
    const removedIndex = legs.findIndex(leg => leg.id === id);
    const nextSelectedId = legs.filter(leg => leg.id !== id)[Math.min(Math.max(removedIndex, 0), legs.length - 2)]?.id ?? null;
    setLegs(prev => prev.filter(leg => leg.id !== id));
    if (selectedLegId === id) setSelectedLegId(nextSelectedId);
    if (!nextSelectedId) setLegEditorOpen(false);
  }

  function saveTrade() {
    const payload = {
      market: market.symbol,
      spot,
      iv: scenarioIv,
      template: selectedTemplateId,
      headline: strategyHeadline,
      reviewItems,
      tradePlan,
      metrics: { netPremium, maxProfit, maxLoss, breakeven, greeks },
      legs,
      savedAt: Date.now(),
    };
    const existing = JSON.parse(localStorage.getItem('strategy_builder_trades') || '[]') as unknown[];
    localStorage.setItem('strategy_builder_trades', JSON.stringify([payload, ...existing].slice(0, 20)));
    setLastSavedAt(payload.savedAt);
  }

  const riskReviewContent = (
    <div className="space-y-2">
      <div className="rounded-[8px] bg-[#2B2D35] p-3">
        <div className="text-[11px] text-white/40">当前方案</div>
        <div className="mt-1 text-[13px] font-semibold leading-5 text-white/86">{strategyHeadline}</div>
        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-[6px] bg-black text-[11px]">
          {[
            ['收益', profitBoundLabel],
            ['亏损', lossBoundLabel],
            ['时间', carryLabel],
            ['期限', hasCalendarStructure ? '跨期限' : '单期限'],
          ].map(([label, value]) => (
            <div key={label} className="bg-[#17181E] px-2 py-1.5">
              <div className="text-white/34">{label}</div>
              <div className="mt-0.5 font-semibold text-white/72">{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[8px] bg-[#17181E] p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[12px] font-semibold text-white/72">风险诊断</div>
          <span className="text-[10px] text-white/35">{reviewItems.filter(item => item.level !== 'ok').length} 项需复核</span>
        </div>
        <div className="space-y-1.5">
          {reviewItems.map(item => (
            <div key={`${item.level}-${item.title}`} className="rounded-[6px] bg-[#2B2D35] p-2">
              <div className="flex items-center gap-2">
                <span className={cn('rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold', reviewTone(item.level))}>
                  {item.level === 'danger' ? '高风险' : item.level === 'watch' ? '复核' : '正常'}
                </span>
                <span className="text-[12px] font-semibold text-white/78">{item.title}</span>
              </div>
              <div className="mt-1 text-[11px] leading-4 text-white/45">{item.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[8px] bg-[#17181E] p-3">
        <div className="mb-2 text-[12px] font-semibold text-white/72">交易计划</div>
        <div className="space-y-1.5">
          {tradePlan.map(([label, detail]) => (
            <div key={label} className="grid grid-cols-[56px_1fr] gap-2 text-[11px] leading-4">
              <div className="text-white/36">{label}</div>
              <div className="text-white/62">{detail}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const legEditorContent = selectedLeg ? (
    <div className="rounded-[8px] bg-[#2B2D35] p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] text-white/38">当前腿 #{selectedLegIndex + 1}</div>
          <div className="mt-1 truncate text-[13px] font-semibold text-white/84">
            {selectedLeg.kind === 'underlying'
              ? `${market.symbol} 标的`
              : selectedLeg.instrumentName ?? selectedLegOption?.instrumentName ?? `${market.symbol}-${selectedLegExpiry?.label ?? `${selectedLeg.expiryDays}D`}-${selectedLeg.strike}-${selectedLeg.type === 'call' ? 'C' : 'P'}`}
          </div>
        </div>
        <button onClick={() => removeLeg(selectedLeg.id)} className="h-7 rounded-[5px] bg-[#17181E] px-2 text-[11px] text-white/48 hover:bg-[#3A3B40] hover:text-[#EF454A]">删除</button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="grid grid-cols-2 overflow-hidden rounded-[6px] bg-[#17181E] p-0.5">
          {(['buy', 'sell'] as LegSide[]).map(side => (
            <button
              key={side}
              onClick={() => updateLeg(selectedLeg.id, { side })}
              className={cn(
                'h-7 rounded-[5px] text-[12px] transition-colors',
                selectedLeg.side === side ? 'bg-white/[0.03] font-semibold' : 'text-white/48 hover:bg-[#3A3B40]',
                side === 'buy' ? 'text-[#24AE64]' : 'text-[#EF454A]',
              )}
            >
              {side === 'buy' ? '买入' : '卖出'}
            </button>
          ))}
        </div>
        <input type="number" min="0.1" step="0.1" value={selectedLeg.qty} onChange={event => updateLeg(selectedLeg.id, { qty: Number(event.target.value) || 1 })} className={INPUT_CLS} />
        {selectedLeg.kind === 'option' && (
          <>
            <select value={selectedLeg.type} onChange={event => updateLeg(selectedLeg.id, { type: event.target.value as OptionType })} className={SELECT_CLS}>
              <option value="call">看涨 Call</option>
              <option value="put">看跌 Put</option>
            </select>
            <select
              value={selectedLegExpiry?.expiryTs ?? ''}
              onChange={event => {
                const expiry = expiryChoices.find(item => item.expiryTs === Number(event.target.value));
                if (expiry) updateLeg(selectedLeg.id, { expiryDays: expiry.days, expiryTs: expiry.expiryTs });
              }}
              className={SELECT_CLS}
            >
              {expiryChoices.map(expiry => <option key={expiry.expiryTs} value={expiry.expiryTs}>{expiry.label} · {expiry.days}天</option>)}
            </select>
            <select value={selectedLeg.strike} onChange={event => updateLeg(selectedLeg.id, { strike: Number(event.target.value) })} className={cn(SELECT_CLS, 'col-span-2')}>
              {selectedLegStrikes.map(strike => <option key={strike} value={strike}>{strike.toLocaleString()}</option>)}
            </select>
          </>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-[6px] bg-black text-[11px]">
        <div className="bg-[#17181E] px-2 py-1.5">
          <div className="text-white/34">Bid</div>
          <div className="tnum text-[#24AE64]">{formatPrice(selectedLegOption?.bid ?? selectedLeg.bid, 2)}</div>
        </div>
        <div className="bg-[#17181E] px-2 py-1.5">
          <div className="text-white/34">Ask</div>
          <div className="tnum text-[#EF454A]">{formatPrice(selectedLegOption?.ask ?? selectedLeg.ask, 2)}</div>
        </div>
        <div className="bg-[#17181E] px-2 py-1.5">
          <div className="text-white/34">Entry</div>
          <div className="tnum text-white/72">{formatPrice(selectedLeg.entry, 2)}</div>
        </div>
      </div>
      {selectedLeg.kind === 'option' && (
        <div className="mt-2 flex items-center gap-2 text-[10px] text-white/40">
          <span>{selectedLegOption?.synthetic ? '合成报价' : 'Deribit'}</span>
          <span>IV {formatPrice(selectedLegOption?.iv ?? selectedLeg.iv, 1)}%</span>
          <span>OI {formatCompact(selectedLegOption?.oi ?? selectedLeg.oi ?? 0)}</span>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="strategy-builder-page position-builder-page absolute inset-0 flex overflow-hidden bg-black text-white font-medium">
      <RecommendationSidebar
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        marketView={marketView}
        setMarketView={setMarketView}
        rankedTemplates={rankedTemplates}
        weakTemplateCount={weakTemplateCount}
        selectedTemplateId={selectedTemplateId}
        expandedTemplateId={expandedTemplateId}
        setExpandedTemplateId={setExpandedTemplateId}
        applyTemplate={applyTemplate}
        market={market}
      />

      <main className="strategy-builder-main min-w-0 flex-1 flex flex-col overflow-hidden">
        <header className="h-[104px] shrink-0 border-b border-white/[0.08] bg-[#17181E]">
          <div className="h-14 px-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <AnimatedNumber value={spot} format={formatSpotValue} duration={0.18} className="block text-[24px] font-semibold tnum" />
                <div className={cn('text-[12px]', contracts.length > 0 ? 'text-[#24AE64]' : chainError ? 'text-[#FEBC2E]' : 'text-white/45')}>
                  {chainLoading
                    ? '加载 Deribit 期权链…'
                    : contracts.length > 0
                      ? `${hasRealChain ? 'Deribit 实盘链' : '合成期限'} · ${contracts.length} 合约`
                      : chainError
                        ? 'Deribit 不可用 · 模拟兜底'
                        : '模拟兜底'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select value={marketSymbol} onChange={event => changeMarket(event.target.value)} className={cn(SELECT_CLS, '!w-32')}>
                  {MARKETS.map(item => <option key={item.symbol} value={item.symbol}>{item.symbol} · {item.label}</option>)}
                  </select>
                <input
                  value={spot}
                  type="number"
                  onChange={event => setSpot(Number(event.target.value) || market.spot)}
                  className={cn(INPUT_CLS, '!w-28')}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <HeaderStatsStrip visibleChainLabel={visibleChainLabel} atmContract={atmContract} iv={iv} chain={chain} />
              <div className="relative">
                <button
                  onClick={() => {
                    setAddOpen(open => !open);
                    setRiskMenuOpen(false);
                  }}
                  className="h-8 whitespace-nowrap rounded-[6px] bg-[#2B2D35] px-3 text-[12px] text-white/80 hover:bg-[#3A3B40]"
                >
                  + 添加合约
                </button>
                {addOpen && (
                  <AddContractMenu
                    visibleChainLabel={visibleChainLabel}
                    hasRealChain={hasRealChain}
                    chainRows={chainRows}
                    addLeg={addLeg}
                    addContractLeg={addContractLeg}
                    onClose={() => setAddOpen(false)}
                  />
                )}
              </div>
              <button onClick={saveTrade} disabled={legs.length === 0} className="h-8 whitespace-nowrap rounded-[6px] bg-[#ff9c2e] px-3 text-[12px] font-semibold text-black hover:bg-[#ffad45] disabled:opacity-35">
                {lastSavedAt ? '已保存' : '保存交易'}
              </button>
            </div>
          </div>

          <div className="h-[50px] px-5 flex items-center gap-2">
            {expiryChoices.map(expiry => (
              <button
                key={expiry.expiryTs}
                onClick={() => setSelectedExpiry(expiry.days)}
                className={cn(
                  'h-9 min-w-16 px-3 text-[12px]',
                  SMALL_BUTTON_BASE,
                  selectedExpiryInfo?.expiryTs === expiry.expiryTs && SMALL_BUTTON_ACTIVE,
                )}
              >
                <div className="font-semibold">{expiry.label}</div>
                <div className="text-[10px] text-white/42">{expiry.days}天</div>
              </button>
            ))}
            <div className="ml-auto flex items-center gap-3">
              <label className="flex items-center gap-2 text-[12px] text-white/55">
                IV
                <input type="number" value={iv} onChange={event => setIv(Number(event.target.value) || market.iv)} className={cn(INPUT_CLS, '!w-16 text-center')} />
              </label>
              <span className="text-[12px] text-white/38">模板：{activeTemplate.nameCn}</span>
            </div>
          </div>
        </header>

        <div className="strategy-builder-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <section className="shrink-0 border-b border-white/[0.08] bg-black px-4 py-1.5">
          <div ref={axisSurfaceRef} className="strategy-axis-surface relative h-[118px] overflow-visible rounded-[8px] bg-[#17181E]">
            <div className="absolute inset-0 overflow-hidden rounded-[8px]">
              <div className="absolute left-3 right-3 top-2 z-20 flex items-center justify-between gap-3">
                <div className="group relative flex items-center gap-1.5 text-[12px] text-white/58">
                  <span>行权价轴</span>
                  <button
                    type="button"
                    className="h-5 w-5 rounded-full bg-[#2B2D35] text-[12px] text-white/55 hover:bg-[#3A3B40] hover:text-white/85"
                    aria-label="行权价轴说明"
                  >
                    i
                  </button>
                  <div className="pointer-events-none absolute left-0 top-7 z-30 hidden w-[360px] rounded-[8px] bg-[rgba(21,23,25,.96)] p-3 text-[11px] leading-5 text-white/66 shadow-[0_8px_25px_rgba(0,0,0,.4)] backdrop-blur-xl group-hover:block">
                    <div className="mb-1 text-[12px] font-semibold text-white/82">轴上直接调腿</div>
                    <div>买入腿显示在上方，卖出腿显示在下方；Call 用红色，Put 用绿色。上下柱状图表示该行权价的 Call / Put 持仓量。</div>
                    <div className="mt-1 text-white/48">点击期权标签查看并编辑数量；拖动任意标签会平移整个期权组合，保持价差和结构不变。拖动经过新行权价时收益、Greeks、报价会实时更新。右键空白行权价可添加新腿，单腿行权价在右侧编辑。</div>
                  </div>
                </div>
                <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-white/38">
                  <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-sm bg-[#EF454A]/70" />Call OI</span>
                  <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-sm bg-[#24AE64]/70" />Put OI</span>
                  <span className="flex items-center gap-1"><i className="h-2.5 w-px bg-[#ff9c2e]/80" />现价</span>
                  <span className="truncate">右键添加 · 拖动平移组合</span>
                </div>
              </div>
              <div className="absolute inset-x-4 top-[62px] h-px bg-white/[0.12]" />
              <div className="absolute inset-x-0 top-[36px] h-[74px]">
                {axisStrikes.map(strike => {
                  const call = chain.find(item => item.strike === strike && item.type === 'call');
                  const put = chain.find(item => item.strike === strike && item.type === 'put');
                  const callH = Math.max(4, Math.min(26, Math.sqrt((call?.oi ?? 0) / axisOiScale) * 24));
                  const putH = Math.max(4, Math.min(26, Math.sqrt((put?.oi ?? 0) / axisOiScale) * 24));
                  const leftPct = axisPositionPct(axisStrikes, strike);
                  return (
                    <button
                      key={strike}
                      onClick={() => {
                        setAxisMenu(null);
                        setAxisTooltip(null);
                        setRiskMenuOpen(false);
                      }}
                      onMouseEnter={event => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setAxisTooltip({
                          strike,
                          leftPx: rect.left + rect.width / 2,
                          topPx: rect.top,
                          callOi: call?.oi ?? 0,
                          putOi: put?.oi ?? 0,
                        });
                      }}
                      onMouseOver={event => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setAxisTooltip({
                          strike,
                          leftPx: rect.left + rect.width / 2,
                          topPx: rect.top,
                          callOi: call?.oi ?? 0,
                          putOi: put?.oi ?? 0,
                        });
                      }}
                      onPointerEnter={event => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setAxisTooltip({
                          strike,
                          leftPx: rect.left + rect.width / 2,
                          topPx: rect.top,
                          callOi: call?.oi ?? 0,
                          putOi: put?.oi ?? 0,
                        });
                      }}
                      onPointerMove={event => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setAxisTooltip(current => current?.strike === strike
                          ? { ...current, leftPx: rect.left + rect.width / 2, topPx: rect.top }
                          : current);
                      }}
                      onMouseLeave={() => setAxisTooltip(null)}
                      onPointerLeave={() => setAxisTooltip(null)}
                      onContextMenu={event => {
                        event.preventDefault();
                        const rect = event.currentTarget.closest('.strategy-axis-surface')?.getBoundingClientRect();
                        setRiskMenuOpen(false);
                        setAxisTooltip(null);
                        setAxisMenu({ strike, x: rect ? event.clientX - rect.left : event.clientX, y: rect ? event.clientY - rect.top : event.clientY, width: rect?.width ?? 640 });
                      }}
                      className="group absolute top-0 h-full -translate-x-1/2 text-[10px] text-white/45 hover:text-white/80"
                      style={{ left: `${leftPct}%`, width: `min(48px, calc(96% / ${Math.max(1, axisStrikes.length - 1)}))` }}
                      title={`右键添加 ${strike.toLocaleString()} · Call ${formatPrice(call?.mark, 2)} · Put ${formatPrice(put?.mark, 2)} · Call OI ${formatCompact(call?.oi ?? 0)} · Put OI ${formatCompact(put?.oi ?? 0)}`}
                    >
                      <span className="pointer-events-none absolute left-1/2 top-[24px] z-[2] h-2 w-px -translate-x-1/2 bg-white/[0.18]" />
                      <span className="pointer-events-none absolute left-1/2 top-[58px] z-[3] -translate-x-1/2 tnum">{formatCompact(strike)}</span>
                      <span
                        className="pointer-events-none absolute left-1/2 z-[1] w-1.5 -translate-x-1/2 rounded-b bg-[#EF454A]/55"
                        style={{ top: 26 - callH, height: callH }}
                      />
                      <span
                        className="pointer-events-none absolute left-1/2 top-[28px] z-[1] w-1.5 -translate-x-1/2 rounded-t bg-[#24AE64]/55"
                        style={{ height: putH }}
                      />
                    </button>
                  );
                })}
              </div>
              {optionLegs.map((leg) => {
                const legLayout = axisLegLayout.get(leg.id);
                const leftPct = legLayout?.leftPct ?? axisPositionPct(axisStrikes, leg.strike);
                const top = legLayout?.top ?? (leg.side === 'buy' ? 28 : 76);
                const connectorTop = leg.side === 'buy' ? top + 24 : 62;
                const connectorHeight = leg.side === 'buy' ? Math.max(6, 62 - (top + 24)) : Math.max(6, top - 62);
                const isSelected = leg.id === selectedLegId;
                const isDragging = axisDrag?.legId === leg.id;
                const dragLeftPct = isDragging ? (axisDrag.x / Math.max(1, axisDrag.axisWidth)) * 100 : leftPct;
                return (
                  <React.Fragment key={leg.id}>
                    <div
                      className={cn(
                        'pointer-events-none absolute z-[8] w-px -translate-x-1/2',
                        leg.type === 'call' ? 'bg-[#EF454A]/75' : 'bg-[#24AE64]/75',
                      )}
                      style={{ left: `${dragLeftPct}%`, top: connectorTop, height: connectorHeight }}
                    >
                      <span
                        className={cn(
                          'absolute left-1/2 h-0 w-0 -translate-x-1/2 border-x-[4px] border-x-transparent',
                          leg.side === 'buy'
                            ? 'bottom-0 border-t-[5px] border-t-current'
                            : 'top-0 border-b-[5px] border-b-current',
                          leg.type === 'call' ? 'text-[#EF454A]' : 'text-[#24AE64]',
                        )}
                      />
                    </div>
                    <button
                      onPointerDown={event => startAxisDrag(event, leg.id)}
                      onPointerMove={updateAxisDrag}
                      onPointerUp={finishAxisDrag}
                      onPointerCancel={finishAxisDrag}
                      onClick={() => {
                        if (suppressAxisClickRef.current) return;
                        setSelectedLegId(leg.id);
                      }}
                      className={cn(
                        'absolute z-10 -translate-x-1/2 touch-none select-none whitespace-nowrap rounded-[5px] px-2 py-1 text-[11px] font-semibold cursor-grab active:cursor-grabbing transition-[background-color,color,box-shadow]',
                        leg.type === 'call' ? 'bg-[#EF454A] text-white' : 'bg-[#24AE64] text-black',
                        isSelected && 'strategy-axis-leg-selected',
                        isDragging && 'z-20 opacity-95',
                      )}
                      style={{ left: `${dragLeftPct}%`, top }}
                      title="点击选中；拖动平移整个期权组合"
                    >
                      {leg.side === 'buy' ? '买' : '卖'} x{leg.qty} {formatCompact(leg.strike ?? 0)} {leg.type === 'call' ? 'C' : 'P'}
                    </button>
                  </React.Fragment>
                );
              })}
              <div className="pointer-events-none absolute z-[9] w-px -translate-x-1/2 bg-[#ff9c2e]/80" style={{ left: `${axisPositionPct(axisStrikes, spot)}%`, top: 18, height: 44 }}>
                <span
                  className="absolute left-1/2 top-[-12px] -translate-x-1/2 whitespace-nowrap rounded-[5px] bg-[#ff9c2e] px-1.5 py-0.5 text-[10px] font-semibold text-black"
                  style={{ transform: `translateX(${axisPositionPct(axisStrikes, spot) < 8 ? '0' : axisPositionPct(axisStrikes, spot) > 92 ? '-100%' : '-50%'})` }}
                >
                  最新价 {formatSpotValue(spot)}
                </span>
                <span className="absolute bottom-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[5px] border-x-transparent border-t-[#ff9c2e]" />
              </div>
              {axisDrag && (() => {
                const previewStrike = strikeFromAxisX(axisDrag.x, axisDrag.axisWidth);
                return (
                  <div className="pointer-events-none absolute top-[30px] bottom-1 z-[9] w-px bg-white/35" style={{ left: `${(axisDrag.x / Math.max(1, axisDrag.axisWidth)) * 100}%` }}>
                    <span className="absolute -top-0.5 left-1 rounded-[4px] bg-[#2B2D35] px-1.5 py-0.5 text-[10px] font-semibold text-white/80">
                      {previewStrike ? formatCompact(previewStrike) : ''}
                    </span>
                  </div>
                );
              })()}
            </div>
            {axisTooltip && (
              <div
                className="pointer-events-none fixed z-50 w-[136px] -translate-x-1/2 rounded-[6px] bg-[rgba(21,23,25,.96)] px-2 py-1.5 text-left text-[10px] leading-4 text-white/68 shadow-[0_8px_25px_rgba(0,0,0,.4)] backdrop-blur-xl"
                style={{
                  left: Math.max(76, Math.min(axisTooltip.leftPx, window.innerWidth - 76)),
                  top: Math.max(8, axisTooltip.topPx - 40),
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white/45">Strike</span>
                  <span className="tnum font-semibold text-white/78">{axisTooltip.strike.toLocaleString()}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="text-[#EF454A]">Call OI</span>
                  <span className="tnum text-white/76">{axisTooltip.callOi.toLocaleString('en-US')}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#24AE64]">Put OI</span>
                  <span className="tnum text-white/76">{axisTooltip.putOi.toLocaleString('en-US')}</span>
                </div>
              </div>
            )}
            {axisMenu && (
              <div
                className="absolute z-30 w-[168px] rounded-[8px] bg-[rgba(21,23,25,.96)] p-2 shadow-[0_8px_25px_rgba(0,0,0,.4)] backdrop-blur-xl"
                style={{ left: Math.max(8, Math.min(axisMenu.x, axisMenu.width - 176)), top: Math.min(axisMenu.y, 18) }}
                onMouseLeave={() => setAxisMenu(null)}
              >
                <div className="mb-1 px-1 text-[11px] font-semibold text-white/74">{axisMenu.strike.toLocaleString()}</div>
                <div className="grid grid-cols-2 gap-1">
                  {[
                    ['buy', 'call', '买 Call'],
                    ['sell', 'call', '卖 Call'],
                    ['buy', 'put', '买 Put'],
                    ['sell', 'put', '卖 Put'],
                  ].map(([side, type, label]) => (
                    <button
                      key={`${side}-${type}`}
                      onClick={() => addAxisLeg(axisMenu.strike, side as LegSide, type as OptionType)}
                      className={cn(
                        'h-7 rounded-[5px] bg-[#2B2D35] px-2 text-[11px] hover:bg-[#3A3B40]',
                        type === 'call' ? 'text-[#EF454A]' : 'text-[#24AE64]',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="relative z-30 shrink-0 overflow-visible border-b border-white/[0.08] bg-[#101014] px-4 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[11px] text-white/38">组合结构</span>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto hide-scrollbar">
              {legs.length === 0 && <span className="text-[12px] text-white/38">从左侧策略或添加合约开始</span>}
              {legs.map((leg, index) => {
                const legExpiry = expiryChoices.find(item => item.expiryTs === leg.expiryTs)
                  ?? expiryChoices.find(item => item.days === leg.expiryDays)
                  ?? selectedExpiryInfo;
                const isSelected = leg.id === selectedLegId;
                return (
                  <button
                    key={leg.id}
                    onClick={event => {
                      const sectionRect = event.currentTarget.closest('section')?.getBoundingClientRect();
                      const buttonRect = event.currentTarget.getBoundingClientRect();
                      setSelectedLegId(leg.id);
                      setLegEditorOpen(true);
                      setLegEditorAnchor(sectionRect ? {
                        left: buttonRect.left - sectionRect.left,
                        top: buttonRect.bottom - sectionRect.top + 6,
                      } : null);
                      setRiskMenuOpen(false);
                    }}
                    className={cn(
                      'h-7 shrink-0 px-2 text-[11px]',
                      SMALL_BUTTON_BASE,
                      isSelected && 'bg-[#3A3F40]',
                    )}
                  >
                    <span className="text-white/38">{String.fromCharCode(65 + index)}</span>
                    <span className={cn('ml-1 font-semibold', leg.side === 'buy' ? 'text-[#24AE64]' : 'text-[#EF454A]')}>{leg.side === 'buy' ? '买' : '卖'}</span>
                    <span className="ml-1 text-white/55">x{leg.qty}</span>
                    <span className="ml-1 text-white/72">
                      {leg.kind === 'underlying' ? market.symbol : `${formatCompact(leg.strike ?? 0)} ${leg.type === 'call' ? 'C' : 'P'}`}
                    </span>
                    {leg.kind === 'option' && (
                      <span className="ml-1 text-white/42">{legExpiry?.label ?? `${leg.expiryDays}D`}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="relative shrink-0">
              <button
                onClick={() => {
                  setRiskMenuOpen(open => !open);
                  setLegEditorOpen(false);
                }}
                className={cn(
                  'h-7 shrink-0 px-3 text-[11px]',
                  SMALL_BUTTON_BASE,
                  riskMenuOpen && SMALL_BUTTON_ACTIVE,
                )}
                aria-expanded={riskMenuOpen}
              >
                风险预警
              </button>
              {riskMenuOpen && (
                <div className="absolute right-0 top-9 z-50 w-[390px] max-h-[520px] overflow-auto rounded-[8px] bg-[rgba(21,23,25,.96)] p-2 shadow-[0_8px_25px_rgba(0,0,0,.4)] backdrop-blur-xl">
                  {riskReviewContent}
                </div>
              )}
            </div>
          </div>
          {selectedLeg && legEditorOpen && (
            <div
              className="absolute z-40 w-[360px] rounded-[8px] bg-[rgba(21,23,25,.96)] p-2 shadow-[0_8px_25px_rgba(0,0,0,.4)] backdrop-blur-xl"
              style={legEditorAnchor
                ? { left: `min(${Math.max(8, legEditorAnchor.left)}px, calc(100% - 376px))`, top: legEditorAnchor.top }
                : { right: 16, top: 40 }}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="text-[12px] font-semibold text-white/72">腿编辑</div>
                <button
                  onClick={() => setLegEditorOpen(false)}
                  className="h-6 w-6 rounded-[5px] bg-[#2B2D35] text-[13px] text-white/48 hover:bg-[#3A3B40] hover:text-white/80"
                  aria-label="关闭腿编辑"
                >
                  ×
                </button>
              </div>
              {legEditorContent}
            </div>
          )}
        </section>

        <section className="shrink-0 border-b border-white/[0.08] bg-[#17181E] p-2">
          <div className="grid grid-cols-8 gap-1.5">
          {[
            [netPremium <= 0 ? '净收入' : '净支出', 'Premium', netPremium <= 0 ? Math.abs(netPremium) : -Math.abs(netPremium), netPremium <= 0 ? 'text-[#24AE64]' : 'text-[#EF454A]'],
            ['最大收益', '', maxProfit > 100000 ? '无限大' : maxProfit, 'text-[#24AE64]'],
            ['盈亏平衡', '', breakeven.length ? breakeven.map(value => formatCompact(value)).join(' / ') : '—', 'text-white/82'],
            ['最大亏损', '', maxLoss < -100000 ? '无限大' : maxLoss, 'text-[#EF454A]'],
            ['胜率%', '', Math.max(8, Math.min(92, 50 + greeks.theta / 8 - Math.abs(greeks.delta) * 8)), 'text-white/82'],
            ['Δ DELTA', '', greeks.delta, greeks.delta >= 0 ? 'text-[#EF454A]' : 'text-[#24AE64]'],
            ['ν VEGA', '', greeks.vega, greeks.vega >= 0 ? 'text-[#EF454A]' : 'text-[#24AE64]'],
            ['Θ THETA', '', greeks.theta, greeks.theta >= 0 ? 'text-[#24AE64]' : 'text-[#EF454A]'],
          ].map(([label, sub, value, color]) => (
            <div key={label} className="rounded-[6px] bg-[#2B2D35] px-3 py-2">
              <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
                <span className="truncate text-white/45">{label}</span>
                {sub && <span className="shrink-0 rounded-[4px] bg-[#17181E] px-1.5 py-0.5 text-[10px] text-white/34">{sub}</span>}
              </div>
              <div className={cn('mt-1 min-h-5 text-[14px] font-semibold tnum', color)}>
                {typeof value === 'number'
                  ? <AnimatedNumber value={value} format={label === '胜率%' ? v => `${v.toFixed(0)}%` : v => formatMoney(v, label === '净收入' || label === '净支出' ? 2 : label.includes('DELTA') || label.includes('VEGA') || label.includes('THETA') ? 2 : 0)} duration={0.18} />
                  : value}
              </div>
            </div>
          ))}
          </div>
        </section>

        <section className="strategy-builder-workspace shrink-0 p-2">
          <Panel
            className="strategy-analysis-panel h-[540px]"
          >
            <div className="flex h-full min-h-0 flex-col p-3">
              <div className="min-h-0 flex-1">
                {viewMode === 'table' && (
                  <TableView timeColumns={timeColumns} priceRows={priceRows} tableData={tableData} tableAbsMax={tableAbsMax} spot={spot} valueMode={valueMode} />
                )}
                {viewMode === 'curve' && (
                  <ReactECharts echarts={echarts} option={curveOption} notMerge style={{ width: '100%', height: '100%' }} opts={{ renderer: 'canvas' }} />
                )}
                {viewMode === 'greeks' && (
                  <GreeksView greeks={greeks} legs={legs} iv={iv} ivMultiplier={ivMultiplier} spot={spot} />
                )}
              </div>

              <AnalysisControls
                viewMode={viewMode}
                setViewMode={setViewMode}
                valueMode={valueMode}
                setValueMode={setValueMode}
                analysisDay={analysisDay}
                analysisDayRatio={analysisDayRatio}
                setAnalysisDayRatio={setAnalysisDayRatio}
                rangePct={rangePct}
                setRangePct={setRangePct}
                scenarioIv={scenarioIv}
                ivMultiplier={ivMultiplier}
                setIvMultiplier={setIvMultiplier}
                setAddOpen={setAddOpen}
              />
            </div>
          </Panel>
        </section>
        </div>
      </main>
    </div>
  );
}
