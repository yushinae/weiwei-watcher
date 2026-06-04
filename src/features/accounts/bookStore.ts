// 当前持仓（book）共享缓存：同步时写入，全局告警引擎读取以评估"盯持仓"的告警（净Delta/净Vega）。
// 内存即可（不需持久化）；持仓变化不频繁，引擎用它 + 实时现价即可让净Delta随价格实时变。
import type { UnifiedPosition } from './types';

let BOOK: UnifiedPosition[] = [];
const listeners = new Set<() => void>();

export function setBook(positions: UnifiedPosition[]): void {
  BOOK = positions;
  listeners.forEach(f => f());
}
export function getBook(): UnifiedPosition[] { return BOOK; }
export function subscribeBook(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
