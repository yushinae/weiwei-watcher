export interface FetchRetryOptions extends RequestInit {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchWithRetry(url: string, options: FetchRetryOptions = {}): Promise<Response> {
  const {
    retries = 2,
    retryDelayMs = 350,
    timeoutMs = 12_000,
    signal,
    ...init
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(new Error('fetch timeout')), timeoutMs);
    try {
      const resp = await fetch(url, { ...init, signal: controller.signal });
      if (!RETRY_STATUSES.has(resp.status) || attempt === retries) return resp;
      lastError = new Error(`HTTP ${resp.status}`);
    } catch (e) {
      lastError = e;
      if (attempt === retries) throw e;
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    await wait(retryDelayMs * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
