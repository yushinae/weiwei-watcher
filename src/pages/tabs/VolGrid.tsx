import React from 'react';
import { WidgetCard } from '../../components/card/WidgetCard';
import type { Coin, MonitorSelection } from '../../features/monitor/types';
import {
  DVOLSeriesWidget,
  SkewHistoryWidget,
  TermStructureDriftWidget,
  VolSmileWidget,
  IVSurfaceWidget,
  OptionsSkewWidget,
  VRPHistoryWidget,
  VannaCharmWidget,
  VolConeWidget,
  IVRankHistoryWidget,
  RVvsIVTenorWidget,
  DollarGreeksWidget,
  CalendarSpreadWidget,
  ForwardVolWidget,
} from '../../registry/widgets-vol';

interface VolGridProps {
  coin: Coin;
  setCoin: (c: Coin) => void;
  onPickSmilePoint?: (p: Extract<MonitorSelection, { type: 'smilePoint' }>) => void;
  onPickSkewCell?: (p: Extract<MonitorSelection, { type: 'skewCell' }>) => void;
}

export default function VolGrid({ coin, setCoin, onPickSmilePoint, onPickSkewCell }: VolGridProps) {
  return (
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
          onPickSmilePoint={p => onPickSmilePoint?.({ type: 'smilePoint', ...p })}
        />
      </WidgetCard>
      <WidgetCard title="IV 曲面偏斜表" headerDensity="compact" className="col-span-5 self-start">
        <IVSurfaceWidget
          coin={coin}
          onCoinChange={setCoin}
          onPickCell={p => onPickSkewCell?.({ type: 'skewCell', ...p })}
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
  );
}
