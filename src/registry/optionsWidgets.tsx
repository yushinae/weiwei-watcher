import React, { useState, useMemo } from 'react';
import { cn } from '../lib/utils';

type CoinBase = 'BTC' | 'ETH' | 'SOL' | 'AVAX' | 'XRP' | 'TRX';

const SPOT: Record<CoinBase, number> = {
  BTC: 81577, ETH: 3420, SOL: 152, AVAX: 38, XRP: 0.62, TRX: 0.14,
};
const EXPIRIES: Record<CoinBase, string[]> = {
  BTC:  ['08 MAY 26','09 MAY 26','10 MAY 26','15 MAY 26','22 MAY 26','29 MAY 26','26 JUN 26','31 JUL 26'],
  ETH:  ['08 MAY 26','09 MAY 26','10 MAY 26','15 MAY 26','22 MAY 26','29 MAY 26','26 JUN 26','31 JUL 26'],
  SOL:  ['08 MAY 26','15 MAY 26','29 MAY 26','26 JUN 26'],
  AVAX: ['08 MAY 26','15 MAY 26','29 MAY 26','26 JUN 26'],
  XRP:  ['08 MAY 26','15 MAY 26','29 MAY 26','26 JUN 26'],
  TRX:  ['08 MAY 26','15 MAY 26','29 MAY 26','26 JUN 26'],
};
const MON: Record<string, number> = {
  JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11,
};

// ── Math ──────────────────────────────────────────────────────────────────────

function seededRand(seed: number) { const x = Math.sin(seed) * 10000; return x - Math.floor(x); }

function genStrikes(coin: CoinBase): number[] {
  const S = SPOT[coin];
  const step = S > 10000 ? 500 : S > 100 ? 5 : S > 1 ? 0.05 : 0.005;
  const base = Math.round(S / step) * step;
  return Array.from({ length: 25 }, (_, i) => +(base + (i - 12) * step).toFixed(6));
}

function bsPrice(S: number, K: number, T: number, iv: number, isCall: boolean) {
  if (T <= 0) return isCall ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const t = T / 365, sigma = iv / 100;
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * t) / (sigma * Math.sqrt(t));
  const d2 = d1 - sigma * Math.sqrt(t);
  const Phi = (x: number) => {
    const a = Math.abs(x);
    const phi = (v: number) => Math.exp(-0.5 * v * v) / Math.sqrt(2 * Math.PI);
    const k = 1 / (1 + 0.2316419 * a);
    const p = phi(a) * k * (0.319381530 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
    return x >= 0 ? 1 - p : p;
  };
  if (isCall) return S * Phi(d1) - K * Math.exp(-0.02 * t) * Phi(d2);
  return K * Math.exp(-0.02 * t) * Phi(-d2) - S * Phi(-d1);
}

function buildChain(coin: CoinBase, expiry: string) {
  const S = SPOT[coin];
  const dayNum = parseInt(expiry.split(' ')[0]);
  const T = Math.max(1, dayNum - new Date().getDate());
  return genStrikes(coin).map((K, idx) => {
    const r1 = seededRand(idx * 3 + 1), r2 = seededRand(idx * 3 + 2), r3 = seededRand(idx * 3 + 3);
    const m = K / S;
    const base = coin === 'BTC' ? 58 : coin === 'ETH' ? 68 : 80;
    const callIV = Math.max(20, base + (m > 1 ? (m-1)*30 : -(1-m)*15) + (r1-0.5)*2);
    const putIV  = Math.max(20, base + (m < 1 ? (1-m)*40 : -(m-1)*10) + (r2-0.5)*2);
    const callPrice = bsPrice(S, K, T, callIV, true);
    const putPrice  = bsPrice(S, K, T, putIV, false);
    return {
      K, callIV, putIV,
      callBid: callPrice * 0.985, callAsk: callPrice * 1.015,
      putBid:  putPrice  * 0.985, putAsk:  putPrice  * 1.015,
      callOI: Math.round(r1 * 800 + 10), putOI: Math.round(r2 * 800 + 10),
      callSz: Math.round(r2 * 400 + 25), putSz: Math.round(r3 * 400 + 25),
      callItm: K < S * 0.999,
      putItm:  K > S * 1.001,
      atm:     Math.abs(K - S) / S < 0.003,
    };
  });
}
type Row = ReturnType<typeof buildChain>[number];

// ── Formatters ────────────────────────────────────────────────────────────────

function calcDTE(expiry: string): string {
  const [d, m, y] = expiry.split(' ');
  const exp = new Date(2000 + parseInt(y), MON[m], parseInt(d), 8, 0, 0);
  const diff = exp.getTime() - Date.now();
  if (diff <= 0) return '已到期';
  const h = Math.floor(diff / 3600000);
  const min = Math.floor((diff % 3600000) / 60000);
  const days = Math.floor(h / 24);
  return days > 0 ? `${days}天 ${h % 24}h` : `${h}h ${min}m`;
}

