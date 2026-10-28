import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './generated/prisma/client.ts'

// SQLite keeps the example to one container. For Postgres, use
// @prisma/adapter-pg instead; the queries stay the same.
const url = process.env.DATABASE_URL ?? 'file:./data/app.db'

export const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url }),
})
