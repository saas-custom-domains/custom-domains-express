import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './generated/prisma/client.ts'

// SQLite keeps the example to one container. With Postgres, swap the
// adapter for @prisma/adapter-pg; the queries stay the same.
const url = process.env.DATABASE_URL ?? 'file:./data/app.db'
mkdirSync(dirname(url.replace(/^file:/, '')), { recursive: true })

export const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url }),
})
