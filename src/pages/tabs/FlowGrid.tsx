import React from 'react';
import { WidgetCard } from '../../components/card/WidgetCard';
import type { Coin } from '../../features/monitor/types';
import {
  FundingRateWidget,
  FuturesBasisWidget,
  OptionsFlowWidget,
  FearGreedWidget,
  PCRHistoryWidget,
  PremiumFlowWidget,
  LargeTradeAlertWidget,
} from '../../registry/widgets-flow';

interface FlowGridProps {
  coin: Coin;
  setCoin: (c: Coin) => void;
}

export default function FlowGrid({ coin, setCoin }: FlowGridProps) {
  return (
    <div className="grid grid-cols-12 gap-2">
      <WidgetCard title="资金费率历史" headerDensity="compact" className="col-span-6 h-[240px]">
        <FundingRateWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="期货基差（年化）" headerDensity="compact" className="col-span-6 h-[240px]">
        <FuturesBasisWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="期权成交量流向（24H）" headerDensity="compact" className="col-span-7 h-[300px]">
        <OptionsFlowWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="恐慌贪婪指数（30D）" headerDensity="compact" className="col-span-5 h-[300px]">
        <FearGreedWidget />
      </WidgetCard>
      <WidgetCard title="PCR 会话追踪" headerDensity="compact" className="col-span-12 h-[200px]">
        <PCRHistoryWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="净权利金流向（会话累计）" headerDensity="compact" className="col-span-12 h-[220px]">
        <PremiumFlowWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="大单警报" headerDensity="compact" className="col-span-12 h-[360px]">
        <LargeTradeAlertWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
    </div>
  );
}
