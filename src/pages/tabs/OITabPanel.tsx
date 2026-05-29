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
  GammaPinWidget,
} from '../../registry/tabs/oi';

interface Props {
  coin: Coin;
  setCoin: (c: Coin) => void;
}

export default function OITabPanel({ coin, setCoin }: Props) {
  return (
    <div className="grid grid-cols-12 gap-2">
      {/* Row 1: OI(4) + GEX(4) + DEX(4) — 三栏等宽 */}
      <WidgetCard title="持仓分布（OI by Strike）" headerDensity="compact" className="col-span-4 h-[520px]">
        <OIByStrikeWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="Gamma 敞口（GEX by Strike）" headerDensity="compact" className="col-span-4 h-[520px]">
        <GEXWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="Delta 敞口（DEX by Strike）" headerDensity="compact" className="col-span-4 h-[520px]">
        <DEXWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>

      {/* Row 2: 关键价位(6) + Gamma钉牢(6) */}
      <WidgetCard title="关键价位" headerDensity="compact" className="col-span-6 h-[180px]">
        <KeyLevelsWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="Gamma 钉牢候选（≤14D）" headerDensity="compact" className="col-span-6 h-[180px]">
        <GammaPinWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>

      {/* Row 3: 到期日历(7) + Top OI(5) */}
      <WidgetCard title="到期日日历（OI · Max Pain · PCR）" headerDensity="compact" className="col-span-7 h-[420px]">
        <ExpiryCalendarWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
      <WidgetCard title="最大持仓合约 Top 15" headerDensity="compact" className="col-span-5 h-[420px]">
        <TopOIWidget coin={coin} onCoinChange={setCoin} />
      </WidgetCard>
    </div>
  );
}
