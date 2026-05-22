import React from 'react';
import { WidgetCard } from '../../components/card/WidgetCard';
import type { Coin } from '../../features/monitor/types';
import {
  VolRegimeWidget,
  GreeksScenarioWidget,
  PriceTargetProbWidget,
  EWMAForecastWidget,
  BTCETHSpreadWidget,
  TenorIVHeatmapWidget,
  CorrelationWidget,
  IVCheapnessWidget,
} from '../../registry/widgets-analysis';

interface AnalysisGridProps {
  coin: Coin;
  setCoin: (c: Coin) => void;
}

export default function AnalysisGrid({ coin, setCoin }: AnalysisGridProps) {
  return (
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
  );
}
