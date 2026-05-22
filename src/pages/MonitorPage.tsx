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
} from '../registry/monitorWidgets';

export default function MonitorPage() {
  const { tab, setTab, coin, setCoin } = useMonitorQueryState();
  const { selection, setSelection, clearSelection, open } = useMonitorSelection();

  const onPickSmilePoint = (p: Extract<MonitorSelection, { type: 'smilePoint' }>) => setSelection(p);
  const onPickSkewCell  = (p: Extract<MonitorSelection, { type: 'skewCell' }>)   => setSelection(p);

  return (
    <div
      className="absolute inset-0 monitor-scope flex flex-col text-slate-200"
      style={{ backdropFilter: 'blur(30px) saturate(1.6)', WebkitBackdropFilter: 'blur(30px) saturate(1.6)' }}
    >
      <MonitorLayout
        tab={tab} onTabChange={setTab}
        coin={coin} onCoinChange={setCoin}
      >
        <ElasticLayout className="h-full">
          <div className="px-3 pt-2 pb-4 flex flex-col gap-2">

            {/* ── 行情 ─────────────────────────────────────────────────────── */}
            {tab === 'market' && (
              <div className="grid grid-cols-12 gap-2">
                <WidgetCard title="实时期权链" headerDensity="compact" className="col-span-8 h-[520px]">
                  <LiveOptionsChainWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="波动率期限结构" headerDensity="compact" className="col-span-4 h-[520px]">
                  <VolOverviewWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {/* ── 波动率 ────────────────────────────────────────────────────── */}
            {tab === 'vol' && (
              <div className="grid grid-cols-12 gap-2">
                <WidgetCard title="DVOL 历史（90D）" headerDensity="compact" className="col-span-12 h-[220px]">
                  <DVOLSeriesWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="波动率微笑" headerDensity="compact" className="col-span-7 h-[320px]">
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
                <WidgetCard title="期权偏斜（25δ / 10δ）" headerDensity="compact" className="col-span-6 h-[260px]">
                  <OptionsSkewWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="VRP 历史（30D）" headerDensity="compact" className="col-span-6 h-[260px]">
                  <VRPHistoryWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="波动率锥" headerDensity="compact" className="col-span-6 h-[240px]">
                  <VolConeWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="IV 百分位历史（52周）" headerDensity="compact" className="col-span-6 h-[240px]">
                  <IVRankHistoryWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {/* ── 持仓 ─────────────────────────────────────────────────────── */}
            {tab === 'oi' && (
              <div className="grid grid-cols-12 gap-2">
                <WidgetCard title="持仓分布（OI by Strike）" headerDensity="compact" className="col-span-6 h-[580px]">
                  <OIByStrikeWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="Gamma 敞口（GEX by Strike）" headerDensity="compact" className="col-span-6 h-[580px]">
                  <GEXWidget coin={coin} onCoinChange={setCoin} />
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
                <WidgetCard title="期权成交量流向（24H）" headerDensity="compact" className="col-span-7 h-[320px]">
                  <OptionsFlowWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="恐慌贪婪指数（30D）" headerDensity="compact" className="col-span-5 h-[320px]">
                  <FearGreedWidget />
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
