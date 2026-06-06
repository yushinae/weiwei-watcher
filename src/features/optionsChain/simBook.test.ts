import { describe, it, expect } from 'vitest';
import { fillAgainstBook, bookReducer, type BookState, type DepthBook, type PlaceArgs } from './simBook';

const book: DepthBook = {
  asks: [{ price: 100, size: 1 }, { price: 101, size: 2 }, { price: 103, size: 5 }],
  bids: [{ price: 99, size: 1 }, { price: 98, size: 2 }, { price: 96, size: 5 }],
};

const empty: BookState = { positions: [], openOrders: [], orderHistory: [], fills: [] };
const place = (a: Partial<PlaceArgs>): PlaceArgs => ({
  side: 'buy', type: 'market', symbol: 'BTC-60000-C', qty: 1, price: 100, mark: 100, delta: 0.5, ...a,
});

describe('fillAgainstBook', () => {
  it('买单单档吃满 → 均价=最优、零滑点', () => {
    const r = fillAgainstBook(book, 'buy', 1);
    expect(r.filledQty).toBe(1);
    expect(r.avgPrice).toBe(100);
    expect(r.slippagePct).toBe(0);
    expect(r.restQty).toBe(0);
  });

  it('买单扫多档 → VWAP + 正滑点', () => {
    const r = fillAgainstBook(book, 'buy', 3); // 1@100 + 2@101
    expect(r.filledQty).toBe(3);
    expect(r.avgPrice).toBeCloseTo((100 + 101 * 2) / 3, 6);
    expect(r.worstPrice).toBe(101);
    expect(r.slippagePct).toBeGreaterThan(0);
  });

  it('卖单扫 bids → 均价低于最优（对卖方更差=正滑点）', () => {
    const r = fillAgainstBook(book, 'sell', 3); // 1@99 + 2@98
    expect(r.avgPrice).toBeCloseTo((99 + 98 * 2) / 3, 6);
    expect(r.slippagePct).toBeGreaterThan(0);
  });

  it('限价买单只吃 ≤ 限价的档位 → 部分成交、剩余 restQty', () => {
    const r = fillAgainstBook(book, 'buy', 5, 101); // 只能吃 100、101 共 3 张
    expect(r.filledQty).toBe(3);
    expect(r.restQty).toBe(2);
  });

  it('空盘口 → 不成交', () => {
    const r = fillAgainstBook({ bids: [], asks: [] }, 'buy', 1);
    expect(r.filledQty).toBe(0);
    expect(r.avgPrice).toBe(0);
  });
});

describe('bookReducer + 真深度', () => {
  it('市价单吃真盘口 → 成交价=VWAP（有滑点），不是 mark', () => {
    const s = bookReducer(empty, { t: 'place', a: place({ type: 'market', qty: 3, mark: 100, book }) });
    const vwap = (100 + 101 * 2) / 3;
    expect(s.positions[0].avgEntryPrice).toBeCloseTo(vwap, 6);
    expect(s.fills[0].price).toBeCloseTo(vwap, 6);
    expect(s.fills[0].price).not.toBe(100); // 不是 mark
  });

  it('市价单无盘口 → 退回 mark（向后兼容）', () => {
    const s = bookReducer(empty, { t: 'place', a: place({ type: 'market', qty: 1, mark: 100 }) });
    expect(s.positions[0].avgEntryPrice).toBe(100);
  });

  it('限价单可成交部分立刻吃、剩余挂单', () => {
    const s = bookReducer(empty, { t: 'place', a: place({ type: 'limit', side: 'buy', qty: 5, price: 101, book }) });
    expect(s.positions[0].qty).toBe(3);          // 吃到 3 张
    expect(s.openOrders[0].qty).toBe(2);         // 剩 2 张挂着
    expect(s.fills[0].price).toBeCloseTo((100 + 101 * 2) / 3, 6);
  });

  it('限价单完全不可成交 → 整单挂出，无成交', () => {
    const s = bookReducer(empty, { t: 'place', a: place({ type: 'limit', side: 'buy', qty: 2, price: 90, book }) });
    expect(s.positions.length).toBe(0);
    expect(s.openOrders[0].qty).toBe(2);
    expect(s.fills.length).toBe(0);
  });
});
