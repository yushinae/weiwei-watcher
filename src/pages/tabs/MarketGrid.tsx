import React from 'react';
import { WidgetCard } from '../../components/card/WidgetCard';
import type { Coin } from '../../features/monitor/types';
import {
  SpotTickerWidget,
  SentimentCompositeWidget,
  OrderbookDepthWidget,
  AlertsWidget,
  IVSignalWidget,
  ImpliedMoveWidget,
  LiveOptionsChainWidget,
  BlockTradeWidget,
  VolOverviewWidget,
  StrategyPricerWidget,
} from '../../registry/widgets-market';

interface MarketGridProps {
  coin: Coin;
  setCoin: (c: Coin) => void;
}

export default function MarketGrid({ coin, setCoin }: MarketGridProps) {
  return (
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
  );
}
