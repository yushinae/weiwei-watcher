// Barrel exports — widgets are now split by tab for code-splitting
// Import shared infrastructure
export { GlobalGradDefs, useCoinControl, WidgetShell, CoinTabs, LiveBadge, Skeleton } from './ui-helpers';
export type { CoinControlProps } from './ui-helpers';
export { useDeribitOptions, useDeribitHistory } from './data-hooks';
export type { DeribitData, HistoryData, ParsedOption, ExpiryGroup } from './types';

// Market tab widgets
export {
  SpotTickerWidget, SentimentCompositeWidget, OrderbookDepthWidget,
  AlertsWidget, IVSignalWidget, ImpliedMoveWidget, LiveOptionsChainWidget,
  BlockTradeWidget, VolOverviewWidget, StrategyPricerWidget,
} from './widgets-market';

// Vol tab widgets
export {
  DVOLSeriesWidget, SkewHistoryWidget, TermStructureDriftWidget,
  VolSmileWidget, IVSurfaceWidget, OptionsSkewWidget, VRPHistoryWidget,
  VannaCharmWidget, VolConeWidget, IVRankHistoryWidget, RVvsIVTenorWidget,
  DollarGreeksWidget, CalendarSpreadWidget, ForwardVolWidget,
} from './widgets-vol';

// OI tab widgets
export {
  OIByStrikeWidget, GEXWidget, DEXWidget, KeyLevelsWidget,
  ExpiryCalendarWidget, TopOIWidget, OIDeltaWidget, GammaPinWidget,
} from './widgets-oi';

// Flow tab widgets
export {
  FundingRateWidget, FuturesBasisWidget, OptionsFlowWidget,
  FearGreedWidget, PCRHistoryWidget, PremiumFlowWidget, LargeTradeAlertWidget,
} from './widgets-flow';

// Analysis tab widgets
export {
  VolRegimeWidget, GreeksScenarioWidget, PriceTargetProbWidget,
  EWMAForecastWidget, BTCETHSpreadWidget, TenorIVHeatmapWidget,
  CorrelationWidget, IVCheapnessWidget,
} from './widgets-analysis';

// Trade tab widgets
export {
  PositionTrackerWidget, PayoffProfileWidget, VerticalSpreadPricerWidget,
  WatchlistWidget, RollCostWidget,
} from './widgets-trade';
