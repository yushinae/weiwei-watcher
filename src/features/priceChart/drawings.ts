// 轻量自定义画线层（lightweight-charts 无内置画线工具）。
// 水平线走原生 createPriceLine；趋势线/射线/斐波那契用一个共享的 Series Primitive
// 渲染——chart 在任何 pan/zoom/缩放时都会重绘 primitive，坐标由 price/timeToCoordinate
// 实时换算，故不会漂移。画线按币种持久化到 localStorage。
import type {
  ISeriesPrimitive, IPrimitivePaneView, SeriesAttachedParameter,
  IChartApi, ISeriesApi, Time, UTCTimestamp, PrimitiveHoveredItem,
} from 'lightweight-charts';

export type DrawTool = 'h' | 'trend' | 'ray' | 'fib' | 'note';

export type Drawing =
  | { id: string; type: 'h'; price: number }
  | { id: string; type: 'trend' | 'ray' | 'fib'; t1: number; p1: number; t2: number; p2: number }
  | { id: string; type: 'note'; t: number; p: number; text: string };

// 在联合类型上逐成员做 Omit（直接 Omit<union> 只会保留公共字段，丢掉 price/t1…）
type DistribOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type DrawingInput = DistribOmit<Drawing, 'id'>;

export const DRAW_TOOLS: { tool: DrawTool; label: string; needs: 1 | 2 }[] = [
  { tool: 'h',     label: '水平',    needs: 1 },
  { tool: 'trend', label: '趋势线',  needs: 2 },
  { tool: 'ray',   label: '射线',    needs: 2 },
  { tool: 'fib',   label: '斐波那契', needs: 2 },
  { tool: 'note',  label: '标记',    needs: 1 },
];

export const DRAW_COLOR = 'rgba(120,170,255,0.9)';
export const NOTE_COLOR = '#FEBC2E';
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

export class TrendPrimitive implements ISeriesPrimitive<Time> {
  private chart?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;
  private readonly paneView: IPrimitivePaneView;

  constructor(private d: TwoPt) {
    this.paneView = { renderer: () => ({ draw: (t: unknown) => this.draw(t) }) };
  }
  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<'Candlestick'>;
  }
  detached(): void { this.chart = undefined; this.series = undefined; }
  updateAllViews(): void { /* draw() reads live coords each frame */ }
  paneViews(): readonly IPrimitivePaneView[] { return [this.paneView]; }

  private draw(target: unknown): void {
    const chart = this.chart, series = this.series;
    if (!chart || !series) return;
    const ts = chart.timeScale();
    const x1 = ts.timeToCoordinate(this.d.t1 as UTCTimestamp);
    const x2 = ts.timeToCoordinate(this.d.t2 as UTCTimestamp);
    const y1 = series.priceToCoordinate(this.d.p1);
    const y2 = series.priceToCoordinate(this.d.p2);
    if (x1 == null || x2 == null || y1 == null || y2 == null) return;

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

// ── Series Primitive：标记（pin + 文本，文本由 React 浮层展示） ────────────────
// pin 尖端钉在 (time, price) 锚点上，每帧实时换算坐标，pan/zoom 不漂移；
// 大小随 barSpacing 等比缩放（clamp 防止缩到不可点/放到糊屏）。
type NotePt = Extract<Drawing, { type: 'note' }>;

export class NotePrimitive implements ISeriesPrimitive<Time> {
  private chart?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;
  private requestUpdate?: () => void;
  private active = false;
  private readonly paneView: IPrimitivePaneView;

  constructor(readonly d: NotePt) {
    this.paneView = {
      renderer: () => ({ draw: (t: unknown) => this.draw(t) }),
      zOrder: () => 'top',
    };
  }
  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = p.requestUpdate;
  }
  detached(): void { this.chart = undefined; this.series = undefined; this.requestUpdate = undefined; }
  updateAllViews(): void { /* draw() reads live coords each frame */ }
  paneViews(): readonly IPrimitivePaneView[] { return [this.paneView]; }

  /** 展开态高亮（浮层打开时调用） */
  setActive(v: boolean): void {
    if (this.active === v) return;
    this.active = v;
    this.requestUpdate?.();
  }

  /** pin 几何（media 像素）：尖端 (x,y)=锚点，圆心在上方 */
  private geom(): { x: number; y: number; cy: number; r: number } | null {
    const chart = this.chart, series = this.series;
    if (!chart || !series) return null;
    const x = chart.timeScale().timeToCoordinate(this.d.t as UTCTimestamp);
    const y = series.priceToCoordinate(this.d.p);
    if (x == null || y == null) return null;
    const bs = chart.timeScale().options().barSpacing;
    const r = Math.min(14, Math.max(5, bs * 0.9));
    return { x, y, cy: y - r * 1.9, r };
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const g = this.geom();
    if (!g) return null;
    const pad = 3;
    if (x >= g.x - g.r - pad && x <= g.x + g.r + pad && y >= g.cy - g.r - pad && y <= g.y + pad)
      return { externalId: this.d.id, zOrder: 'top', cursorStyle: 'pointer' };
    return null;
  }

  private draw(target: unknown): void {
    const g = this.geom();
    if (!g) return;
    (target as { useMediaCoordinateSpace: (cb: (s: { context: CanvasRenderingContext2D }) => void) => void })
      .useMediaCoordinateSpace(({ context: ctx }) => {
        const { x, y, cy, r } = g;
        // 尖角（锚点指示）
        ctx.fillStyle = NOTE_COLOR;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - r * 0.6, cy + r * 0.5);
        ctx.lineTo(x + r * 0.6, cy + r * 0.5);
        ctx.closePath(); ctx.fill();
        // 圆头
        ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fill();
        // 文本行图样（表示"内有文字"）
        ctx.strokeStyle = 'rgba(0,0,0,0.62)';
        ctx.lineWidth = Math.max(1, r * 0.16);
        ctx.lineCap = 'round';
        for (const [dy, w] of [[-0.36, 0.52], [0, 0.52], [0.36, 0.3]] as const) {
          ctx.beginPath();
          ctx.moveTo(x - r * w, cy + r * dy);
          ctx.lineTo(x + r * w, cy + r * dy);
          ctx.stroke();
        }
        // 展开态高亮环
        if (this.active) {
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(x, cy, r + 2.5, 0, Math.PI * 2); ctx.stroke();
        }
      });
  }
}
