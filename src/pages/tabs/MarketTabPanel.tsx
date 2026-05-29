import React from 'react';
import { WidgetCard } from '../../components/card/WidgetCard';
import type { Coin } from '../../features/monitor/types';
import type { MonitorSelection } from '../../features/monitor/types';
import {
  SentimentCompositeWidget,
  OrderbookDepthWidget,
  AlertsWidget,
  IVSignalWidget,
  ImpliedMoveWidget,
  LiveOptionsChainWidget,
  BlockTradeWidget,
  VolOverviewWidget,
} from '../../registry/tabs/market';

interface Props {
  coin: Coin;
  setCoin: (c: Coin) => void;
}

export default function MarketTabPanel({ coin, setCoin }: Props) {
  return (
    <div className="grid grid-cols-12 gap-2">
      {/* Row 1: 综合情绪(7) + 买卖盘深度(5) */}
      <WidgetCard title="综合情绪评分" headerDensity="compact" className="col-span-7 h-[200px]">
        <SentimentCompositeWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="买卖盘深度" headerDensity="compact" className="col-span-5 h-[200px]">
        <OrderbookDepthWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>

      {/* Row 2: 警报(5) + 实时信号(7) */}
      <WidgetCard title="警报规则" headerDensity="compact" className="col-span-5 h-[160px]">
        <AlertsWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="实时信号" headerDensity="compact" className="col-span-7 h-[160px]">
        <IVSignalWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>

      {/* Row 3: 隐含波动区间(6) + 波动率概览(6) */}
      <WidgetCard title="隐含波动区间" headerDensity="compact" className="col-span-6 h-[240px]">
        <ImpliedMoveWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="波动率概览" headerDensity="compact" className="col-span-6 h-[240px]">
        <VolOverviewWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>

      {/* Row 4: 实时期权链(6) + 大宗成交流(6) */}
      <WidgetCard title="实时期权链" headerDensity="compact" className="col-span-6 h-[440px]">
        <LiveOptionsChainWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="大宗成交流" headerDensity="compact" className="col-span-6 h-[440px]">
        <BlockTradeWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
    </div>
  );
}
