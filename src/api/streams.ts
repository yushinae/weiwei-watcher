import { useEffect, useMemo, useState } from 'react';

export type CollectorStatus = {
  source: string;
  state: string;
  last_msg_ts: string | null;
  msg_rate_1m: number | null;
  last_error: string | null;
  updated_at: string;
};

export type StatusPayload = {
  ok: boolean;
  sources: CollectorStatus[];
  ts: string;
};

export function useStatusStreamSSE() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/stream/status');
    es.addEventListener('status', (e: MessageEvent) => {
      try {
        const json = JSON.parse(String(e.data));
        setData(json);
        setError(null);
      } catch (err: any) {
        setError(String(err?.message ?? err));
      }
    });
    es.addEventListener('error', () => {
      setError('SSE disconnected');
    });
    return () => {
      es.close();
    };
  }, []);

  return useMemo(() => ({ data, error }), [data, error]);
}

