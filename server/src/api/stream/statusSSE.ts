import { Router } from 'express';

export function statusStreamRouter(statusSource: () => Promise<any>) {
  const r = Router();

  r.get('/', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = async () => {
      try {
        const payload = await statusSource();
        res.write(`event: status\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (e: any) {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: String(e?.message ?? e) })}\n\n`);
      }
    };

    await send();
    const timer = setInterval(send, 1000);

    req.on('close', () => {
      clearInterval(timer);
    });
  });

  return r;
}

