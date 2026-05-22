import React from 'react';
import { WidgetCard } from '../../components/card/WidgetCard';
import type { Coin } from '../../features/monitor/types';
import {
  OIByStrikeWidget,
  GEXWidget,
  DEXWidget,
  KeyLevelsWidget,
  ExpiryCalendarWidget,
  TopOIWidget,
  OIDeltaWidget,
  GammaPinWidget,
} from '../../registry/widgets-oi';

interface OiGridProps {
  coin: Coin;
  setCoin: (c: Coin) => void;
}

export default function OiGrid({ coin, setCoin }: OiGridProps) {
  return (
    <div className="grid grid-cols-12 gap-2">
      <WidgetCard title="持仓分布（OI by Strike）" headerDensity="compact" className="col-span-4 h-[500px]">
        <OIByStrikeWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="Gamma 敞口（GEX by Strike）" headerDensity="compact" className="col-span-4 h-[500px]">
        <GEXWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="Delta 敞口（DEX by Strike）" headerDensity="compact" className="col-span-4 h-[500px]">
        <DEXWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="关键价位" headerDensity="compact" className="col-span-12 h-[148px]">
        <KeyLevelsWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="到期日日历（OI · Max Pain · PCR）" headerDensity="compact" className="col-span-12 h-[400px]">
        <ExpiryCalendarWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="最大持仓合约 Top 15" headerDensity="compact" className="col-span-12 h-[360px]">
        <TopOIWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="OI 会话变动（Top 20）" headerDensity="compact" className="col-span-12 h-[380px]">
        <OIDeltaWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="Gamma 钉牢候选（≤7日到期）" headerDensity="compact" className="col-span-12 h-[240px]">
        <GammaPinWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
    </div>
  );
}
