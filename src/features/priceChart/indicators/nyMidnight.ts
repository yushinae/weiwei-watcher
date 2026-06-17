import type {
  IChartApi, IPrimitivePaneView, ISeriesPrimitive,
  SeriesAttachedParameter, Time, UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, Resolution } from '../candles';

export type NYMidnightLineStyle = 'solid' | 'dashed' | 'dotted';
export type NYMidnightLabelLang = 'zh' | 'en';

export interface NYMidnightOptions {
  lineColor: string;
  lineWidth: number;
  lineStyle: NYMidnightLineStyle;
  showLabel: boolean;
  labelLang: NYMidnightLabelLang;
  labelColor: string;
  labelHour: number;
  showDays: number;
}

export interface NYMidnightEvent {
  time: UTCTimestamp;
  line?: boolean;
  label?: string;
}

export const DEFAULT_NY_MIDNIGHT_OPTIONS: NYMidnightOptions = {
  lineColor: 'rgba(128,128,128,0.4)',
  lineWidth: 1,
  lineStyle: 'dashed',
  showLabel: true,
  labelLang: 'zh',
  labelColor: 'rgb(100,100,100)',
  labelHour: 12,
  showDays: 28,
};

const INTRADAY_RES = new Set<Resolution>(['5m', '15m', '1h', '4h']);
const CN_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const NY_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

type NYParts = { dateKey: string; hour: number; minute: number; dow: number };
// Intl.formatToParts 很慢；同一根 K 线的起始时间戳是固定的，按 ts 缓存避免每次实时帧/重算都重复解析。
const nyPartsCache = new Map<number, NYParts>();

function nyParts(ts: number): NYParts {
  const cached = nyPartsCache.get(ts);
  if (cached) return cached;
  const parts = NY_PARTS.formatToParts(new Date(ts));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '0';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const result: NYParts = {
    dateKey: `${year}-${month}-${day}`,
    hour,
    minute,
    dow: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
  if (nyPartsCache.size > 20_000) nyPartsCache.clear(); // 简单封顶，避免长会话无限增长
  nyPartsCache.set(ts, result);
  return result;
}

export function computeNYMidnightEvents(
  candles: Candle[],
  resolution: Resolution,
  options: NYMidnightOptions,
  now = Date.now(),
): NYMidnightEvent[] {
  if (!INTRADAY_RES.has(resolution)) return [];
  const since = now - options.showDays * 24 * 60 * 60 * 1000;
  const byTime = new Map<number, NYMidnightEvent>();
  const midnightAnchors: Array<{ index: number; time: UTCTimestamp; dow: number }> = [];
  let prevDateKey: string | null = null;

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    const parts = nyParts(candle.t);
    const isRecent = candle.t > since;
    const time = Math.floor(candle.t / 1000) as UTCTimestamp;

    if (prevDateKey !== null && parts.dateKey !== prevDateKey && isRecent) {
      byTime.set(time, { ...(byTime.get(time) ?? { time }), line: true });
      midnightAnchors.push({ index: i, time, dow: parts.dow });
    }

    prevDateKey = parts.dateKey;
  }

  if (options.showLabel) {
    const offsetMs = options.labelHour * 60 * 60 * 1000;
    for (const anchor of midnightAnchors) {
      const labelTarget = Number(anchor.time) * 1000 + offsetMs;
      const labelCandle = candles.slice(anchor.index).find(c => c.t >= labelTarget);
      if (!labelCandle || labelCandle.t <= since) continue;
      const time = Math.floor(labelCandle.t / 1000) as UTCTimestamp;
      const label = options.labelLang === 'zh' ? CN_DAYS[anchor.dow] : EN_DAYS[anchor.dow];
      byTime.set(time, { ...(byTime.get(time) ?? { time }), label });
    }
  }

  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

export class NYMidnightPrimitive implements ISeriesPrimitive<Time> {
  private chart?: IChartApi;
  private requestUpdate?: () => void;
  private events: NYMidnightEvent[] = [];
  private options: NYMidnightOptions = DEFAULT_NY_MIDNIGHT_OPTIONS;
  private readonly paneView: IPrimitivePaneView;

  constructor() {
    this.paneView = {
      renderer: () => ({ draw: (target: unknown) => this.draw(target) }),
      zOrder: () => 'bottom',
    };
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = undefined;
    this.requestUpdate = undefined;
  }

  updateAllViews(): void { /* draw() uses live time-scale coordinates */ }

  paneViews(): readonly IPrimitivePaneView[] { return [this.paneView]; }

  setData(events: NYMidnightEvent[], options: NYMidnightOptions): void {
    this.events = events;
    this.options = options;
    this.requestUpdate?.();
  }

  private dash(hr: number): number[] {
    if (this.options.lineStyle === 'solid') return [];
    if (this.options.lineStyle === 'dotted') return [1.5 * hr, 5 * hr];
    return [6 * hr, 6 * hr];
  }

  private draw(target: unknown): void {
    const chart = this.chart;
    if (!chart || this.events.length === 0) return;
    const timeScale = chart.timeScale();

    type BitmapScope = {
      context: CanvasRenderingContext2D;
      bitmapSize: { width: number; height: number };
      horizontalPixelRatio: number;
      verticalPixelRatio: number;
    };

    (target as { useBitmapCoordinateSpace: (cb: (s: BitmapScope) => void) => void })
      .useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        const hr = scope.horizontalPixelRatio;
        const vr = scope.verticalPixelRatio;
        const h = scope.bitmapSize.height;
        const labelY = h - 8 * vr;
        const dash = this.dash(hr);

        ctx.save();
        ctx.strokeStyle = this.options.lineColor;
        ctx.lineWidth = Math.max(1, this.options.lineWidth * vr);
        ctx.setLineDash(dash);

        for (const event of this.events) {
          if (!event.line) continue;
          const x = timeScale.timeToCoordinate(event.time);
          if (x == null) continue;
          const bx = Math.round(x * hr) + 0.5;
          ctx.beginPath();
          ctx.moveTo(bx, 0);
          ctx.lineTo(bx, h);
          ctx.stroke();
        }

        ctx.setLineDash([]);
        ctx.fillStyle = this.options.labelColor;
        ctx.font = `${Math.round(11 * vr)}px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        for (const event of this.events) {
          if (!event.label) continue;
          const x = timeScale.timeToCoordinate(event.time);
          if (x == null) continue;
          ctx.fillText(event.label, x * hr, labelY);
        }
        ctx.restore();
      });
  }
}
