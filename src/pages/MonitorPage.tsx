import React from 'react';
import { ElasticLayout } from '../components/ElasticLayout';
import { WidgetCard } from '../components/card/WidgetCard';
import { MonitorLayout } from '../features/monitor/components/MonitorLayout';
import { InspectorDrawer } from '../features/monitor/components/InspectorDrawer';
import { useMonitorQueryState } from '../features/monitor/hooks/useMonitorQueryState';
import { useMonitorSelection } from '../features/monitor/hooks/useMonitorSelection';
import type { MonitorSelection } from '../features/monitor/types';
import {
  LiveOptionsChainWidget,
  OIByStrikeWidget,
  GEXWidget,
  OptionsSkewWidget,
  IVSurfaceWidget,
  VolSmileWidget,
  VRPHistoryWidget,
  IVRankHistoryWidget,
  VolConeWidget,
  VolOverviewWidget,
  DVOLSeriesWidget,
  FundingRateWidget,
  FuturesBasisWidget,
  OptionsFlowWidget,
  FearGreedWidget,
  BlockTradeWidget,
  SkewHistoryWidget,
  VannaCharmWidget,
  IVSignalWidget,
  ExpiryCalendarWidget,
  DEXWidget,
  KeyLevelsWidget,
  PCRHistoryWidget,
  ImpliedMoveWidget,
  DollarGreeksWidget,
  RVvsIVTenorWidget,
  TopOIWidget,
  TermStructureDriftWidget,
  StrategyPricerWidget,
  BTCETHSpreadWidget,
  VolRegimeWidget,
  PriceTargetProbWidget,
  EWMAForecastWidget,
  TenorIVHeatmapWidget,
  SpotTickerWidget,
  OIDeltaWidget,
  GreeksScenarioWidget,
  PremiumFlowWidget,
  LargeTradeAlertWidget,
  CalendarSpreadWidget,
  ForwardVolWidget,
  GammaPinWidget,
  CorrelationWidget,
  WatchlistWidget,
  RollCostWidget,
  SentimentCompositeWidget,
  OrderbookDepthWidget,
  PositionTrackerWidget,
  AlertsWidget,
  PayoffProfileWidget,
  IVCheapnessWidget,
  VerticalSpreadPricerWidget,
  GlobalGradDefs,
} from '../registry/monitorWidgets';

