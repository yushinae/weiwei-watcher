// 共享：同步所有已配置账户，返回实时持仓（并顺带把成交合并进本地库）。
// 「账户」页和「组合风险」页共用，避免各写一遍同步逻辑。
import { getAccounts } from './store';
import { ADAPTERS } from './adapters';
import { getLastSync, setLastSync, mergeFills } from './fillStore';
import type { UnifiedPosition } from './types';

const BACKFILL_MS = 365 * 86_400_000;

export async function fetchAllPositions(): Promise<UnifiedPosition[]> {
  const out: UnifiedPosition[] = [];
  for (const acct of getAccounts()) {
    const adapter = ADAPTERS[acct.venue];
    if (!adapter) continue;
    try {
      const since = getLastSync(acct.venue, acct.id) || Date.now() - BACKFILL_MS;
      const res = await adapter.sync(acct, since);
      mergeFills(res.fills);
      setLastSync(acct.venue, acct.id, Date.now() - 60_000);
      out.push(...res.positions);
    } catch {
      /* 单账户失败不影响其它 */
    }
  }
  return out;
}
