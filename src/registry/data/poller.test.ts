import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _pauseAll,
  _resetPollersForTest,
  _resumeAll,
  pauseMonitorPolling,
  subscribeData,
} from './poller';
import { setAppHiddenForTest, shouldRunFeedKey, subscribeRuntimePolicy } from './runtimePolicy';

const flushMicrotasks = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe('subscribeData', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetPollersForTest();
  });

  afterEach(() => {
    _resetPollersForTest();
    vi.useRealTimers();
  });

  it('shares one fetcher across subscribers with the same key', async () => {
    const fetcher = vi.fn(async () => 42);
    const a = vi.fn();
    const b = vi.fn();

    const unsubA = subscribeData('shared', fetcher, 1000, a);
    const unsubB = subscribeData('shared', fetcher, 1000, b);
    await flushMicrotasks();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(42);
    expect(b).toHaveBeenCalledWith(42);

    unsubA();
    unsubB();
  });

  it('replays cached data to later subscribers without refetching immediately', async () => {
    const fetcher = vi.fn(async () => 'first');
    const first = vi.fn();
    const second = vi.fn();

    const unsubFirst = subscribeData('cached', fetcher, 1000, first);
    await flushMicrotasks();

    const unsubSecond = subscribeData('cached', fetcher, 1000, second);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith('first');

    unsubFirst();
    unsubSecond();
  });

  it('stops polling after the last subscriber unsubscribes', async () => {
    const fetcher = vi.fn(async () => 1);
    const subscriber = vi.fn();

    const unsub = subscribeData('stop', fetcher, 1000, subscriber);
    await flushMicrotasks();
    unsub();

    await vi.advanceTimersByTimeAsync(3000);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not poll while globally paused', async () => {
    const fetcher = vi.fn(async () => 1);
    const subscriber = vi.fn();

    _pauseAll();
    const unsub = subscribeData('route-paused', fetcher, 1000, subscriber);
    await vi.advanceTimersByTimeAsync(3000);

    expect(fetcher).not.toHaveBeenCalled();

    _resumeAll();
    await flushMicrotasks();

    expect(fetcher).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('keeps shared data polling when monitor route polling is paused', async () => {
    const fetcher = vi.fn(async () => 1);
    const subscriber = vi.fn();

    pauseMonitorPolling();
    const unsub = subscribeData('shared-route-independent', fetcher, 1000, subscriber);
    await flushMicrotasks();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith(1);
    unsub();
  });

  it('does not overlap slow requests for the same key', async () => {
    let resolveFetch!: (v: number) => void;
    const fetcher = vi.fn(() => new Promise<number>(resolve => { resolveFetch = resolve; }));
    const subscriber = vi.fn();

    const unsub = subscribeData('slow', fetcher, 1000, subscriber);
    await vi.advanceTimersByTimeAsync(3000);

    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveFetch(7);
    await flushMicrotasks();

    expect(subscriber).toHaveBeenCalledWith(7);
    unsub();
  });

  it('pauses only monitor-scoped pollers on monitor route pause', async () => {
    const sharedFetcher = vi.fn(async () => 'shared');
    const monitorFetcher = vi.fn(async () => 'monitor');
    const sharedSub = vi.fn();
    const monitorSub = vi.fn();

    const unsubShared = subscribeData('route-shared', sharedFetcher, 1000, sharedSub);
    const unsubMonitor = subscribeData('route-monitor', monitorFetcher, 1000, monitorSub, { monitorScoped: true });
    await flushMicrotasks();

    pauseMonitorPolling();
    await vi.advanceTimersByTimeAsync(3000);

    expect(sharedFetcher).toHaveBeenCalledTimes(4);
    expect(monitorFetcher).toHaveBeenCalledTimes(1);

    unsubShared();
    unsubMonitor();
  });

  it('keeps background feeds running while hidden but pauses visible-live feeds', async () => {
    const backgroundFetcher = vi.fn(async () => 'background');
    const visibleFetcher = vi.fn(async () => 'visible');
    const backgroundSub = vi.fn();
    const visibleSub = vi.fn();

    setAppHiddenForTest(true);
    const unsubBackground = subscribeData('options-BTC', backgroundFetcher, 1000, backgroundSub);
    const unsubVisible = subscribeData('option-chain-BTC', visibleFetcher, 1000, visibleSub);
    await flushMicrotasks();

    expect(backgroundFetcher).toHaveBeenCalledTimes(1);
    expect(visibleFetcher).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3000);

    expect(backgroundFetcher).toHaveBeenCalledTimes(4);
    expect(visibleFetcher).not.toHaveBeenCalled();

    unsubBackground();
    unsubVisible();
  });

  it('resumes visible-live pollers when the app becomes visible again', async () => {
    const fetcher = vi.fn(async () => 'visible');
    const subscriber = vi.fn();

    setAppHiddenForTest(true);
    const unsub = subscribeData('option-chain-BTC', fetcher, 1000, subscriber);
    await vi.advanceTimersByTimeAsync(3000);

    expect(fetcher).not.toHaveBeenCalled();

    setAppHiddenForTest(false);
    await flushMicrotasks();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith('visible');

    unsub();
  });

  it('notifies runtime policy listeners when visibility state changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRuntimePolicy(listener);

    expect(shouldRunFeedKey('option-chain-BTC')).toBe(true);

    setAppHiddenForTest(true);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(shouldRunFeedKey('option-chain-BTC')).toBe(false);
    expect(shouldRunFeedKey('options-BTC')).toBe(true);

    unsubscribe();
  });
});
