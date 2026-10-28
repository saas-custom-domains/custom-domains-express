import express from 'express'
import { fileURLToPath } from 'node:url'
import { customDomains } from './custom-domains.js'
import { appRoutes } from './routes.js'
import { safeEqual } from './safe-equal.js'

// Requests that carry X-Served-For must prove they came through
// SaaS Custom Domains, or anyone could claim a customer's domain by
// sending the header straight to your app.
export function verifyProxyToken(req, res, next) {
  if (!req.get('X-Served-For')) return next()

  const token = req.get('X-SaaS-Domains-Auth-Token')
  if (!safeEqual(token, process.env.PROXY_AUTH_TOKEN)) {
    return res.sendStatus(403)
  }
  next()
}

// Which proxies may set X-Forwarded-Host/-Proto/-For. Never `true`:
// then any client can pick req.hostname with X-Forwarded-Host.
// "loopback" fits Caddy on the same machine. Comma-separated addresses
// or subnets also work, or a hop count such as "1".
function trustProxySetting(value = 'loopback') {
  return /^\d+$/.test(value) ? Number(value) : value
}

export function createApp({ trustProxy = process.env.TRUST_PROXY } = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxySetting(trustProxy))
  app.set('view engine', 'ejs')
  app.set('views', fileURLToPath(new URL('./views', import.meta.url)))

  // Health checks come from load balancers by IP address, so this
  // goes before anything that looks at the hostname.
  app.get('/up', (req, res) => res.send('ok'))

  // Register before customDomains
  app.use(verifyProxyToken)
  app.use(customDomains)
  app.use(appRoutes)

  // Express 5 sends errors from async handlers here.
  app.use((err, req, res, next) => {
    console.error(err)
    res.status(500).send('Something went wrong')
  })

  return app
}
