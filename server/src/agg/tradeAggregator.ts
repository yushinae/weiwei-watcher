export type Trade = {
  ts: number;
  exchange: 'bybit' | 'deribit';
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  qty: number;
};

export type TradeAgg1sRow = {
  bucket_ts: string;
  exchange: string;
  symbol: string;
  count: number;
  buy_qty: number;
  sell_qty: number;
  vwap: number | null;
  min_price: number | null;
  max_price: number | null;
};

type Bucket = {
  bucketMs: number;
  count: number;
  buyQty: number;
  sellQty: number;
  sumPxQty: number;
  sumQty: number;
  minPrice: number | null;
  maxPrice: number | null;
};

export class TradeAggregator {
  private buckets = new Map<string, Bucket>();

  add(t: Trade) {
    const bucketMs = Math.floor(t.ts / 1000) * 1000;
    const key = `${t.exchange}:${t.symbol}:${bucketMs}`;
    const b = this.buckets.get(key) ?? {
      bucketMs,
      count: 0,
      buyQty: 0,
      sellQty: 0,
      sumPxQty: 0,
      sumQty: 0,
      minPrice: null,
      maxPrice: null,
    };
    b.count += 1;
    if (t.side === 'buy') b.buyQty += t.qty;
    else b.sellQty += t.qty;
    b.sumPxQty += t.price * t.qty;
    b.sumQty += t.qty;
    b.minPrice = b.minPrice == null ? t.price : Math.min(b.minPrice, t.price);
    b.maxPrice = b.maxPrice == null ? t.price : Math.max(b.maxPrice, t.price);
    this.buckets.set(key, b);
  }

  drainBefore(nowMs: number): TradeAgg1sRow[] {
    const out: TradeAgg1sRow[] = [];
    for (const [key, b] of this.buckets) {
      if (b.bucketMs >= nowMs - 1000) continue; // keep latest second to avoid partial write
      const [exchange, symbol] = key.split(':', 2) as [string, string];
      out.push({
        bucket_ts: new Date(b.bucketMs).toISOString(),
        exchange,
        symbol,
        count: b.count,
        buy_qty: b.buyQty,
        sell_qty: b.sellQty,
        vwap: b.sumQty > 0 ? b.sumPxQty / b.sumQty : null,
        min_price: b.minPrice,
        max_price: b.maxPrice,
      });
      this.buckets.delete(key);
    }
    return out;
  }
}