export default function MonitorPage() {
  const { tab, setTab, coin, setCoin } = useMonitorQueryState();
  const { selection, setSelection, clearSelection, open } = useMonitorSelection();

  const onPickSmilePoint = (p: Extract<MonitorSelection, { type: 'smilePoint' }>) => setSelection(p);
  const onPickSkewCell  = (p: Extract<MonitorSelection, { type: 'skewCell' }>)   => setSelection(p);

  return (
    <div
      className="absolute inset-0 monitor-scope flex flex-col text-slate-200"
    >
      {/* Global SVG gradient defs — referenced by all inline chart SVGs */}
      <GlobalGradDefs />
      <MonitorLayout
        tab={tab} onTabChange={setTab}
        coin={coin} onCoinChange={setCoin}
      >
        <ElasticLayout className="h-full">
          <div className="px-3 pt-2 pb-4 flex flex-col gap-2">

            {/* ── 行情 ─────────────────────────────────────────────────────── */}
            {tab === 'market' && (
              <div className="grid grid-cols-12 gap-2">
                <WidgetCard title="实时行情" headerDensity="compact" className="col-span-12 h-[90px]">
                  <SpotTickerWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="综合情绪评分" headerDensity="compact" className="col-span-7 h-[130px]">
                  <SentimentCompositeWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="买卖盘深度" headerDensity="compact" className="col-span-3 h-[130px]">
                  <OrderbookDepthWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="警报规则" headerDensity="compact" className="col-span-2 h-[130px]">
                  <AlertsWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="实时信号" headerDensity="compact" className="col-span-12 h-[116px]">
                  <IVSignalWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="隐含波动区间" headerDensity="compact" className="col-span-12 h-[106px]">
                  <ImpliedMoveWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="实时期权链" headerDensity="compact" className="col-span-5 h-[440px]">
                  <LiveOptionsChainWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="大宗成交流" headerDensity="compact" className="col-span-4 h-[440px]">
                  <BlockTradeWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="波动率期限结构" headerDensity="compact" className="col-span-3 h-[440px]">
                  <VolOverviewWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="策略快速定价（Straddle · Strangle · BE）" headerDensity="compact" className="col-span-12 h-[220px]">
                  <StrategyPricerWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {/* ── 波动率 ────────────────────────────────────────────────────── */}
            {tab === 'vol' && (
              <div className="grid grid-cols-12 gap-2">
                <WidgetCard title="DVOL 历史（90D）" headerDensity="compact" className="col-span-5 h-[210px]">
                  <DVOLSeriesWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="Skew 追踪（会话内）" headerDensity="compact" className="col-span-5 h-[210px]">
                  <SkewHistoryWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="期限结构漂移（会话内）" headerDensity="compact" className="col-span-2 h-[210px]">
                  <TermStructureDriftWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="波动率微笑" headerDensity="compact" className="col-span-7 h-[300px]">
                  <VolSmileWidget
                    coin={coin}
                    onCoinChange={setCoin}
                    onPickSmilePoint={p => onPickSmilePoint({ type: 'smilePoint', ...p })}
                  />
                </WidgetCard>
                <WidgetCard title="IV 曲面偏斜表" headerDensity="compact" className="col-span-5 self-start">
                  <IVSurfaceWidget
                    coin={coin}
                    onCoinChange={setCoin}
                    onPickCell={p => onPickSkewCell({ type: 'skewCell', ...p })}
                  />
                </WidgetCard>
                <WidgetCard title="期权偏斜（25δ / 10δ）" headerDensity="compact" className="col-span-6 h-[240px]">
                  <OptionsSkewWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="VRP 历史（30D）" headerDensity="compact" className="col-span-6 h-[240px]">
                  <VRPHistoryWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="Vanna / Charm 热力图" headerDensity="compact" className="col-span-7 h-[320px]">
                  <VannaCharmWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="波动率锥" headerDensity="compact" className="col-span-5 h-[320px]">
                  <VolConeWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="IV 百分位历史（52周）" headerDensity="compact" className="col-span-12 h-[200px]">
                  <IVRankHistoryWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="各期限 RV vs IV（VRP 分布）" headerDensity="compact" className="col-span-8 h-[240px]">
                  <RVvsIVTenorWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="市场聚合 Dollar Greeks" headerDensity="compact" className="col-span-4 h-[240px]">
                  <DollarGreeksWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="ATM IV 日历价差" headerDensity="compact" className="col-span-6 h-[280px]">
                  <CalendarSpreadWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="隐含远期波动率（σ_fwd）" headerDensity="compact" className="col-span-6 h-[280px]">
                  <ForwardVolWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {/* ── 持仓 ─────────────────────────────────────────────────────── */}
            {tab === 'oi' && (
              <div className="grid grid-cols-12 gap-2">
                <WidgetCard title="持仓分布（OI by Strike）" headerDensity="compact" className="col-span-4 h-[500px]">
                  <OIByStrikeWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="Gamma 敞口（GEX by Strike）" headerDensity="compact" className="col-span-4 h-[500px]">
                  <GEXWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="Delta 敞口（DEX by Strike）" headerDensity="compact" className="col-span-4 h-[500px]">
                  <DEXWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="关键价位" headerDensity="compact" className="col-span-12 h-[148px]">
                  <KeyLevelsWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="到期日日历（OI · Max Pain · PCR）" headerDensity="compact" className="col-span-12 h-[400px]">
                  <ExpiryCalendarWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="最大持仓合约 Top 15" headerDensity="compact" className="col-span-12 h-[360px]">
                  <TopOIWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="OI 会话变动（Top 20）" headerDensity="compact" className="col-span-12 h-[380px]">
                  <OIDeltaWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="Gamma 钉牢候选（≤7日到期）" headerDensity="compact" className="col-span-12 h-[240px]">
                  <GammaPinWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {/* ── 资金流 ────────────────────────────────────────────────────── */}
            {tab === 'flow' && (
              <div className="grid grid-cols-12 gap-2">
                <WidgetCard title="资金费率历史" headerDensity="compact" className="col-span-6 h-[240px]">
                  <FundingRateWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="期货基差（年化）" headerDensity="compact" className="col-span-6 h-[240px]">
                  <FuturesBasisWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="期权成交量流向（24H）" headerDensity="compact" className="col-span-7 h-[300px]">
                  <OptionsFlowWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="恐慌贪婪指数（30D）" headerDensity="compact" className="col-span-5 h-[300px]">
                  <FearGreedWidget />
                </WidgetCard>
                <WidgetCard title="PCR 会话追踪" headerDensity="compact" className="col-span-12 h-[200px]">
                  <PCRHistoryWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="净权利金流向（会话累计）" headerDensity="compact" className="col-span-12 h-[220px]">
                  <PremiumFlowWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="大单警报" headerDensity="compact" className="col-span-12 h-[360px]">
                  <LargeTradeAlertWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {/* ── 分析 ─────────────────────────────────────────────────────── */}
            {tab === 'analysis' && (
              <div className="grid grid-cols-12 gap-2">
                <WidgetCard title="波动率区间分类" headerDensity="compact" className="col-span-12 h-[200px]">
                  <VolRegimeWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="Straddle P&L 情景矩阵（Spot × IV）" headerDensity="compact" className="col-span-12 h-[380px]">
                  <GreeksScenarioWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="价格目标概率（N(d₂)）" headerDensity="compact" className="col-span-7 h-[380px]">
                  <PriceTargetProbWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="DVOL 均值回归预测（AR(1)）" headerDensity="compact" className="col-span-5 h-[380px]">
                  <EWMAForecastWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="BTC / ETH DVOL 价差（90D）" headerDensity="compact" className="col-span-12 h-[300px]">
                  <BTCETHSpreadWidget />
                </WidgetCard>
                <WidgetCard title="会话 IV 曲面热力图（期限 × 时间）" headerDensity="compact" className="col-span-12 h-[240px]">
                  <TenorIVHeatmapWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="BTC / ETH 已实现相关系数（30日滚动）" headerDensity="compact" className="col-span-12 h-[200px]">
                  <CorrelationWidget />
                </WidgetCard>
                <WidgetCard title="波动率便宜/贵评级（IV vs 历史 RV 锥）" headerDensity="compact" className="col-span-12 h-[280px]">
                  <IVCheapnessWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {/* ── 交易工具 ──────────────────────────────────────────────────── */}
            {tab === 'trade' && (
              <div className="grid grid-cols-12 gap-2">
                <WidgetCard title="持仓追踪（实时 Greeks + P&L）" headerDensity="compact" className="col-span-12 h-[400px]">
                  <PositionTrackerWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="到期日 P&L 曲线" headerDensity="compact" className="col-span-12 h-[260px]">
                  <PayoffProfileWidget />
                </WidgetCard>
                <WidgetCard title="垂直价差定价器" headerDensity="compact" className="col-span-12 h-[360px]">
                  <VerticalSpreadPricerWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="自选合约监控" headerDensity="compact" className="col-span-5 h-[500px]">
                  <WatchlistWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="展期成本（ATM Straddle Roll）" headerDensity="compact" className="col-span-7 h-[280px]">
                  <RollCostWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="策略快速定价（Straddle · Strangle · BE）" headerDensity="compact" className="col-span-7 h-[220px]">
                  <StrategyPricerWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="Straddle P&L 情景矩阵（Spot × IV）" headerDensity="compact" className="col-span-12 h-[380px]">
                  <GreeksScenarioWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

          </div>
        </ElasticLayout>
      </MonitorLayout>

      <InspectorDrawer open={open} selection={selection} onClose={clearSelection} />
    </div>
  );
}
