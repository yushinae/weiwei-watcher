import React from 'react';
import { WidgetCard } from '../../components/card/WidgetCard';
import type { Coin } from '../../features/monitor/types';
import {
  VolRegimeWidget,
  GreeksScenarioWidget,
  PriceTargetProbWidget,
  EWMAForecastWidget,
  BTCETHSpreadWidget,
  CorrelationWidget,
  IVCheapnessWidget,
} from '../../registry/tabs/analysis';

interface Props {
  coin: Coin;
  setCoin: (c: Coin) => void;
}

export default function AnalysisTabPanel({ coin, setCoin }: Props) {
  return (
    <div className="grid grid-cols-12 gap-2">
      {/* Row 1: 波动率区间(6) + EWMA预测(6) */}
      <WidgetCard title="波动率区间分类" headerDensity="compact" className="col-span-6 h-[170px]">
        <VolRegimeWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="DVOL 均值回归预测（AR(1)）" headerDensity="compact" className="col-span-6 h-[170px]">
        <EWMAForecastWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>

      {/* Row 2: Straddle情景(7) + 价格概率(5) */}
      <WidgetCard title="Straddle P&L 情景矩阵" headerDensity="compact" className="col-span-7 h-[400px]">
        <GreeksScenarioWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="价格目标概率（N(d₂)）" headerDensity="compact" className="col-span-5 h-[400px]">
        <PriceTargetProbWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>

      {/* Row 3: BTC/ETH价差(6) + 相关系数(6) */}
      <WidgetCard title="BTC / ETH DVOL 价差（90D）" headerDensity="compact" className="col-span-6 h-[300px]">
        <BTCETHSpreadWidget />
      </WidgetCard>
      <WidgetCard title="BTC / ETH 相关系数（30D滚动）" headerDensity="compact" className="col-span-6 h-[300px]">
        <CorrelationWidget />
      </WidgetCard>

      {/* Row 4: IV便宜/贵评级(12) → 不拆，太宽的表格内容，但用col-start-2居中 */}
      <WidgetCard title="波动率便宜/贵评级（IV vs 历史 RV 锥）" headerDensity="compact" className="col-span-10 col-start-2 h-[360px]">
        <IVCheapnessWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
    </div>
  );
}
