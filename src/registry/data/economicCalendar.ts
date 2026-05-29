export interface EcoEvent {
  date: string;       // '06/10'
  timeET?: string;    // '08:30' Eastern Time (NY), undefined = all-day
  title: string;      // 'CPI'
  description: string;
  importance: 'high' | 'medium' | 'low';
  assetClass: 'macro' | 'crypto' | 'regulatory';
}

/** NY is EST (UTC-5) or EDT (UTC-4) depending on DST (2nd Sun Mar – 1st Sun Nov). */
export function getNYOffset(): { offset: number; label: string } {
  const now = new Date();
  const year = now.getFullYear();
  // DST starts 2nd Sunday March, ends 1st Sunday November
  const mar = new Date(year, 2, 1); // March 1
  const nov = new Date(year, 10, 1); // Nov 1
  const dstStart = new Date(year, 2, 14 - mar.getDay()); // 2nd Sunday
  const dstEnd   = new Date(year, 10, 7 - nov.getDay());  // 1st Sunday
  const isDST = now >= dstStart && now < dstEnd;
  return { offset: isDST ? -4 : -5, label: 'ET' };
}

/** Format event time 12h (AM/PM). DST offset handled internally. */
export function formatEventTime(timeET?: string): string {
  if (!timeET) return '';
  const [h, m] = timeET.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Manually maintained; update monthly or connect to an API later
export const ECO_EVENTS_2025: EcoEvent[] = [
  // June 2025
  { date: '06/10', timeET: '08:30', title: 'CPI (May)',          description: '美国 5 月消费者物价指数',                importance: 'high', assetClass: 'macro' },
  { date: '06/11', timeET: '14:00', title: 'FOMC 利率决议',      description: '美联储利率决定 + 点阵图',                 importance: 'high', assetClass: 'macro' },
  { date: '06/13', timeET: '08:30', title: 'PPI (May)',          description: '美国 5 月生产者物价指数',                importance: 'medium', assetClass: 'macro' },
  { date: '06/17', title: 'BTC 月度到期',       description: 'Deribit BTC 月度期权到期 (08:00 UTC)',     importance: 'high', assetClass: 'crypto' },
  { date: '06/19', timeET: '08:30', title: '初请失业金',         description: '美国周度失业金数据',                      importance: 'low', assetClass: 'macro' },
  { date: '06/20', title: 'Quad Witching',      description: '四巫日 — 股票/ETF/指数 期权+期货到期',   importance: 'high', assetClass: 'macro' },
  { date: '06/25', timeET: '08:30', title: 'GDP Q1 Final',       description: '美国一季度 GDP 终值',                    importance: 'medium', assetClass: 'macro' },
  { date: '06/26', title: 'ETH 月度到期',       description: 'Deribit ETH 月度期权到期 (08:00 UTC)',     importance: 'high', assetClass: 'crypto' },
  { date: '06/27', timeET: '08:30', title: 'PCE (May)',          description: '美联储偏好的通胀指标',                     importance: 'high', assetClass: 'macro' },

  // July 2025
  { date: '07/02', timeET: '10:00', title: 'ISM 制造业 PMI',     description: '美国制造业景气指数',                      importance: 'medium', assetClass: 'macro' },
  { date: '07/04', title: '美国独立日假期',     description: '美股休市，低流动性',                      importance: 'low', assetClass: 'macro' },
  { date: '07/07', timeET: '08:30', title: '非农就业 (Jun)',     description: '美国 6 月就业报告',                      importance: 'high', assetClass: 'macro' },
  { date: '07/10', timeET: '08:30', title: 'CPI (Jun)',          description: '美国 6 月消费者物价指数',                importance: 'high', assetClass: 'macro' },
  { date: '07/15', title: 'BTC 月度到期',       description: 'Deribit BTC 月度期权到期 (08:00 UTC)',     importance: 'high', assetClass: 'crypto' },
  { date: '07/16', timeET: '08:30', title: '零售销售 (Jun)',     description: '美国 6 月零售销售数据',                  importance: 'medium', assetClass: 'macro' },
  { date: '07/24', title: 'ETH 月度到期',       description: 'Deribit ETH 月度期权到期 (08:00 UTC)',     importance: 'high', assetClass: 'crypto' },
  { date: '07/25', timeET: '08:30', title: 'PCE (Jun)',          description: '美联储偏好的通胀指标',                     importance: 'high', assetClass: 'macro' },
  { date: '07/30', timeET: '14:00', title: 'FOMC 利率决议',      description: '美联储利率决定',                          importance: 'high', assetClass: 'macro' },
  { date: '07/31', timeET: '08:30', title: 'GDP Q2 Advance',     description: '美国二季度 GDP 初值',                    importance: 'medium', assetClass: 'macro' },
];

export function getUpcomingEvents(days = 30): EcoEvent[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const cutoff = new Date(now.getTime() + days * 86_400_000);

  return ECO_EVENTS_2025
    .map(e => {
      const d = new Date(`${currentYear}-${e.date.slice(0, 2)}-${e.date.slice(3, 5)}T08:00:00Z`);
      return { ...e, _date: d };
    })
    .filter(e => e._date >= now && e._date <= cutoff)
    .sort((a, b) => a._date.getTime() - b._date.getTime())
    .map(({ _date, ...e }) => e);
}

export function getImportanceColor(i: EcoEvent['importance']): string {
  if (i === 'high')   return '#FF5F57';
  if (i === 'medium') return '#FEBC2E';
  return '#64748b';
}
