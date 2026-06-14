// Shared types for the position builder / stress tester.

export interface Leg {
  id: number;
  side: 1 | -1;
  type: 'call' | 'put';
  K: number;
  qty: number;
  hoursToExpiry: number;
  entryPremium: number;
  // real-market fields
  expiryTs?: number;       // ms timestamp from Deribit
  legIv?: number;          // per-leg implied vol (decimal)
  instrumentName?: string; // e.g. "BTC-27DEC24-70000-C"
  fetchingTicker?: boolean;
  bid?: number;            // best_bid × underlying_price (USDT)
  ask?: number;            // best_ask × underlying_price (USDT)
}

export interface DeribitInstrument {
  instrument_name: string;
  strike: number;
  option_type: 'call' | 'put';
  expiration_timestamp: number;
}

export type ExpiryGroup = {
  ts: number;
  deribitLabel: string;   // "27DEC24"
  displayLabel: string;   // "27 Dec 24"
  callByStrike: Map<number, string>;
  putByStrike: Map<number, string>;
  strikes: number[];
};

export type RightTab = 'chart' | 'scenario' | 'greeks' | 'risk' | 'structure';
