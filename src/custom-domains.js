import express from 'express'
import { prisma } from './db.js'
import { APP_HOSTS } from './hosts.js'
import { getStatusData } from './status.js'

// The one place that reads the hostname. Behind SaaS Custom Domains,
// Host is your own hostname and the customer's domain arrives in
// X-Served-For (app.js has already checked the proxy's token).
export function hostFrom(req) {
  return (req.get('X-Served-For') || req.hostname || '').toLowerCase()
}

const router = express.Router()

router.use(async (req, res, next) => {
  const domain = await prisma.customDomain.findFirst({
    where: { host: hostFrom(req), status: 'active' },
    include: { company: true },
  })
  if (!domain) return res.status(404).send('Unknown domain')

  req.company = domain.company
  req.customDomain = domain.host
  next()
})

router.get('/', async (req, res) => {
  const data = await getStatusData(req.company.id)
  res.render('status-page', {
    company: req.company,
    data,
    // Absolute URLs use the customer's domain, never req.get('host').
    canonicalUrl: `https://${req.customDomain}/`,
    subscribed: req.query.subscribed === '1',
    error: null,
  })
})

// Browsers send Origin with every form POST. Compare it with the
// customer's domain: Host is your own hostname behind the proxy, so a
// check against req.get('host') would reject every real submission.
function sameOrigin(req, res, next) {
  const origin = req.get('Origin')
  if (!origin) return next() // not a browser
  if (URL.parse(origin)?.hostname === req.customDomain) return next()
  res.status(403).send('Cross-site form submission')
}

router.post(
  '/subscribe',
  express.urlencoded(),
  sameOrigin,
  async (req, res) => {
    // The company comes from the domain, never from the form.
    const companyId = req.company.id
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const data = await getStatusData(companyId)
      return res.status(422).render('status-page', {
        company: req.company,
        data,
        canonicalUrl: `https://${req.customDomain}/`,
        subscribed: false,
        error: 'Enter a valid email address.',
      })
    }
    await prisma.subscriber.upsert({
      where: { companyId_email: { companyId, email } },
      create: { companyId, email },
      update: {},
    })
    // A relative redirect, so the visitor stays on the custom domain.
    res.redirect(303, '/?subscribed=1')
  },
)

// Anything else on a custom domain is a 404, not your app
router.use((req, res) => res.sendStatus(404))

export function customDomains(req, res, next) {
  if (APP_HOSTS.has(hostFrom(req))) return next()
  router(req, res, next)
}
