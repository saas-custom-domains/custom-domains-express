import { prisma } from '../src/db.js'

// Two tenants, each with a status page. Safe to run more than once.
const companies = [
  {
    slug: 'intercom',
    name: 'Intercom',
    components: [
      ['Messenger', 'operational'],
      ['Inbox', 'operational'],
      ['API', 'degraded'],
    ],
  },
  {
    slug: 'globex',
    name: 'Globex',
    components: [
      ['Website', 'operational'],
      ['Checkout', 'operational'],
    ],
  },
]

for (const { slug, name, components } of companies) {
  const exists = await prisma.company.findUnique({ where: { slug } })
  if (exists) continue
  await prisma.company.create({
    data: {
      slug,
      name,
      components: {
        create: components.map(([name, status], position) => ({
          name,
          status,
          position,
        })),
      },
    },
  })
}
