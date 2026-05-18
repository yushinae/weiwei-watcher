import WebSocket from 'ws';
import type { CollectorManager } from '../../collectors/manager';

type DeribitWsOpts = {
  manager: CollectorManager;
  currencies: string[]; // ['BTC','ETH']
  // 未来可从 instrumentRegistry 动态维护 channels
};

export function startDeribitWs(opts: DeribitWsOpts) {
  const env = (process.env.DERIBIT_ENV ?? 'testnet').toLowerCase();
  const url = env === 'mainnet' ? 'wss://www.deribit.com/ws/api/v2' : 'wss://test.deribit.com/ws/api/v2';
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let rpcId = 1;

  const send = (method: string, params: any) => {
    ws?.send(JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }));
  };

  const connect = () => {
    opts.manager.setState('deribit_ws', 'connecting');
    ws = new WebSocket(url);

    ws.on('open', () => {
      opts.manager.setState('deribit_ws', 'open');

      // heartbeat（Deribit 支持 public/set_heartbeat）
      send('public/set_heartbeat', { interval: 20 });

      // minimal subscribe: instrument.state for each currency (用于后续动态订阅维护)
      const channels = opts.currencies.map((c) => `instrument.state.option.${c.toUpperCase()}`);
      if (channels.length) {
        send('public/subscribe', { channels });
      }

      // keepalive ping
      pingTimer = setInterval(() => {
        try {
          ws?.ping();
        } catch {
          // ignore
        }
      }, 20_000);
    });

    ws.on('message', (_raw) => {
      opts.manager.markMessage('deribit_ws');
      // 解析与数据落地在后续扩展：ticker/trades/book + 丢序检测 + resync
    });

    ws.on('close', () => {
      opts.manager.setState('deribit_ws', 'closed');
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      reconnectTimer = setTimeout(connect, 3000);
    });

    ws.on('error', (e) => {
      opts.manager.setError('deribit_ws', e);
    });
  };

  connect();

  return () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    ws?.close();
  };
}
