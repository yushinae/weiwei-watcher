/**
 * 数据库连接 + 启动时自动迁移
 *
 * 两种模式（自动选择）：
 *   - 设了 DATABASE_URL → 连真 Postgres（生产 / VPS）
 *   - 没设 → PGlite（嵌入式 Postgres，零安装，数据落在 server/data/pg/）
 *
 * 两种驱动的查询 API 完全一致，业务代码统一用 PgDatabase 基类类型。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(__dirname, '..', 'drizzle')

export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>

async function init(): Promise<AppDb> {
  const url = process.env.DATABASE_URL
  if (url) {
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    const pg = await import('pg')
    const pool = new pg.default.Pool({ connectionString: url })
    const db = drizzle(pool, { schema })
    await migrate(db, { migrationsFolder: MIGRATIONS })
    console.log('🗄  Postgres 已连接（DATABASE_URL），迁移完成')
    return db as unknown as AppDb
  }
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  const client = new PGlite(join(__dirname, '..', 'data', 'pg'))
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS })
  console.log('🗄  PGlite 已就绪（本地嵌入式 Postgres，server/data/pg）')
  return db as unknown as AppDb
}

export const db = await init()
