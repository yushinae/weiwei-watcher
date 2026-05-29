// ═══════════════════════════════════════════════════════════════════════════════
// In-app handoff: stage a set of legs from somewhere else (e.g. the Bybit
// positions view) and have PositionBuilder consume them on its next mount.
//
// Why a module variable instead of router state? Router state survives reloads
// — it would cause "import again every time the user refreshes". A module
// variable is consumed once and gone, which is the right semantics.
// ═══════════════════════════════════════════════════════════════════════════════

export interface ImportLeg {
  side: 1 | -1;
  type: 'call' | 'put';
  K: number;
  qty: number;
  hoursToExpiry: number;
  entryPremium: number;
  expiryTs?: number;
}

export interface PendingImport {
  symbol: 'BTC' | 'ETH' | 'SOL';
  legs: ImportLeg[];
  /** Where the legs came from — surfaced in the UI banner so user knows. */
  source: string;
}

let _pending: PendingImport | null = null;

export function stageImport(p: PendingImport): void { _pending = p; }

export function consumeImport(): PendingImport | null {
  const p = _pending;
  _pending = null;
  return p;
}
