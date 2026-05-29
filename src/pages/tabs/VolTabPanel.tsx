import React from 'react';
import { WidgetCard } from '../../components/card/WidgetCard';
import type { Coin, MonitorSelection } from '../../features/monitor/types';

type SmilePoint = Omit<Extract<MonitorSelection, { type: 'smilePoint' }>, 'type' | 'coin'>;
type SkewCell   = Omit<Extract<MonitorSelection, { type: 'skewCell'   }>, 'type' | 'coin'>;
import {
  DVOLSeriesWidget,
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
} from '../../registry/tabs/vol';

interface Props {
  coin: Coin;
  setCoin: (c: Coin) => void;
  onPickSmilePoint?: (p: SmilePoint) => void;
  onPickSkewCell?: (p: SkewCell) => void;
}

export default function VolTabPanel({ coin, setCoin, onPickSmilePoint, onPickSkewCell }: Props) {
  return (
    <div className="grid grid-cols-12 gap-2">
      {/* Row 1: DVOL历史(6) + IV百分位(6) */}
      <WidgetCard title="DVOL 历史（90D）" headerDensity="compact" className="col-span-6 h-[300px]">
        <DVOLSeriesWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="IV 百分位历史（52周）" headerDensity="compact" className="col-span-6 h-[300px]">
        <IVRankHistoryWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>

      {/* Row 2: 微笑(7) + IV曲面(5) */}
      <WidgetCard title="波动率微笑" headerDensity="compact" className="col-span-7 h-[280px]">
        <VolSmileWidget coin={coin} onCoinChange={setCoin} onPickSmilePoint={onPickSmilePoint} />
      </WidgetCard>
      <WidgetCard title="IV 曲面偏斜表" headerDensity="compact" className="col-span-5 h-[280px]">
        <IVSurfaceWidget coin={coin} onCoinChange={setCoin} onPickCell={onPickSkewCell} />
      </WidgetCard>

      {/* Row 3: 偏斜(6) + VRP(6) */}
      <WidgetCard title="期权偏斜（25δ / 10δ）" headerDensity="compact" className="col-span-6 h-[260px]">
        <OptionsSkewWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="VRP 历史（30D）" headerDensity="compact" className="col-span-6 h-[260px]">
        <VRPHistoryWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>

      {/* Row 4: Vanna/Charm(6) + 波动率锥(6) */}
      <WidgetCard title="Vanna / Charm 热力图" headerDensity="compact" className="col-span-6 h-[460px]">
        <VannaCharmWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="波动率锥" headerDensity="compact" className="col-span-6 h-[460px]">
        <VolConeWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>

      {/* Row 5: RVvsIV(6) + DollarGreeks(6) */}
      <WidgetCard title="各期限 RV vs IV（VRP 分布）" headerDensity="compact" className="col-span-6 h-[200px]">
        <RVvsIVTenorWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="市场聚合 Dollar Greeks" headerDensity="compact" className="col-span-6 h-[200px]">
        <DollarGreeksWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>

      {/* Row 6: 日历价差(6) + 远期波动率(6) */}
      <WidgetCard title="ATM IV 日历价差" headerDensity="compact" className="col-span-6 h-[320px]">
        <CalendarSpreadWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="隐含远期波动率（σ_fwd）" headerDensity="compact" className="col-span-6 h-[320px]">
        <ForwardVolWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
    </div>
  );
}
