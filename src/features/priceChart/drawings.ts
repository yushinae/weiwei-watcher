// 轻量自定义标注层。标注按币种持久化到 localStorage，历史画线对象会在加载时过滤掉。
import type {
  ISeriesPrimitive, IPrimitivePaneView, SeriesAttachedParameter,
  IChartApi, ISeriesApi, Time, UTCTimestamp, PrimitiveHoveredItem,
} from 'lightweight-charts';

export type DrawTool = 'note';

export type Drawing = { id: string; type: 'note'; t: number; p: number; text: string };
export type DrawingInput = Omit<Drawing, 'id'>;

export const DRAW_TOOLS: { tool: DrawTool; label: string; needs: 1 }[] = [
  { tool: 'note', label: '标注', needs: 1 },
];

export const NOTE_COLOR = '#FEBC2E';

export function newId(): string { return `d_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

export function loadDrawings(coin: string): Drawing[] {
  try {
    const raw = localStorage.getItem(`ww_drawings_${coin}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    return parsed.filter((d): d is Drawing =>
      typeof d === 'object' && d !== null
      && (d as Drawing).type === 'note'
      && typeof (d as Drawing).t === 'number'
      && typeof (d as Drawing).p === 'number'
      && typeof (d as Drawing).text === 'string',
    );
  } catch { return []; }
}
export function saveDrawings(coin: string, list: Drawing[]): void {
  try { localStorage.setItem(`ww_drawings_${coin}`, JSON.stringify(list)); } catch { /* ignore */ }
}

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

  setActive(v: boolean): void {
    if (this.active === v) return;
    this.active = v;
    this.requestUpdate?.();
  }

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
        ctx.fillStyle = NOTE_COLOR;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - r * 0.6, cy + r * 0.5);
        ctx.lineTo(x + r * 0.6, cy + r * 0.5);
        ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.62)';
        ctx.lineWidth = Math.max(1, r * 0.16);
        ctx.lineCap = 'round';
        for (const [dy, w] of [[-0.36, 0.52], [0, 0.52], [0.36, 0.3]] as const) {
          ctx.beginPath();
          ctx.moveTo(x - r * w, cy + r * dy);
          ctx.lineTo(x + r * w, cy + r * dy);
          ctx.stroke();
        }
        if (this.active) {
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(x, cy, r + 2.5, 0, Math.PI * 2); ctx.stroke();
        }
      });
  }
}
