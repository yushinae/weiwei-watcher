import type { HistogramData, LineData, UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '../candles';

export type IndicatorPane = 'price' | 'volume' | 'separate';

export type IndicatorSeriesKind = 'line' | 'histogram';

export interface IndicatorSeriesOutput {
  id: string;
  kind: IndicatorSeriesKind;
  title: string;
  pane: IndicatorPane;
  color?: string;
  data: LineData<UTCTimestamp>[] | HistogramData<UTCTimestamp>[];
}

export interface IndicatorDefinition<TOptions = unknown> {
  id: string;
  name: string;
  defaultOptions: TOptions;
  compute(candles: Candle[], options: TOptions): IndicatorSeriesOutput[];
}

export function candleTime(candle: Candle): UTCTimestamp {
  return Math.floor(candle.t / 1000) as UTCTimestamp;
}
