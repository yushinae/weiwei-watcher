import { Router } from 'express';

export function statusRouter(statusSource: () => Promise<any>) {
  const r = Router();

  r.get('/', async (_req, res) => {
    const payload = await statusSource();
    res.json(payload);
  });

  return r;
}

