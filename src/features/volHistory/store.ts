// 波动率曲面历史：本地按天累积关键曲面指标的时间序列。
//
// 为什么本地累积：ATM IV 水平有 Deribit DVOL 历史，但 **25Δ 偏斜 / 期限结构斜率没有公开历史源**
// （需要逐日的全期权链快照）。所以从今天起每天存一条，越用越长。这是 snapshot smile/surface
// 缺的"趋势"维度——交易员要看的是 skew 在变陡还是变平、近月 term 有没有倒挂。

import type { DeribitData } from '../../registry/monitorWidgetsBase';

export interface VolSnapshot {
  date: string;     // yyyy-mm-dd
  coin: string;
  atmIV: number;    // 30D ATM IV (%)
  rr25: number;     // 30D 25Δ Risk Reversal (call IV − put IV)，负=看跌偏斜
  bf25: number;     // 30D 25Δ Butterfly（微笑凸度）
  termSlope: number; // 远月 ATM − 近月 ATM（≈90D − 7D），负=倒挂
}

const KEY = 'weiwei.volhist.v1';

export function loadSnapshots(): VolSnapshot[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as VolSnapshot[]) : [];
  } catch {
    return [];
  }
}

function saveSnapshots(s: VolSnapshot[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const todayStr = () => new Date().toISOString().slice(0, 10);

// 从当前期权链派生一条快照（取最接近 30D 的到期算 ATM/RR/BF，90D−7D 算期限斜率）
export function computeSnapshot(coin: string, data: DeribitData): VolSnapshot | null {
  const exp = data.expiries;
  if (!exp?.length) return null;
  const pick = (target: number) =>
    exp.reduce((best, e) => (Math.abs(e.daysToExp - target) < Math.abs(best.daysToExp - target) ? e : best));
  const m30 = pick(30);
  const near = exp.find(e => e.daysToExp >= 6) ?? exp[0];
  const far = pick(90);
  return {
    date: todayStr(),
    coin,
    atmIV: +m30.atmIV.toFixed(2),
    rr25: +m30.rr25.toFixed(2),
    bf25: +m30.bf25.toFixed(2),
    termSlope: +(far.atmIV - near.atmIV).toFixed(2),
  };
}

// 写入/覆盖今天这条（同 coin+date 取最新），返回更新后的全量序列
export function captureSnapshot(snap: VolSnapshot): VolSnapshot[] {
  const all = loadSnapshots();
  const idx = all.findIndex(s => s.coin === snap.coin && s.date === snap.date);
  if (idx >= 0) all[idx] = snap;
  else all.push(snap);
  saveSnapshots(all);
  return all;
}

export function seriesFor(all: VolSnapshot[], coin: string): VolSnapshot[] {
  return all.filter(s => s.coin === coin).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ── 示例序列（首次使用时仅 1 个真实点，无法成图；提供 30 天示例演示趋势）────────────
export function sampleSeries(coin: string): VolSnapshot[] {
  const base = coin === 'ETH' ? 68 : 55;
  const out: VolSnapshot[] = [];
  const today = new Date();
  let iv = base;
  let rr = -3.5;        // crypto 常态看跌偏斜
  let slope = 2.5;      // 常态正向期限结构
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    // 平滑随机游走（确定性伪随机，保证刷新一致）
    const n = Math.sin(i * 1.7) * 0.5 + Math.cos(i * 0.9) * 0.5;
    iv = Math.max(30, Math.min(110, iv + n * 2.2 + (base - iv) * 0.05));
    rr = Math.max(-9, Math.min(2, rr + n * 0.6));
    slope = Math.max(-4, Math.min(7, slope + n * 0.5 + (2.5 - slope) * 0.06));
    out.push({
      date: d.toISOString().slice(0, 10),
      coin,
      atmIV: +iv.toFixed(2),
      rr25: +rr.toFixed(2),
      bf25: +(2 + Math.abs(n)).toFixed(2),
      termSlope: +slope.toFixed(2),
    });
  }
  return out;
}
