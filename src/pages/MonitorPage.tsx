import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { ElasticLayout } from '../components/ElasticLayout';
import { WidgetCard } from '../components/card/WidgetCard';
import { MonitorHeader } from '../features/monitor/components/MonitorHeader';
import { MonitorLayout } from '../features/monitor/components/MonitorLayout';
import { InspectorDrawer } from '../features/monitor/components/InspectorDrawer';
import { useMonitorQueryState } from '../features/monitor/hooks/useMonitorQueryState';
import { useMonitorSelection } from '../features/monitor/hooks/useMonitorSelection';
import type { MonitorSelection } from '../features/monitor/types';
import {
  FixedTenorWidget,
  IVRankHistoryWidget,
  IVSurfaceWidget,
  ImpliedDistWidget,
  OptionsSkewWidget,
  PolymarketWidget,
  VRPHistoryWidget,
  VolConeWidget,
  VolOverviewWidget,
  VolSmileWidget,
} from '../registry/monitorWidgets';

export default function MonitorPage() {
  const navigate = useNavigate();
  const { tab, setTab, coin, setCoin, range, setRange, tenor, setTenor } = useMonitorQueryState();
  const { selection, setSelection, clearSelection, open } = useMonitorSelection();

  const onPickSmilePoint = (p: Extract<MonitorSelection, { type: 'smilePoint' }>) => {
    setSelection(p);
  };

  const onPickSkewCell = (p: Extract<MonitorSelection, { type: 'skewCell' }>) => {
    setSelection(p);
  };

  return (
    <div className="absolute inset-0 monitor-scope flex flex-col text-slate-200" style={{ background: 'rgba(0,0,0,0.35)' }}>
      <MonitorHeader
        coin={coin}
        range={range}
        tenor={tenor}
        onCoinChange={setCoin}
        onRangeChange={setRange}
        onTenorChange={setTenor}
      />

      <MonitorLayout tab={tab} onTabChange={setTab}>
        <ElasticLayout className="h-full">
          <div className="p-4">
            {tab === 'overview' && (
              <div className="grid grid-cols-12 gap-3">
                <WidgetCard title="波动率概览" headerDensity="compact" className="col-span-7 h-[360px]">
                  <VolOverviewWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="市场预测（Polymarket）" headerDensity="compact" className="col-span-5 h-[360px]">
                  <PolymarketWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {tab === 'surface' && (
              <div className="grid grid-cols-12 gap-3">
                <WidgetCard title="波动率微笑（点击点可钻取）" headerDensity="compact" className="col-span-6 h-[340px]">
                  <VolSmileWidget
                    coin={coin}
                    onCoinChange={setCoin}
                    onPickSmilePoint={(p) => onPickSmilePoint({ type: 'smilePoint', ...p })}
                  />
                </WidgetCard>
                <WidgetCard title="IV 曲面偏斜表（点击单元可钻取）" headerDensity="compact" className="col-span-6 h-[340px]">
                  <IVSurfaceWidget
                    coin={coin}
                    onCoinChange={setCoin}
                    onPickCell={(p) => onPickSkewCell({ type: 'skewCell', ...p })}
                  />
                </WidgetCard>
                <WidgetCard title="期权偏斜（25δ / 10δ）" headerDensity="compact" className="col-span-12 h-[260px]">
                  <OptionsSkewWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {tab === 'history' && (
              <div className="grid grid-cols-12 gap-3">
                <WidgetCard title="VRP 历史（30D）" headerDensity="compact" className="col-span-6 h-[300px]">
                  <VRPHistoryWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="IV 百分位历史（90D）" headerDensity="compact" className="col-span-6 h-[300px]">
                  <IVRankHistoryWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="波动率锥" headerDensity="compact" className="col-span-12 h-[280px]">
                  <VolConeWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {tab === 'distribution' && (
              <div className="grid grid-cols-12 gap-3">
                <WidgetCard title="固定期限方差分布" headerDensity="compact" className="col-span-6 h-[300px]">
                  <FixedTenorWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="隐含分布图（30D）" headerDensity="compact" className="col-span-6 h-[300px]">
                  <ImpliedDistWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {tab === 'greeks' && (
              <div className="grid grid-cols-12 gap-3">
                <WidgetCard
                  title="Greeks Heatmap"
                  headerDensity="compact"
                  className="col-span-12 h-[260px]"
                  subtitle={<span className="text-[10px] text-text-muted">待接入（本次先统一卡片体系）</span>}
                >
                  <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                    预留区域：后续可将现有 heatmap 迁入 feature/widgets 并接入虚拟化/选择态。
                  </div>
                </WidgetCard>
              </div>
            )}

            {tab === 'chain' && (
              <div className="grid grid-cols-12 gap-3">
                <WidgetCard
                  title="期权链（跳转到独立页面）"
                  headerDensity="compact"
                  className="col-span-12 h-[420px]"
                  actions={[
                    {
                      id: 'open-chain',
                      icon: ArrowUpRight,
                      label: '打开期权链',
                      onClick: () => navigate(`/options-chain?coin=${encodeURIComponent(coin === 'BTC' ? 'BTC-USD' : 'ETH-USD')}`),
                    },
                  ]}
                >
                  <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                    请使用 WebSocket 实时数据源，查看完整期权链 →
                  </div>
                </WidgetCard>
              </div>
            )}

            {tab === 'polymarket' && (
              <div className="grid grid-cols-12 gap-3">
                <WidgetCard title="市场预测（Polymarket）" headerDensity="compact" className="col-span-12 h-[420px]">
                  <PolymarketWidget coin={coin} onCoinChange={setCoin} />
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
