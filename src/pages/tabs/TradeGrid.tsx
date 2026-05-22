import React from 'react';
import { WidgetCard } from '../../components/card/WidgetCard';
import type { Coin } from '../../features/monitor/types';
import {
  PositionTrackerWidget,
  PayoffProfileWidget,
  VerticalSpreadPricerWidget,
  WatchlistWidget,
  RollCostWidget,
  StrategyPricerWidget,
} from '../../registry/widgets-trade';
import { GreeksScenarioWidget } from '../../registry/widgets-analysis';

interface TradeGridProps {
  coin: Coin;
  setCoin: (c: Coin) => void;
}

export default function TradeGrid({ coin, setCoin }: TradeGridProps) {
  return (
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
  );
}
