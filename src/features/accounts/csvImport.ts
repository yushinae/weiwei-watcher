// 通用 CSV 导入：补齐 API 够不到的深层历史（各所网页都能导出完整历史 CSV）。
// 自动识别列名（中英文），导入前可预览。按内容生成稳定 id → 同一文件重复导入不会重复。
import type { UnifiedFill, Venue } from './types';

// ── 极简 CSV 解析（支持带引号、引号内逗号）──
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

// ── 列自动识别 ──
export type Field = 'time' | 'symbol' | 'side' | 'price' | 'qty' | 'fee' | 'pnl';
export type Mapping = Record<Field, number>; // 列索引，-1 = 未找到

const PATTERNS: Record<Field, RegExp[]> = {
  time: [/time/i, /date/i, /timestamp/i, /成交时间/, /时间/, /日期/],
  symbol: [/symbol/i, /instrument/i, /contract/i, /^coin$/i, /market/i, /合约/, /品种/, /标的/],
  side: [/side/i, /direction/i, /type/i, /方向/, /买卖/],
  price: [/price/i, /^px$/i, /成交价/, /价格/],
  qty: [/qty/i, /quantity/i, /amount/i, /^size$/i, /volume/i, /filled/i, /数量/, /成交量/, /张数/],
  fee: [/fee/i, /commission/i, /手续费/, /费用/],
  pnl: [/closed.?pnl/i, /realized.?pnl/i, /realised.?pnl/i, /\bpnl\b/i, /profit/i, /已实现/, /盈亏/, /平仓盈亏/],
};

export function detectColumns(header: string[]): Mapping {
  const m: Mapping = { time: -1, symbol: -1, side: -1, price: -1, qty: -1, fee: -1, pnl: -1 };
  (Object.keys(PATTERNS) as Field[]).forEach(f => {
    m[f] = header.findIndex(h => PATTERNS[f].some(re => re.test(h.trim())));
  });
  return m;
}

// ── 取值辅助 ──
const num = (s: string | undefined) => {
  const n = parseFloat(String(s ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function parseTime(s: string): number {
  const t = (s ?? '').trim();
  if (/^\d{13}$/.test(t)) return Number(t);            // 毫秒
  if (/^\d{10}$/.test(t)) return Number(t) * 1000;     // 秒
  const norm = t.replace(/\//g, '-');
  const d = Date.parse(norm);
  if (!Number.isNaN(d)) return d;
  const d2 = Date.parse(norm.replace(' ', 'T'));
  return Number.isNaN(d2) ? 0 : d2;
}

function coinFromSymbol(s: string): string {
  const head = (s ?? '').trim().toUpperCase().split(/[-_/]/)[0];
  return head.replace(/(USDT|USDC|USD|PERP)$/, '') || head || '—';
}

function parseSide(s: string): 'buy' | 'sell' {
  const x = (s ?? '').trim().toLowerCase();
  if (/sell|short|卖|做空|^s$|ask/.test(x)) return 'sell';
  return 'buy';
}

// ── 行 → 统一成交 ──
export function rowsToFills(dataRows: string[][], m: Mapping, venue: Venue): UnifiedFill[] {
  const out: UnifiedFill[] = [];
  for (const r of dataRows) {
    const time = m.time >= 0 ? parseTime(r[m.time]) : 0;
    if (!time) continue;
    const symbol = m.symbol >= 0 ? (r[m.symbol] ?? '') : '';
    const coin = coinFromSymbol(symbol);
    const side = m.side >= 0 ? parseSide(r[m.side]) : 'buy';
    const px = m.price >= 0 ? num(r[m.price]) : 0;
    const size = m.qty >= 0 ? num(r[m.qty]) : 0;
    const fee = m.fee >= 0 ? Math.abs(num(r[m.fee])) : 0;
    const closedPnl = m.pnl >= 0 ? num(r[m.pnl]) : 0;
    out.push({
      venue, accountId: 'csv',
      id: `csv-${venue}-${time}-${coin}-${side}-${px}-${size}-${closedPnl}`,
      coin, side, px, size, notionalUsd: px * size, time, closedPnl, fee,
      dir: `导入 ${symbol || coin}`,
    });
  }
  return out;
}

export interface CsvParsed {
  header: string[];
  dataRows: string[][];
  mapping: Mapping;
}

export function parseFile(text: string): CsvParsed {
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  return { header, dataRows: rows.slice(1), mapping: detectColumns(header) };
}
