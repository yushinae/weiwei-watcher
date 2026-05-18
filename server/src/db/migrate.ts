import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../config';
import { createPool } from './pool';

async function main() {
  const env = loadEnv();
  const pool = createPool(env);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dir = path.join(__dirname, 'migrations');

  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) {
    // eslint-disable-next-line no-console
    console.log('[migrate] no migrations found');
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[migrate] applying ${files.length} migrations...`);

  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const f of files) {
      const sql = await fs.readFile(path.join(dir, f), 'utf-8');
      // eslint-disable-next-line no-console
      console.log(`[migrate] -> ${f}`);
      await client.query(sql);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

