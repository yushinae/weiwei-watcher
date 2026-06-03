// 每日希腊快照 → P&L 归因。每天存一条（每币净 $希腊 + 现价 + DVOL），localStorage，~70KB/年。
// 两天之间把 P&L 拆成 Δ/Γ/Vega/Theta 来源（用前一天的希腊作为当日承受的敞口），口径同 aggregate.coinScenarioPnL。
import type { CoinBook } from './aggregate';

export interface CoinSnap {
  coin: string;
  netDelta: number; netGamma: number; netVega: number; netTheta: number;
  spot: number; dvol: number;
}
export interface DaySnap { date: string; coins: CoinSnap[] }

const KEY = 'weiwei.greeksnap.v1';
const today = () => new Date().toISOString().slice(0, 10);

export function loadSnapshots(): DaySnap[] {
  try { const r = localStorage.getItem(KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function save(s: DaySnap[]): void { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

// 写入/覆盖今天这条，返回更新后的全量
export function captureSnapshot(books: CoinBook[], dvolByCoin: Record<string, number>): DaySnap[] {
  if (!books.length) return loadSnapshots();
  const snap: DaySnap = {
    date: today(),
    coins: books.map(b => ({
      coin: b.coin, netDelta: b.netDelta, netGamma: b.netGamma, netVega: b.netVega, netTheta: b.netTheta,
      spot: b.spot, dvol: dvolByCoin[b.coin] ?? 0,
    })),
  };
  const all = loadSnapshots();
  const i = all.findIndex(s => s.date === snap.date);
  if (i >= 0) all[i] = snap; else all.push(snap);
  all.sort((a, b) => (a.date < b.date ? -1 : 1));
  save(all);
  return all;
}

export interface AttribDay { date: string; delta: number; gamma: number; vega: number; theta: number; total: number }

// 相邻两天做归因（用前一天的希腊）
export function buildAttribution(snaps: DaySnap[]): AttribDay[] {
  const out: AttribDay[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1], cur = snaps[i];
    let dlt = 0, gma = 0, veg = 0, tht = 0;
    for (const pc of prev.coins) {
      const cc = cur.coins.find(c => c.coin === pc.coin);
      if (!cc) continue;
      const spotPct = pc.spot ? (cc.spot / pc.spot - 1) * 100 : 0;
      const dvolChg = cc.dvol - pc.dvol;
      dlt += pc.netDelta * (spotPct / 100);
      gma += 0.5 * pc.netGamma * (spotPct * spotPct) / 100;
      veg += pc.netVega * dvolChg;
      tht += pc.netTheta; // 1 天
    }
    out.push({ date: cur.date, delta: dlt, gamma: gma, vega: veg, theta: tht, total: dlt + gma + veg + tht });
  }
  return out;
}

// 示例（仅 1 天真实快照时演示形态）
export function sampleAttribution(): AttribDay[] {
  const out: AttribDay[] = [];
  const t = new Date();
  for (let i = 19; i >= 0; i--) {
    const d = new Date(t.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const n = Math.sin(i * 1.3) + Math.cos(i * 0.7);
    const delta = n * 1800, gamma = Math.abs(n) * 600, vega = -n * 1200, theta = 900;
    out.push({ date: d, delta, gamma, vega, theta, total: delta + gamma + vega + theta });
  }
  return out;
}
