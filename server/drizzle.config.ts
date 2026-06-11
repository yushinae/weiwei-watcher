import { defineConfig } from 'drizzle-kit'

// 仅用于 `npx drizzle-kit generate`（离线生成 SQL 迁移文件到 ./drizzle）
// 运行时迁移在 db/index.ts 启动时自动执行，不需要连库。
export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: './drizzle',
})
