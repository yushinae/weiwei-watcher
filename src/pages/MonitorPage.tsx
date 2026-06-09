import React from 'react';
import { ElasticLayout } from '../components/ElasticLayout';
import { WidgetCard } from '../components/card/WidgetCard';
import { MonitorLayout } from '../features/monitor/components/MonitorLayout';
import { InspectorDrawer } from '../features/monitor/components/InspectorDrawer';
import { useMonitorQueryState } from '../features/monitor/hooks/useMonitorQueryState';
import { useMonitorSelection } from '../features/monitor/hooks/useMonitorSelection';
import type { MonitorSelection } from '../features/monitor/types';
import {
  OIByStrikeWidget,
  GEXWidget,
  IVSurfaceWidget,
  DVOLSeriesWidget,
  FundingRateWidget,
  FuturesBasisWidget,
  OptionsFlowWidget,
  BlockTradeWidget,
  ExpiryCalendarWidget,
  ImpliedMoveWidget,
  DollarGreeksWidget,
  TopOIWidget,
  WatchlistWidget,
  IVCheapnessWidget,
  GlobalGradDefs,
  pauseMonitorPolling,
  resumeMonitorPolling,
} from '../registry/monitorWidgets';
import { VolHeadlineWidget, VolSmileCurveWidget, VolTermWidget } from '../features/monitor/VolRead';
import { MarketHeadlineWidget, MarketSignalsWidget } from '../features/monitor/MarketRead';
import { GammaHeadlineWidget } from '../features/monitor/OIRead';
import { FlowHeadlineWidget } from '../features/monitor/FlowRead';

export default function MonitorPage() {
  const { tab, setTab, coin, setCoin } = useMonitorQueryState();
  const { selection, setSelection, clearSelection, open } = useMonitorSelection();

  const onPickSkewCell  = (p: Extract<MonitorSelection, { type: 'skewCell' }>)   => setSelection(p);

  React.useEffect(() => {
    resumeMonitorPolling();
    return () => pauseMonitorPolling();
  }, []);

  return (
    <div
      className="absolute inset-0 monitor-scope flex flex-col font-medium text-white/85"
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
                {/* ① 行情头条：在哪 + 怎么动 */}
                <WidgetCard title="实时行情" headerDensity="compact" className="col-span-12 h-[132px]">
                  <MarketHeadlineWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                {/* ② 市场信号：综合倾向 + 四读数 */}
                <WidgetCard title="市场信号" headerDensity="compact" className="col-span-12 h-[156px]">
                  <MarketSignalsWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                {/* ③ 市场定价的波动幅度 */}
                <WidgetCard title="隐含波动区间" headerDensity="compact" className="col-span-12 h-[160px]">
                  <ImpliedMoveWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                {/* ④ 大单在做什么 */}
                <WidgetCard title="大宗成交流" headerDensity="compact" className="col-span-12 h-[440px]">
                  <BlockTradeWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {/* ── 波动率 ────────────────────────────────────────────────────── */}
            {tab === 'vol' && (
              <div className="grid grid-cols-12 gap-2">
                {/* 分层阅读：① 结论条 */}
                <WidgetCard title="波动率速读" headerDensity="compact" className="col-span-12 h-[96px]">
                  <VolHeadlineWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                {/* ② 形态曲线（先看形状）*/}
                <WidgetCard title="波动率微笑（按 Δ）" headerDensity="compact" className="col-span-6 h-[300px]">
                  <VolSmileCurveWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="期限结构 + 偏斜（ATM IV · 25Δ RR）" headerDensity="compact" className="col-span-6 h-[300px]">
                  <VolTermWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                {/* ③ 明细：精确值表 + 历史时间序列 + IV 贵贱评级 */}
                <WidgetCard title="IV 曲面偏斜表（精确值）" headerDensity="compact" className="col-span-6 self-start">
                  <IVSurfaceWidget
                    coin={coin}
                    onCoinChange={setCoin}
                    onPickCell={p => onPickSkewCell({ type: 'skewCell', ...p })}
                  />
                </WidgetCard>
                <WidgetCard title="DVOL 历史（90D）" headerDensity="compact" className="col-span-6 h-[280px]">
                  <DVOLSeriesWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="波动率便宜/贵评级（IV vs 历史 RV 锥）" headerDensity="compact" className="col-span-12 h-[280px]">
                  <IVCheapnessWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {/* ── 持仓 ─────────────────────────────────────────────────────── */}
            {tab === 'oi' && (
              <div className="grid grid-cols-12 gap-2">
                {/* 分层阅读：① Gamma 速读（结论先行）*/}
                <WidgetCard title="Gamma 速读" headerDensity="compact" className="col-span-12 h-[96px]">
                  <GammaHeadlineWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="持仓分布（OI by Strike）" headerDensity="compact" className="col-span-6 h-[500px]">
                  <OIByStrikeWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="Gamma 敞口（GEX by Strike）" headerDensity="compact" className="col-span-6 h-[500px]">
                  <GEXWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="市场聚合 Dollar Greeks" headerDensity="compact" className="col-span-12 h-[124px]">
                  <DollarGreeksWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="到期日日历（OI · Max Pain · PCR）" headerDensity="compact" className="col-span-12 h-[400px]">
                  <ExpiryCalendarWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="最大持仓合约 Top 15" headerDensity="compact" className="col-span-12 h-[360px]">
                  <TopOIWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {/* ── 资金流 ────────────────────────────��───────────────────────── */}
            {tab === 'flow' && (
              <div className="grid grid-cols-12 gap-2">
                {/* 分层阅读：① 资金面速读（结论先行）*/}
                <WidgetCard title="资金面速读" headerDensity="compact" className="col-span-12 h-[96px]">
                  <FlowHeadlineWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="资金费率历史" headerDensity="compact" className="col-span-6 h-[240px]">
                  <FundingRateWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="期货基差（年化）" headerDensity="compact" className="col-span-6 h-[240px]">
                  <FuturesBasisWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="期权成交量流向（24H）" headerDensity="compact" className="col-span-12 h-[300px]">
                  <OptionsFlowWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {/* ── 交易工具 ──────────────────────────────────────────────────── */}
            {tab === 'trade' && (
              <div className="grid grid-cols-12 gap-2">
                <WidgetCard title="自选合约监控" headerDensity="compact" className="col-span-12 h-[500px]">
                  <WatchlistWidget coin={coin} onCoinChange={setCoin} />
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
