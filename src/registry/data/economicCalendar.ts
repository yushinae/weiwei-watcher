export interface EcoEvent {
  date: string;       // 'YYYY-MM-DD'（真实日期，含年份 — 禁止把往年排期映射到当前年）
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

// 手工维护的排期，全部对过官方源（2026-06-11 核对）：
//   FOMC = federalreserve.gov 会议日历（决议日 = 会期第二天 14:00 ET）
//   CPI / 非农 = bls.gov 发布日程；PCE / GDP = bea.gov/news/schedule
//   期权到期 = Deribit 月度/季度，每月最后一个周五 08:00 UTC
// 维护边界见 CALENDAR_MAINTAINED_THROUGH：超过后 UI 必须亮「日历未维护」，
// 宁可承认没数据，不能拿过期排期冒充。
export const CALENDAR_MAINTAINED_THROUGH = '2026-12-31';

export const ECO_EVENTS: EcoEvent[] = [
  // ── 2026 年 6 月 ──
  { date: '2026-06-17', timeET: '14:00', title: 'FOMC 利率决议',      description: '美联储利率决定 + 点阵图(SEP)',           importance: 'high',   assetClass: 'macro' },
  { date: '2026-06-19',                  title: 'Quad Witching',      description: '四巫日 — 股票/ETF/指数 期权+期货到期',    importance: 'medium', assetClass: 'macro' },
  { date: '2026-06-25', timeET: '08:30', title: 'PCE (May)',          description: '美联储偏好的通胀指标',                    importance: 'high',   assetClass: 'macro' },
  { date: '2026-06-26',                  title: 'BTC/ETH 季度到期',   description: 'Deribit 季度期权到期 (08:00 UTC)',        importance: 'high',   assetClass: 'crypto' },

  // ── 2026 年 7 月 ──
  { date: '2026-07-02', timeET: '08:30', title: '非农就业 (Jun)',     description: '美国 6 月就业报告（周四，7/3 休市前移）', importance: 'high',   assetClass: 'macro' },
  { date: '2026-07-03',                  title: '美国独立日补休',     description: '美股休市，低流动性',                      importance: 'low',    assetClass: 'macro' },
  { date: '2026-07-14', timeET: '08:30', title: 'CPI (Jun)',          description: '美国 6 月消费者物价指数',                 importance: 'high',   assetClass: 'macro' },
  { date: '2026-07-29', timeET: '14:00', title: 'FOMC 利率决议',      description: '美联储利率决定',                          importance: 'high',   assetClass: 'macro' },
  { date: '2026-07-30', timeET: '08:30', title: 'PCE (Jun) + GDP Q2', description: 'PCE 通胀 + 二季度 GDP 初值（同日）',      importance: 'high',   assetClass: 'macro' },
  { date: '2026-07-31',                  title: 'BTC/ETH 月度到期',   description: 'Deribit 月度期权到期 (08:00 UTC)',        importance: 'medium', assetClass: 'crypto' },

  // ── 2026 年 8 月 ──
  { date: '2026-08-07', timeET: '08:30', title: '非农就业 (Jul)',     description: '美国 7 月就业报告',                       importance: 'high',   assetClass: 'macro' },
  { date: '2026-08-12', timeET: '08:30', title: 'CPI (Jul)',          description: '美国 7 月消费者物价指数',                 importance: 'high',   assetClass: 'macro' },
  { date: '2026-08-26', timeET: '08:30', title: 'PCE (Jul)',          description: '美联储偏好的通胀指标',                    importance: 'high',   assetClass: 'macro' },
  { date: '2026-08-28',                  title: 'BTC/ETH 月度到期',   description: 'Deribit 月度期权到期 (08:00 UTC)',        importance: 'medium', assetClass: 'crypto' },

  // ── 2026 年 9 月 ──
  { date: '2026-09-04', timeET: '08:30', title: '非农就业 (Aug)',     description: '美国 8 月就业报告',                       importance: 'high',   assetClass: 'macro' },
  { date: '2026-09-07',                  title: '美国劳动节',         description: '美股休市，低流动性',                      importance: 'low',    assetClass: 'macro' },
  { date: '2026-09-11', timeET: '08:30', title: 'CPI (Aug)',          description: '美国 8 月消费者物价指数',                 importance: 'high',   assetClass: 'macro' },
  { date: '2026-09-16', timeET: '14:00', title: 'FOMC 利率决议',      description: '美联储利率决定 + 点阵图(SEP)',            importance: 'high',   assetClass: 'macro' },
  { date: '2026-09-18',                  title: 'Quad Witching',      description: '四巫日 — 股票/ETF/指数 期权+期货到期',    importance: 'medium', assetClass: 'macro' },
  { date: '2026-09-25',                  title: 'BTC/ETH 季度到期',   description: 'Deribit 季度期权到期 (08:00 UTC)',        importance: 'high',   assetClass: 'crypto' },
  { date: '2026-09-30', timeET: '08:30', title: 'PCE (Aug)',          description: '美联储偏好的通胀指标',                    importance: 'high',   assetClass: 'macro' },

  // ── 2026 年 10 月 ──
  { date: '2026-10-02', timeET: '08:30', title: '非农就业 (Sep)',     description: '美国 9 月就业报告',                       importance: 'high',   assetClass: 'macro' },
  { date: '2026-10-14', timeET: '08:30', title: 'CPI (Sep)',          description: '美国 9 月消费者物价指数',                 importance: 'high',   assetClass: 'macro' },
  { date: '2026-10-28', timeET: '14:00', title: 'FOMC 利率决议',      description: '美联储利率决定',                          importance: 'high',   assetClass: 'macro' },
  { date: '2026-10-29', timeET: '08:30', title: 'PCE (Sep) + GDP Q3', description: 'PCE 通胀 + 三季度 GDP 初值（同日）',      importance: 'high',   assetClass: 'macro' },
  { date: '2026-10-30',                  title: 'BTC/ETH 月度到期',   description: 'Deribit 月度期权到期 (08:00 UTC)',        importance: 'medium', assetClass: 'crypto' },

  // ── 2026 年 11 月 ──
  { date: '2026-11-06', timeET: '08:30', title: '非农就业 (Oct)',     description: '美国 10 月就业报告',                      importance: 'high',   assetClass: 'macro' },
  { date: '2026-11-10', timeET: '08:30', title: 'CPI (Oct)',          description: '美国 10 月消费者物价指数',                importance: 'high',   assetClass: 'macro' },
  { date: '2026-11-25', timeET: '08:30', title: 'PCE (Oct)',          description: '美联储偏好的通胀指标（感恩节前日）',      importance: 'high',   assetClass: 'macro' },
  { date: '2026-11-26',                  title: '感恩节',             description: '美股休市，低流动性',                      importance: 'low',    assetClass: 'macro' },
  { date: '2026-11-27',                  title: 'BTC/ETH 月度到期',   description: 'Deribit 月度期权到期 (08:00 UTC)',        importance: 'medium', assetClass: 'crypto' },

  // ── 2026 年 12 月 ──
  { date: '2026-12-04', timeET: '08:30', title: '非农就业 (Nov)',     description: '美国 11 月就业报告',                      importance: 'high',   assetClass: 'macro' },
  { date: '2026-12-09', timeET: '14:00', title: 'FOMC 利率决议',      description: '美联储利率决定 + 点阵图(SEP)',            importance: 'high',   assetClass: 'macro' },
  { date: '2026-12-10', timeET: '08:30', title: 'CPI (Nov)',          description: '美国 11 月消费者物价指数',                importance: 'high',   assetClass: 'macro' },
  { date: '2026-12-18',                  title: 'Quad Witching',      description: '四巫日 — 股票/ETF/指数 期权+期货到期',    importance: 'medium', assetClass: 'macro' },
  { date: '2026-12-23', timeET: '08:30', title: 'PCE (Nov)',          description: '美联储偏好的通胀指标',                    importance: 'high',   assetClass: 'macro' },
  { date: '2026-12-25',                  title: 'BTC/ETH 季度到期',   description: 'Deribit 季度期权到期 (08:00 UTC)·圣诞休市', importance: 'high', assetClass: 'crypto' },
];

// ── 日期工具：日历只精确到「哪一天」，倒计时按日历日差，不按毫秒差 ──────────

function dayStartMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function parseEventDay(e: EcoEvent): number {
  const [y, m, d] = e.date.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** 距事件的日历日数：0 = 今天，负数 = 已过去。 */
export function daysUntil(e: EcoEvent): number {
  return Math.round((parseEventDay(e) - dayStartMs(new Date())) / 86_400_000);
}

/** 列表展示用 'MM/DD'。 */
export function formatEventDay(e: EcoEvent): string {
  return e.date.slice(5).replace('-', '/');
}

/** 排期数据是否已超出维护范围 — 超出后 UI 必须明示，不得显示「无事件」。 */
export function isCalendarStale(): boolean {
  const [y, m, d] = CALENDAR_MAINTAINED_THROUGH.split('-').map(Number);
  return dayStartMs(new Date()) > new Date(y, m - 1, d).getTime();
}

/** 未来 N 天内的事件（含今天全天 — 事件日当天不因时刻流逝而消失）。 */
export function getUpcomingEvents(days = 30): EcoEvent[] {
  return ECO_EVENTS
    .map(e => ({ e, d: daysUntil(e) }))
    .filter(({ d }) => d >= 0 && d <= days)
    .sort((a, b) => a.d - b.d)
    .map(({ e }) => e);
}

export function getImportanceColor(i: EcoEvent['importance']): string {
  if (i === 'high')   return '#FF5F57';
  if (i === 'medium') return '#FEBC2E';
  return '#64748b';
}
