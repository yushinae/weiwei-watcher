import { describe, it, expect } from 'vitest';
import { preTradeChecks, type PreTradeInput } from './preTradeChecks';

const base: PreTradeInput = {
  bid: 100, ask: 104, mark: 102,
  qty: 0.1, price: 103, orderType: 'limit',
  chainKind: 'live', chainAgeMs: 500, spotKind: 'live',
};

describe('preTradeChecks', () => {
  it('一切正常 → 绿灯、不阻断', () => {
    const r = preTradeChecks(base);
    expect(r.level).toBe('ok');
    expect(r.blocking).toBe(false);
  });

  it('数量为 0 → 硬阻断', () => {
    const r = preTradeChecks({ ...base, qty: 0 });
    expect(r.blocking).toBe(true);
    expect(r.level).toBe('block');
    expect(r.checks.find(c => c.id === 'qty')?.level).toBe('block');
  });

  it('限价单未填价 → 硬阻断', () => {
    const r = preTradeChecks({ ...base, orderType: 'limit', price: 0 });
    expect(r.blocking).toBe(true);
    expect(r.checks.find(c => c.id === 'limit-empty')?.level).toBe('block');
  });

  it('报价数据中断 → 警告', () => {
    const r = preTradeChecks({ ...base, chainKind: 'error' });
    expect(r.level).toBe('warn');
    expect(r.blocking).toBe(false);
    expect(r.checks.find(c => c.id === 'fresh-chain')?.level).toBe('warn');
  });

  it('点差很宽 → 警告', () => {
    const r = preTradeChecks({ ...base, bid: 80, ask: 124, mark: 102 }); // 43% 宽
    expect(r.checks.find(c => c.id === 'spread')?.level).toBe('warn');
    expect(r.checks.find(c => c.id === 'spread')?.detail).toContain('很宽');
  });

  it('无双边报价 → 警告', () => {
    const r = preTradeChecks({ ...base, bid: null });
    expect(r.checks.find(c => c.id === 'spread')?.level).toBe('warn');
  });

  it('限价远偏标记（防胖手指） → 警告', () => {
    const r = preTradeChecks({ ...base, price: 130, mark: 102 }); // +27%
    expect(r.checks.find(c => c.id === 'limit-dev')?.level).toBe('warn');
    expect(r.checks.find(c => c.id === 'limit-dev')?.detail).toContain('手滑');
  });

  it('市价单不触发限价相关检查', () => {
    const r = preTradeChecks({ ...base, orderType: 'market', price: 0 });
    expect(r.checks.find(c => c.id === 'limit-empty')).toBeUndefined();
    expect(r.checks.find(c => c.id === 'limit-dev')).toBeUndefined();
  });
});
