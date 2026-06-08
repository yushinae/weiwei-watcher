import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _pauseAll,
  _resetPollersForTest,
  _resumeAll,
  pauseMonitorPolling,
  subscribeData,
} from './poller';

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
});