function shortExp(e: string): string {
  const [d, m] = e.split(' ');
  return `${parseInt(d)} ${m[0]}${m.slice(1).toLowerCase()}`;
}

function fmtP(v: number, coin: CoinBase): string {
  const S = SPOT[coin];
  if (S > 10000) return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(2);
  if (S > 100) return v.toFixed(2);
  if (S > 1)   return v.toFixed(4);
  return v.toFixed(5);
}

function fmtK(v: number, coin: CoinBase): string {
  const S = SPOT[coin];
  if (S > 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (S > 100)   return v.toFixed(0);
  if (S > 1)     return v.toFixed(2);
  return v.toFixed(4);
}

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg:         '#121419',
  itmBg:      '#171E2F',
  rowEven:    '#16171B',
  rowOdd:     '#1C1E22',
  rowDiv:     '#26282C',
  bandPurple: '#2D1B4E',
  bubbleBg:   '#8B45D3',
  hdrBg:      '#0F1014',
  white:      '#FFFFFF',
  greek:      '#8A92A3',
  callBid:    '#4ade80',
  putAsk:     '#f87171',
};

// ── Layout ────────────────────────────────────────────────────────────────────
const ROW_H = 32;   // strict 32px
const HDR_H = 54;   // 28 (section label) + 26 (col header)

// ── Overlay calculation ───────────────────────────────────────────────────────
// rows[0].K = smallest → top of table (y = HDR_H)
// rows[N-1].K = largest → bottom      (y = HDR_H + N*ROW_H)
function calcOverlay(rows: Row[], expiry: string, S: number) {
  const N    = rows.length;
  const minK = rows[0].K;
  const maxK = rows[N - 1].K;
  const dataH = N * ROW_H;
  const priceToY = (p: number) => HDR_H + ((p - minK) / (maxK - minK)) * dataH;

  const atmRow  = rows.find(r => r.atm) ?? rows[Math.floor(N / 2)];
  const iv      = atmRow.callIV / 100;
  const [d, mo, y] = expiry.split(' ');
  const expDate = new Date(2000 + parseInt(y), MON[mo], parseInt(d), 8, 0, 0);
  const dte     = Math.max(0.5, (expDate.getTime() - Date.now()) / 86400000);
  const move    = iv * Math.sqrt(dte / 365);

  return {
    sigmaLow:  S * Math.exp(-move),
    sigmaHigh: S * Math.exp( move),
    spotY:     priceToY(S),
  };
}

// ── Widget ────────────────────────────────────────────────────────────────────

