import React from 'react';
import { WidgetCard } from '../../components/card/WidgetCard';
import type { Coin } from '../../features/monitor/types';
import {
  FundingRateWidget,
  FuturesBasisWidget,
  OptionsFlowWidget,
  FearGreedWidget,
  LargeTradeAlertWidget,
} from '../../registry/tabs/flow';

interface Props {
  coin: Coin;
  setCoin: (c: Coin) => void;
}

export default function FlowTabPanel({ coin, setCoin }: Props) {
  return (
    <div className="grid grid-cols-12 gap-2">
      {/* Row 1: 资金费率(4) + 期货基差(4) + 恐慌贪婪(4) */}
      <WidgetCard title="资金费率历史" headerDensity="compact" className="col-span-4 h-[280px]">
        <FundingRateWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="期货基差（年化）" headerDensity="compact" className="col-span-4 h-[280px]">
        <FuturesBasisWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="恐慌贪婪指数（30D）" headerDensity="compact" className="col-span-4 h-[280px]">
        <FearGreedWidget />
      </WidgetCard>

      {/* Row 2: 成交量流向(7) + 大单警报(5) */}
      <WidgetCard title="期权成交量流向（24H）" headerDensity="compact" className="col-span-7 h-[340px]">
        <OptionsFlowWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="大单警报" headerDensity="compact" className="col-span-5 h-[340px]">
        <LargeTradeAlertWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
    </div>
  );
}
