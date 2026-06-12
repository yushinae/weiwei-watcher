import { feedMetaForKey, type FeedRunMode } from './feedCatalog';

type RuntimeState = {
  appHidden: boolean;
  globalPaused: boolean;
  monitorRoutePaused: boolean;
};

type RuntimeListener = () => void;

const state: RuntimeState = {
  appHidden: typeof document !== 'undefined' ? document.hidden : false,
  globalPaused: false,
  monitorRoutePaused: false,
};

const listeners = new Set<RuntimeListener>();

function emitRuntimePolicyChange(): void {
  listeners.forEach(listener => listener());
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (state.appHidden === document.hidden) return;
    state.appHidden = document.hidden;
    emitRuntimePolicyChange();
  });
}

export type RuntimeBlockReason = 'global-paused' | 'route-paused' | 'hidden';

export function setGlobalPaused(on: boolean): void {
  if (state.globalPaused === on) return;
  state.globalPaused = on;
  emitRuntimePolicyChange();
}

export function setMonitorRoutePaused(on: boolean): void {
  if (state.monitorRoutePaused === on) return;
  state.monitorRoutePaused = on;
  emitRuntimePolicyChange();
}

export function setAppHiddenForTest(on: boolean): void {
  if (state.appHidden === on) return;
  state.appHidden = on;
  emitRuntimePolicyChange();
}

export function resetRuntimePolicyForTest(): void {
  state.appHidden = typeof document !== 'undefined' ? document.hidden : false;
  state.globalPaused = false;
  state.monitorRoutePaused = false;
  emitRuntimePolicyChange();
}

export function feedRunMode(key: string, explicit?: FeedRunMode): FeedRunMode {
  return explicit ?? feedMetaForKey(key).mode;
}

export function runtimeBlockReason({
  mode,
  monitorScoped = false,
}: {
  mode: FeedRunMode;
  monitorScoped?: boolean;
}): RuntimeBlockReason | null {
  if (state.globalPaused) return 'global-paused';
  if (monitorScoped && state.monitorRoutePaused) return 'route-paused';
  if (mode === 'visible-live' && state.appHidden) return 'hidden';
  return null;
}

export function shouldRunFeed(input: { mode: FeedRunMode; monitorScoped?: boolean }): boolean {
  return runtimeBlockReason(input) === null;
}

export function shouldRunFeedKey(key: string, options?: { mode?: FeedRunMode; monitorScoped?: boolean }): boolean {
  return shouldRunFeed({
    mode: feedRunMode(key, options?.mode),
    monitorScoped: options?.monitorScoped,
  });
}

export function subscribeRuntimePolicy(listener: RuntimeListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
