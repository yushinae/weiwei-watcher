// 轻量自定义画线层（lightweight-charts 无内置画线工具）。
// 水平线走原生 createPriceLine；趋势线/射线/斐波那契用一个共享的 Series Primitive
// 渲染——chart 在任何 pan/zoom/缩放时都会重绘 primitive，坐标由 price/timeToCoordinate
// 实时换算，故不会漂移。画线按币种持久化到 localStorage。
import type {
  ISeriesPrimitive, ISeriesPrimitivePaneView, SeriesAttachedParameter,
  IChartApi, ISeriesApi, Time, UTCTimestamp,
} from 'lightweight-charts';

export type DrawTool = 'h' | 'trend' | 'ray' | 'fib';

export type Drawing =
  | { id: string; type: 'h'; price: number }
  | { id: string; type: 'trend' | 'ray' | 'fib'; t1: number; p1: number; t2: number; p2: number };

// 在联合类型上逐成员做 Omit（直接 Omit<union> 只会保留公共字段，丢掉 price/t1…）
type DistribOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type DrawingInput = DistribOmit<Drawing, 'id'>;

export const DRAW_TOOLS: { tool: DrawTool; label: string; needs: 1 | 2 }[] = [
  { tool: 'h',     label: '水平',    needs: 1 },
  { tool: 'trend', label: '趋势线',  needs: 2 },
  { tool: 'ray',   label: '射线',    needs: 2 },
  { tool: 'fib',   label: '斐波那契', needs: 2 },
];

export const DRAW_COLOR = 'rgba(120,170,255,0.9)';
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export function newId(): string { return `d_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

export function loadDrawings(coin: string): Drawing[] {
  try {
    const raw = localStorage.getItem(`ww_drawings_${coin}`);
    return raw ? (JSON.parse(raw) as Drawing[]) : [];
  } catch { return []; }
}
export function saveDrawings(coin: string, list: Drawing[]): void {
  try { localStorage.setItem(`ww_drawings_${coin}`, JSON.stringify(list)); } catch { /* ignore */ }
}

// ── Series Primitive：趋势线 / 射线 / 斐波那契 ────────────────────────────────
type TwoPt = Extract<Drawing, { type: 'trend' | 'ray' | 'fib' }>;

// TEMP 诊断计数器（验证后移除）
const dbg = (k: string) => { const g = globalThis as unknown as Record<string, number>; g[k] = (g[k] ?? 0) + 1; };

export class TrendPrimitive implements ISeriesPrimitive<Time> {
  private chart?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;
  private readonly paneView: ISeriesPrimitivePaneView;

  constructor(private d: TwoPt) {
    dbg('primCtor');
    this.paneView = { renderer: () => ({ draw: (t: unknown) => this.draw(t) }) };
  }
  attached(p: SeriesAttachedParameter<Time>): void {
    dbg('primAttached');
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<'Candlestick'>;
  }
  detached(): void { this.chart = undefined; this.series = undefined; }
  updateAllViews(): void { /* draw() reads live coords each frame */ }
  paneViews(): readonly ISeriesPrimitivePaneView[] { return [this.paneView]; }

  private draw(target: unknown): void {
    dbg('primDraw');
    const chart = this.chart, series = this.series;
    if (!chart || !series) { dbg('primNoRef'); return; }
    const ts = chart.timeScale();
    const x1 = ts.timeToCoordinate(this.d.t1 as UTCTimestamp);
    const x2 = ts.timeToCoordinate(this.d.t2 as UTCTimestamp);
    const y1 = series.priceToCoordinate(this.d.p1);
    const y2 = series.priceToCoordinate(this.d.p2);
    if (x1 == null || x2 == null || y1 == null || y2 == null) { dbg('primNullCoord'); return; }
    dbg('primDrew');

    // useBitmapCoordinateSpace：以 bitmap 像素作图（price/timeToCoordinate 返回 media 像素，
    // 故乘 horizontal/verticalPixelRatio 换算）。这是 lightweight-charts 插件的标准画法。
    type BitmapScope = {
      context: CanvasRenderingContext2D;
      bitmapSize: { width: number; height: number };
      horizontalPixelRatio: number; verticalPixelRatio: number;
    };
    (target as { useBitmapCoordinateSpace: (cb: (s: BitmapScope) => void) => void })
      .useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        const hr = scope.horizontalPixelRatio, vr = scope.verticalPixelRatio;
        const X = (v: number) => v * hr, Y = (v: number) => v * vr;
        ctx.lineWidth = Math.max(1, Math.round(vr));
        ctx.strokeStyle = DRAW_COLOR;
        if (this.d.type === 'fib') {
          const xa = Math.min(x1, x2), xb = Math.max(x1, x2);
          ctx.font = `${Math.round(10 * vr)}px ui-monospace, monospace`;
          for (const lv of FIB_LEVELS) {
            const price = this.d.p1 + (this.d.p2 - this.d.p1) * lv;
            const y = series.priceToCoordinate(price);
            if (y == null) continue;
            ctx.globalAlpha = lv === 0 || lv === 1 ? 0.85 : 0.45;
            ctx.beginPath(); ctx.moveTo(X(xa), Y(y)); ctx.lineTo(X(xb), Y(y)); ctx.stroke();
            ctx.globalAlpha = 0.85; ctx.fillStyle = DRAW_COLOR;
            ctx.fillText(`${(lv * 100).toFixed(1)}%`, X(xb) + 4 * hr, Y(y) - 2 * vr);
          }
          ctx.globalAlpha = 1;
          return;
        }
        // trend / ray
        let ex: number = x2, ey: number = y2;
        if (this.d.type === 'ray') {
          const W = scope.bitmapSize.width / hr;
          const dx = x2 - x1, dy = y2 - y1;
          ex = dx >= 0 ? W : 0;
          ey = y1 + dy * ((ex - x1) / (dx || 1e-9));
        }
        ctx.beginPath(); ctx.moveTo(X(x1), Y(y1)); ctx.lineTo(X(ex), Y(ey)); ctx.stroke();
      });
  }
}
