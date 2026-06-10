import type {
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';

export type PriceLevel = {
  price: number;
  title: string;
  color: string;
};

export class PriceLevelsPrimitive implements ISeriesPrimitive<Time> {
  private series?: ISeriesApi<'Candlestick'>;
  private requestUpdate?: () => void;
  private levels: PriceLevel[] = [];
  private readonly paneView: IPrimitivePaneView;

  constructor() {
    this.paneView = {
      renderer: () => ({ draw: (target: unknown) => this.draw(target) }),
      zOrder: () => 'top',
    };
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.series = p.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.series = undefined;
    this.requestUpdate = undefined;
  }

  updateAllViews(): void { /* coordinates are read live from the attached series */ }

  paneViews(): readonly IPrimitivePaneView[] { return [this.paneView]; }

  setData(levels: PriceLevel[]): void {
    this.levels = levels.filter(level => level.price > 0);
    this.requestUpdate?.();
  }

  coordinate(index: number): number {
    const level = this.levels[index];
    if (!this.series || !level) return -10_000;
    return this.series.priceToCoordinate(level.price) ?? -10_000;
  }

  visible(index: number): boolean {
    return this.coordinate(index) >= 0;
  }

  level(index: number): PriceLevel | undefined {
    return this.levels[index];
  }

  private draw(target: unknown): void {
    if (!this.series || this.levels.length === 0) return;

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
        const h = 16 * vr;
        const gap = 3 * vr;
        const padX = 6 * hr;
        const right = scope.bitmapSize.width - 10 * hr;
        const items = this.levels
          .map((level, index) => {
            const y = this.coordinate(index) * vr;
            return Number.isFinite(y) && y >= 0 ? { ...level, y, labelY: y } : null;
          })
          .filter((level): level is PriceLevel & { y: number; labelY: number } => Boolean(level))
          .sort((a, b) => a.y - b.y);

        if (items.length === 0) return;

        for (let i = 1; i < items.length; i += 1) {
          items[i].labelY = Math.max(items[i].labelY, items[i - 1].labelY + h + gap);
        }
        const overflow = items[items.length - 1].labelY + h / 2 - (scope.bitmapSize.height - 3 * vr);
        if (overflow > 0) {
          for (const item of items) item.labelY -= overflow;
        }
        for (let i = items.length - 2; i >= 0; i -= 1) {
          items[i].labelY = Math.min(items[i].labelY, items[i + 1].labelY - h - gap);
        }
        for (const item of items) {
          item.labelY = Math.min(scope.bitmapSize.height - h / 2 - 3 * vr, Math.max(h / 2 + 3 * vr, item.labelY));
        }

        ctx.save();
        ctx.lineWidth = 1 * vr;
        ctx.setLineDash([2 * hr, 3 * hr]);
        for (const item of items) {
          ctx.strokeStyle = item.color;
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.moveTo(0, Math.round(item.y) + 0.5 * vr);
          ctx.lineTo(scope.bitmapSize.width, Math.round(item.y) + 0.5 * vr);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.font = `${Math.round(10 * vr)}px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        for (const item of items) {
          const textWidth = ctx.measureText(item.title).width;
          const w = Math.max(34 * hr, Math.ceil(textWidth + padX * 2));
          const x = right - w;
          const y = item.labelY - h / 2;
          ctx.fillStyle = item.color;
          ctx.beginPath();
          ctx.roundRect?.(x, y, w, h, 3 * hr);
          if (!ctx.roundRect) ctx.rect(x, y, w, h);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillText(item.title, x + w / 2, y + h / 2 + 0.5 * vr);
        }
        ctx.restore();
      });
  }
}
