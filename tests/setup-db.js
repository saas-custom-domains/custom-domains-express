// Fresh test database: migrate and seed. Run by `npm test`.
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const file = process.env.DATABASE_URL.replace(/^file:/, '')
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  rmSync(file + suffix, { force: true })
}
const run = (...args) =>
  execFileSync('npx', ['prisma', ...args], { stdio: 'ignore' })
run('migrate', 'deploy')
run('db', 'seed')
