// 适配器注册表：venue → 适配器。新增交易所只需写一个适配器、在这里注册，UI 不用改。
import type { Venue, VenueAdapter } from './types';
import { hyperliquidAdapter } from './hyperliquid';
import { bybitAdapter } from './bybit';
import { deribitAdapter } from './deribit';
import { binanceAdapter } from './binance';

export const ADAPTERS: Partial<Record<Venue, VenueAdapter>> = {
  Hyperliquid: hyperliquidAdapter,
  Bybit: bybitAdapter,
  Deribit: deribitAdapter,
  Binance: binanceAdapter,
};

// 还没接入的交易所（UI 里显示为"待接入"）
export const PENDING_VENUES: Venue[] = [];
