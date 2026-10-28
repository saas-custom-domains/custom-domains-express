// Express and express-session behaviour this app depends on. If a new
// release changes any of it, CI fails here first.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import express from 'express'
import session from 'express-session'
import request from 'supertest'

function sessionApp(trustProxy) {
  const app = express()
  app.set('trust proxy', trustProxy)
  app.use(
    session({
      secret: 'test',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: true },
    }),
  )
  app.get('/', (req, res) => {
    req.session.visited = true
    res.send(req.secure ? 'secure' : 'not secure')
  })
  return app
}

describe('express-session behind a TLS-terminating proxy', () => {
  it('silently drops a secure cookie when the proxy is not trusted', async () => {
    const res = await request(sessionApp(false))
      .get('/')
      .set('X-Forwarded-Proto', 'https')
    assert.equal(res.text, 'not secure')
    assert.equal(res.headers['set-cookie'], undefined)
    assert.equal(res.status, 200) // no error anywhere
  })

  it('sets it once the proxy is trusted', async () => {
    const res = await request(sessionApp('loopback'))
      .get('/')
      .set('X-Forwarded-Proto', 'https')
    assert.equal(res.text, 'secure')
    assert.match(res.headers['set-cookie'][0], /^connect\.sid=.*; Secure/)
  })
})

describe('req.hostname', () => {
  const app = express().get('/', (req, res) => res.json(req.hostname ?? null))

  it('drops the port', async () => {
    const res = await request(app).get('/').set('Host', 'Status.Intercom.com:8443')
    assert.equal(res.body, 'Status.Intercom.com') // not lowercased
  })

  it('takes X-Forwarded-Host from any client with trust proxy true', async () => {
    app.set('trust proxy', true)
    const res = await request(app)
      .get('/')
      .set('Host', 'app.statuspage.com')
      .set('X-Forwarded-Host', 'status.intercom.com')
    assert.equal(res.body, 'status.intercom.com')
  })
})
