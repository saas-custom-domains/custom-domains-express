import express from 'express'
import { prisma } from './db.js'
import {
  addCustomDomain,
  checkDns,
  DomainError,
  removeCustomDomain,
} from './domains.js'
import { safeEqual } from './safe-equal.js'
import { SaasDomainsError } from './saas-domains.js'

// Your own app: the dashboard, Caddy's ask endpoint and webhooks.
// Only reachable on APP_HOSTS (see custom-domains.js).
export const appRoutes = express.Router()

// This example has no login. In your app, check that the signed-in
// user owns the company (and the domain) in every route below.

async function renderDashboard(res, errors = {}) {
  const companies = await prisma.company.findMany({
    orderBy: { id: 'asc' },
    include: { domains: { orderBy: { id: 'asc' } } },
  })
  res.render('dashboard', { companies, errors })
}

appRoutes.get('/', async (req, res) => {
  await renderDashboard(res)
})

appRoutes.post(
  '/companies/:id/domains',
  express.urlencoded(),
  async (req, res) => {
    const company = await prisma.company.findUnique({
      where: { id: Number(req.params.id) },
    })
    if (!company) return res.sendStatus(404)

    try {
      const dnsContact = String(req.body?.dnsContact ?? '').trim()
      await addCustomDomain(
        company,
        String(req.body?.host ?? ''),
        dnsContact || company.dnsContactEmail,
      )
    } catch (err) {
      let message = 'Could not add the domain. Try again.'
      if (err instanceof DomainError) message = err.message
      else if (err instanceof SaasDomainsError) console.error(err)
      else throw err
      res.status(422)
      return renderDashboard(res, { [company.id]: message })
    }
    res.redirect(303, '/')
  },
)

async function findDomain(req, res, next) {
  req.domain = await prisma.customDomain.findUnique({
    where: { id: Number(req.params.id) },
  })
  if (!req.domain) return res.sendStatus(404)
  next()
}

appRoutes.post('/domains/:id/check', findDomain, async (req, res) => {
  await checkDns(req.domain)
  res.redirect(303, '/')
})

appRoutes.post('/domains/:id/remove', findDomain, async (req, res) => {
  await removeCustomDomain(req.domain)
  res.redirect(303, '/')
})

// Caddy asks before issuing a certificate on demand
// (DOMAINS_PROVIDER=caddy): 200 = go ahead, anything else = refuse.
appRoutes.get('/caddy/ask', async (req, res) => {
  const host = String(req.query.domain ?? '').toLowerCase()
  const known = await prisma.customDomain.findFirst({
    where: { host, status: 'active' },
  })
  res.sendStatus(known ? 200 : 404)
})

// Webhooks from SaaS Custom Domains.
// Events: https://docs.saascustomdomains.com/webhooks
const UPDATES_BY_EVENT = {
  domain_dns_proxy_record_valid: { status: 'active' },
  domain_dns_proxy_record_invalid: { status: 'pending' },
  tls_certificate_issued: { httpsReady: true },
}

const webhookPath = '/webhooks/saas-domains'

appRoutes.post(webhookPath, express.json(), async (req, res) => {
  if (!safeEqual(req.query.token, process.env.SCD_WEBHOOK_TOKEN)) {
    return res.sendStatus(401)
  }

  // req.body is undefined in Express 5 if the body wasn't JSON
  const data = UPDATES_BY_EVENT[req.body?.event]
  const uuid = req.body?.domain?.uuid
  // Prisma reads `providerUuid: undefined` as no filter at all, so
  // without this check updateMany would change every domain
  if (data && typeof uuid === 'string') {
    await prisma.customDomain.updateMany({
      where: { providerUuid: uuid },
      data,
    })
  }
  res.sendStatus(200)
})
