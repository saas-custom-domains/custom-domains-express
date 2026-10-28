import { prisma } from './db.js'

const SEVERITY = { operational: 0, degraded: 1, outage: 2 }
const SUMMARY = [
  'All systems operational',
  'Some systems degraded',
  'Major outage',
]

export async function getStatusData(companyId) {
  const components = await prisma.component.findMany({
    where: { companyId },
    orderBy: { position: 'asc' },
  })
  const worst = Math.max(0, ...components.map((c) => SEVERITY[c.status] ?? 0))
  return { components, summary: SUMMARY[worst] }
}
