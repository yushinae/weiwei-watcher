export type OptionTicker = {
  symbol: string;
  ts: number;
  bid?: number;
  ask?: number;
  last?: number;
  mark?: number;
  index?: number;
  iv?: number; // mark iv
  delta?: number;
  gamma?: number;
  vega?: number;
  theta?: number;
  oi?: number;
  volume?: number;
};

export class TickerStore {
  private map = new Map<string, OptionTicker>();

  set(t: OptionTicker) {
    this.map.set(t.symbol, t);
  }

  get(symbol: string) {
    return this.map.get(symbol) ?? null;
  }

  values() {
    return [...this.map.values()];
  }
}

