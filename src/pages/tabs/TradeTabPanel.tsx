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
} from '../../registry/tabs/trade';

interface Props {
  coin: Coin;
  setCoin: (c: Coin) => void;
}

export default function TradeTabPanel({ coin, setCoin }: Props) {
  return (
    <div className="grid grid-cols-12 gap-2">
      {/* Row 1: 持仓追踪(7) + 展期成本(5) */}
      <WidgetCard title="持仓追踪（实时 Greeks + P&L）" headerDensity="compact" className="col-span-7 h-[420px]">
        <PositionTrackerWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="展期成本（ATM Straddle Roll）" headerDensity="compact" className="col-span-5 h-[420px]">
        <RollCostWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>

      {/* Row 2: 到期日P&L(6) + 自选监控(6) */}
      <WidgetCard title="到期日 P&L 曲线" headerDensity="compact" className="col-span-6 h-[300px]">
        <PayoffProfileWidget />
      </WidgetCard>
      <WidgetCard title="自选合约监控" headerDensity="compact" className="col-span-6 h-[300px]">
        <WatchlistWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>

      {/* Row 3: 垂直价差(6) + 策略定价(6) */}
      <WidgetCard title="垂直价差定价器" headerDensity="compact" className="col-span-6 h-[400px]">
        <VerticalSpreadPricerWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="策略快速定价（Straddle · Strangle · BE）" headerDensity="compact" className="col-span-6 h-[400px]">
        <StrategyPricerWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
    </div>
  );
}