export const OptionsChainWidget = ({
  coin: initialCoin = 'BTC',
  coinId,
}: Record<string, string>) => {
  // 兼容组件库新配置：coinId 可能是 BTC-USD / BTC-USDC 这种形式
  const baseFromId = typeof coinId === 'string' && coinId.includes('-')
    ? coinId.split('-')[0]
    : null;
  const resolvedCoin = (baseFromId ?? initialCoin) as CoinBase;
  const coin: CoinBase = (resolvedCoin as CoinBase) in SPOT ? resolvedCoin as CoinBase : 'BTC';
  const [expiry, setExpiry]       = useState(() => EXPIRIES[coin][0]);
  const [activeTab, setActiveTab] = useState<'expiry' | 'all'>('expiry');

  const rows = useMemo(() => buildChain(coin, expiry), [coin, expiry]);
  const S    = SPOT[coin];
  const ov   = useMemo(() => calcOverlay(rows, expiry, S), [rows, expiry, S]);

  const ivStats = useMemo(() => {
    const atm = rows.find(r => r.atm) ?? rows[Math.floor(rows.length / 2)];
    const lo  = rows[Math.floor(rows.length * 0.28)];
    const hi  = rows[Math.floor(rows.length * 0.72)];
    const loV = (lo.callIV - atm.callIV).toFixed(4);
    const hiV = (hi.callIV - atm.callIV).toFixed(4);
    return {
      mid: atm.callIV.toFixed(1),
      lo:  parseFloat(loV) >= 0 ? `+${loV}` : loV,
      hi:  parseFloat(hiV) >= 0 ? `+${hiV}` : hiV,
    };
  }, [rows]);

  const spotDisplay = S > 1000
    ? S.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    : S.toFixed(4);

  // ── shared td style (no background) ──
  const cell = (align: 'left' | 'right', color: string, bold = false): React.CSSProperties => ({
    padding:    '0 4px',
    height:     ROW_H,
    lineHeight: '1.2',
    textAlign:  align,
    fontFamily: 'monospace',
    fontSize:   10,
    color,
    fontWeight: bold ? 600 : 400,
    whiteSpace: 'nowrap',
    borderBottom: `1px solid ${C.rowDiv}`,
  });

  // ── row bg (calls / puts) ──
  const rowBg = (itm: boolean, i: number) =>
    itm ? C.itmBg : i % 2 === 0 ? C.rowEven : C.rowOdd;

  return (
    <div style={{ background: C.bg }} className="w-full h-full flex flex-col text-slate-200 overflow-hidden select-none">

      {/* ── Tabs + expiry pills + IV ── */}
      <div className="flex items-center h-8 shrink-0" style={{ borderBottom: `1px solid ${C.rowDiv}` }}>
        {(['到期日', '全部'] as const).map((label, i) => {
          const active = i === 0 ? activeTab === 'expiry' : activeTab === 'all';
          return (
            <button key={label}
              onClick={() => setActiveTab(i === 0 ? 'expiry' : 'all')}
              className={cn('px-3 h-full text-[10px] font-semibold border-b-2 transition-colors shrink-0',
                active ? 'border-[#7C3AED] text-[#A78BFA]'
                       : 'border-transparent text-slate-500 hover:text-slate-300')}
            >{label}</button>
          );
        })}
        <div className="w-px h-4 mx-1 shrink-0" style={{ background: C.rowDiv }} />
        <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-none px-1 min-w-0">
          {EXPIRIES[coin].map(e => (
            <button key={e} onClick={() => setExpiry(e)}
              style={{ background: e === expiry ? C.bandPurple : 'transparent' }}
              className={cn('shrink-0 px-2 py-0.5 rounded-[3px] text-[9px] font-medium transition-colors whitespace-nowrap',
                e === expiry ? 'text-[#A78BFA]' : 'text-slate-600 hover:text-slate-400')}
            >{shortExp(e)}</button>
          ))}
        </div>
        <div className="shrink-0 px-3 font-mono text-[9px] whitespace-nowrap">
          <span style={{ color: C.greek }}>IV: </span>
          <span style={{ color: C.white, fontWeight: 600 }}>{ivStats.mid}%</span>
          <span style={{ color: C.rowDiv }}> (</span>
          <span style={{ color: C.putAsk }}>{ivStats.lo}</span>
          <span style={{ color: C.rowDiv }}>, </span>
          <span style={{ color: C.callBid }}>{ivStats.hi}</span>
          <span style={{ color: C.rowDiv }}>)</span>
        </div>
      </div>

      {/* ── Spot + expiry info bar ── */}
      <div className="flex items-center gap-2 px-3 h-6 shrink-0 font-mono text-[9px]"
           style={{ borderBottom: `1px solid ${C.rowDiv}` }}>
        <span style={{ color: C.greek }}>标的:</span>
        <span style={{ color: C.white, fontWeight: 700 }}>{spotDisplay}</span>
        <span style={{ color: C.rowDiv }}>|</span>
        <span style={{ color: C.greek }}>{shortExp(expiry)} 20{expiry.split(' ')[2]}</span>
        <span style={{ color: C.rowDiv }}>|</span>
        <span style={{ color: C.greek }}>到期:</span>
        <span style={{ color: '#D1D5DB' }}>{calcDTE(expiry)}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </div>
      </div>

      {/* ── Main scrollable table area ── */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="flex min-w-max">

          {/* ══ CALLS TABLE ══ */}
          <table style={{ borderCollapse: 'collapse', fontSize: 10 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr style={{ height: 28, background: C.hdrBg }}>
                <td colSpan={4} style={{ padding: '0 0 0 8px', background: C.hdrBg }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.greek, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    看涨期权
                  </span>
                </td>
              </tr>
              <tr style={{ height: 26, background: C.hdrBg, borderBottom: `1px solid ${C.rowDiv}` }}>
                {(['未平仓量','大小','IV','买价'] as const).map(h => (
                  <th key={h} style={{ padding: '0 4px', textAlign: 'right', fontSize: 9, fontWeight: 500, color: C.greek, whiteSpace: 'nowrap', background: C.hdrBg }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const bg = rowBg(r.callItm, i);
                return (
                  <tr key={r.K} style={{ height: ROW_H, background: bg }} className="cursor-pointer group">
                    <td style={cell('right', C.greek)}>{r.callOI}</td>
                    <td style={cell('right', C.greek)}>{r.callSz}</td>
                    <td style={cell('right', C.greek)}>{r.callIV.toFixed(1)}%</td>
                    <td style={cell('right', C.callBid, true)}>{fmtP(r.callBid, coin)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* ══ STRIKE COLUMN ══
              Architecture (ref code pattern):
                outer div: position:relative → coordinate origin
                per-row div: position:relative, overflow:visible
                  sigma-band (in-range rows only):
                    position:absolute, top:-50%, bottom:-50%, z-index:0
                    gradient: transparent → #2D1B4E → transparent
                    adjacent rows' bands fuse into one continuous glowing strip
                  strike number: position:relative, z-index:1 → floats above band
                spot bubble: position:absolute, z-index:3 → top layer
                sticky header: position:sticky, z-index:10, solid bg → hides band on scroll
          ══════════════════════════════════════════════════════════════════ */}
          <div style={{ position: 'relative', flexShrink: 0, width: 80 }}>

            {/* Spot bubble — exact price coordinate, top layer */}
            <div style={{
              position:   'absolute',
              zIndex:     3,
              left:       0, right: 0,
              top:        ov.spotY,
              transform:  'translateY(-50%)',
              display:    'flex',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}>
              <div style={{
                background:   C.bubbleBg,
                borderRadius: 4,
                padding:      '2px 7px',
                whiteSpace:   'nowrap',
                boxShadow:    `0 0 12px ${C.bubbleBg}aa`,
              }}>
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 11, fontWeight: 700,
                  color: C.white, lineHeight: 1.2,
                }}>
                  {Math.round(S).toLocaleString('en-US')}
                </span>
              </div>
            </div>

            {/* Sticky header — solid bg masks any band underneath on scroll */}
            <div style={{ position: 'sticky', top: 0, zIndex: 10, background: C.hdrBg }}>
              <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${C.rowDiv}` }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: C.greek, letterSpacing: '0.08em', textTransform: 'uppercase' }}>执行价</span>
              </div>
              <div style={{ height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${C.rowDiv}` }}>
                <span style={{ fontSize: 9, fontWeight: 500, color: C.greek }}>执行价</span>
              </div>
            </div>

            {/* Strike rows — per-row sigma-band fuses into continuous strip */}
            {rows.map((r: Row) => {
              const inBand = r.K >= ov.sigmaLow && r.K <= ov.sigmaHigh;
              return (
                <div
                  key={r.K}
                  style={{
                    position:     'relative',
                    height:       ROW_H,
                    overflow:     'visible',   // allow band to bleed into adjacent rows
                    borderBottom: `1px solid ${C.rowDiv}`,
                    display:      'flex',
                    alignItems:   'center',
                    justifyContent: 'center',
                  }}
                >
                  {/* sigma-band: top:-50% bottom:-50% fuses with adjacent in-band rows */}
                  {inBand && (
                    <div style={{
                      position: 'absolute',
                      top:      '-50%',
                      bottom:   '-50%',
                      left:     0,
                      right:    0,
                      zIndex:   0,
                      pointerEvents: 'none',
                      background: `linear-gradient(to bottom,
                        transparent 0%,
                        ${C.bandPurple} 20%,
                        ${C.bandPurple} 80%,
                        transparent 100%)`,
                    }} />
                  )}

                  {/* strike number: z:1 — always floats above the band */}
                  <span style={{
                    position:           'relative',
                    zIndex:             1,
                    fontFamily:         'JetBrains Mono, monospace',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize:           14,
                    fontWeight:         600,
                    lineHeight:         '1.2',
                    color:  r.atm ? C.white : r.callItm ? '#D1D5DB' : C.greek,
                  }}>
                    {fmtK(r.K, coin)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* ══ PUTS TABLE ══ */}
          <table style={{ borderCollapse: 'collapse', fontSize: 10 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr style={{ height: 28, background: C.hdrBg }}>
                <td colSpan={4} style={{ padding: '0 8px 0 0', textAlign: 'right', background: C.hdrBg }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.greek, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    看跌期权
                  </span>
                </td>
              </tr>
              <tr style={{ height: 26, background: C.hdrBg, borderBottom: `1px solid ${C.rowDiv}` }}>
                {(['卖价','IV','大小','未平仓量'] as const).map(h => (
                  <th key={h} style={{ padding: '0 4px', textAlign: 'left', fontSize: 9, fontWeight: 500, color: C.greek, whiteSpace: 'nowrap', background: C.hdrBg }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const bg = rowBg(r.putItm, i);
                return (
                  <tr key={r.K} style={{ height: ROW_H, background: bg }} className="cursor-pointer group">
                    <td style={cell('left', C.putAsk, true)}>{fmtP(r.putAsk, coin)}</td>
                    <td style={cell('left', C.greek)}>{r.putIV.toFixed(1)}%</td>
                    <td style={cell('left', C.greek)}>{r.putSz}</td>
                    <td style={cell('left', C.greek)}>{r.putOI}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

        </div>
      </div>
    </div>
  );
};
