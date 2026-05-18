export type Side = 'bids' | 'asks';

export type BookLevel = { price: number; size: number };

export type OrderBook = {
  symbol: string;
  ts: number;
  bids: BookLevel[]; // desc
  asks: BookLevel[]; // asc
};

function upsertLevel(levels: BookLevel[], price: number, size: number) {
  const idx = levels.findIndex((l) => l.price === price);
  if (size === 0) {
    if (idx >= 0) levels.splice(idx, 1);
    return;
  }
  if (idx >= 0) levels[idx] = { price, size };
  else levels.push({ price, size });
}

function sortSide(side: Side, levels: BookLevel[]) {
  levels.sort((a, b) => (side === 'bids' ? b.price - a.price : a.price - b.price));
}

export class OrderBookStore {
  private books = new Map<string, OrderBook>();

  get(symbol: string) {
    return this.books.get(symbol) ?? null;
  }

  symbols() {
    return [...this.books.keys()];
  }

  applySnapshot(symbol: string, ts: number, bids: [string, string][], asks: [string, string][]) {
    const book: OrderBook = {
      symbol,
      ts,
      bids: bids.map(([p, s]) => ({ price: Number(p), size: Number(s) })).filter((l) => l.size > 0),
      asks: asks.map(([p, s]) => ({ price: Number(p), size: Number(s) })).filter((l) => l.size > 0),
    };
    sortSide('bids', book.bids);
    sortSide('asks', book.asks);
    this.books.set(symbol, book);
  }

  /**
   * Bybit delta rule:
   * - size=0 删除
   * - 不存在则插入
   * - 存在则更新
   */
  applyDelta(symbol: string, ts: number, bids: [string, string][], asks: [string, string][]) {
    const book = this.books.get(symbol);
    if (!book) {
      // 没有 snapshot 时，先忽略；上层应触发 resync
      return;
    }
    for (const [p, s] of bids) upsertLevel(book.bids, Number(p), Number(s));
    for (const [p, s] of asks) upsertLevel(book.asks, Number(p), Number(s));
    sortSide('bids', book.bids);
    sortSide('asks', book.asks);
    book.ts = ts;
  }
}
