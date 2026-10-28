import express from 'express'
import { fileURLToPath } from 'node:url'
import { customDomains } from './custom-domains.js'
import { appRoutes } from './routes.js'
import { safeEqual } from './safe-equal.js'

// Requests with X-Served-For must prove they came through the proxy,
// or anyone could claim a customer's domain by sending the header.
export function verifyProxyToken(req, res, next) {
  if (!req.get('X-Served-For')) return next()

  const token = req.get('X-SaaS-Domains-Auth-Token')
  if (!safeEqual(token, process.env.PROXY_AUTH_TOKEN)) {
    return res.sendStatus(403)
  }
  next()
}

// Who may set X-Forwarded-*. Never `true`: any client could then pick
// req.hostname with X-Forwarded-Host. "loopback" fits Caddy on the
// same machine; addresses, subnets or a hop count ("1") work too.
function trustProxySetting(value = 'loopback') {
  return /^\d+$/.test(value) ? Number(value) : value
}

export function createApp(options = {}) {
  const { trustProxy = process.env.TRUST_PROXY } = options
  const views = fileURLToPath(new URL('./views', import.meta.url))

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxySetting(trustProxy))
  app.set('view engine', 'ejs')
  app.set('views', views)

  // Load balancers call this by IP address, so it goes before
  // anything that looks at the hostname
  app.get('/up', (req, res) => res.send('ok'))

  app.use(verifyProxyToken) // before customDomains
  app.use(customDomains)
  app.use(appRoutes)

  // Express 5 sends errors from async handlers here
  app.use((err, req, res, next) => {
    console.error(err)
    res.status(500).send('Something went wrong')
  })

  return app
}
