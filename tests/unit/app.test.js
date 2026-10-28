import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { prisma } from '../../src/db.js'

const app = createApp()
const proxyHeaders = (host) => ({
  Host: 'app.statuspage.com',
  'X-Served-For': host,
  'X-SaaS-Domains-Auth-Token': 'test_proxy_token',
})

before(async () => {
  const [intercom, globex] = await prisma.company.findMany({
    orderBy: { id: 'asc' },
  })
  await prisma.customDomain.createMany({
    data: [
      {
        host: 'status.intercom.com',
        status: 'active',
        companyId: intercom.id,
        providerUuid: 'uuid_intercom',
      },
      {
        host: 'status.globex.com',
        status: 'pending',
        companyId: globex.id,
        providerUuid: 'uuid_globex',
      },
    ],
  })
})

describe('routing by hostname', () => {
  it('serves the dashboard on the app host', async () => {
    const res = await request(app).get('/').set('Host', 'app.statuspage.com')
    assert.equal(res.status, 200)
    assert.match(res.text, /Status pages/)
  })

  it('serves an active custom domain its own status page', async () => {
    const res = await request(app).get('/').set('Host', 'status.intercom.com')
    assert.equal(res.status, 200)
    assert.match(res.text, /<h1>Intercom status<\/h1>/)
    assert.match(res.text, /href="https:\/\/status.intercom.com\/"/)
  })

  it('returns 404 for pending and unknown domains', async () => {
    for (const host of ['status.globex.com', 'evil.example']) {
      const res = await request(app).get('/').set('Host', host)
      assert.equal(res.status, 404, host)
    }
  })

  it('keeps app routes off custom domains and tenant routes off the app', async () => {
    const dashboard = await request(app)
      .get('/caddy/ask?domain=status.intercom.com')
      .set('Host', 'status.intercom.com')
    assert.equal(dashboard.status, 404)

    const subscribe = await request(app)
      .post('/subscribe')
      .set('Host', 'app.statuspage.com')
      .type('form')
      .send({ email: 'a@example.com' })
    assert.equal(subscribe.status, 404)
  })

  it('answers health checks by IP address', async () => {
    const res = await request(app).get('/up').set('Host', '10.0.0.12:3000')
    assert.equal(res.status, 200)
  })

  it('survives a request without a Host header', async () => {
    // HTTP/1.0 allows it; req.hostname is then undefined.
    const res = await request(app).get('/').set('Host', '')
    assert.equal(res.status, 404)
  })
})

describe('behind SaaS Custom Domains', () => {
  it('reads X-Served-For when the token is valid', async () => {
    const res = await request(app)
      .get('/')
      .set(proxyHeaders('status.intercom.com'))
    assert.equal(res.status, 200)
    assert.match(res.text, /Intercom status/)
  })

  it('rejects X-Served-For without the right token', async () => {
    const spoofed = await request(app)
      .get('/')
      .set('Host', 'app.statuspage.com')
      .set('X-Served-For', 'status.intercom.com')
    assert.equal(spoofed.status, 403)

    const wrong = await request(app)
      .get('/')
      .set({ ...proxyHeaders('status.intercom.com'), 'X-SaaS-Domains-Auth-Token': 'guess' })
    assert.equal(wrong.status, 403)
  })

  it('rejects every token when PROXY_AUTH_TOKEN is unset', async (t) => {
    const saved = process.env.PROXY_AUTH_TOKEN
    delete process.env.PROXY_AUTH_TOKEN
    t.after(() => (process.env.PROXY_AUTH_TOKEN = saved))

    const res = await request(app)
      .get('/')
      .set({ ...proxyHeaders('status.intercom.com'), 'X-SaaS-Domains-Auth-Token': 'undefined' })
    assert.equal(res.status, 403)
  })

  it('accepts the form when Origin is the customer domain, not Host', async () => {
    const res = await request(app)
      .post('/subscribe')
      .set(proxyHeaders('status.intercom.com'))
      .set('Origin', 'https://status.intercom.com')
      .type('form')
      .send({ email: 'Reader@Example.com' })
    assert.equal(res.status, 303)
    assert.equal(res.headers.location, '/?subscribed=1')
    const saved = await prisma.subscriber.findFirst({
      where: { email: 'reader@example.com' },
    })
    assert.ok(saved)
  })

  it('rejects a cross-site form post', async () => {
    const res = await request(app)
      .post('/subscribe')
      .set(proxyHeaders('status.intercom.com'))
      .set('Origin', 'https://evil.example')
      .type('form')
      .send({ email: 'victim@example.com' })
    assert.equal(res.status, 403)
  })
})

describe('trust proxy', () => {
  it('ignores X-Forwarded-Host from clients it does not trust', async () => {
    // supertest connects over loopback, which the default ("loopback")
    // trusts, so stand in for a client from another address.
    const res = await request(createApp({ trustProxy: '10.0.0.1' }))
      .get('/')
      .set('Host', 'app.statuspage.com')
      .set('X-Forwarded-Host', 'status.intercom.com')
    assert.match(res.text, /Status pages/)
  })

  it('with `true`, any client picks the tenant with X-Forwarded-Host', async () => {
    const res = await request(createApp({ trustProxy: true }))
      .get('/')
      .set('Host', 'app.statuspage.com')
      .set('X-Forwarded-Host', 'status.intercom.com')
    assert.match(res.text, /Intercom status/)
  })
})

describe('dashboard', () => {
  it('rejects our own domains', async () => {
    const res = await request(app)
      .post('/companies/1/domains')
      .set('Host', 'app.statuspage.com')
      .type('form')
      .send({ host: 'admin.statuspage.com' })
    assert.equal(res.status, 422)
    assert.match(res.text, /isn&#39;t a domain you can connect/)
  })

  it('rejects a domain another company has', async () => {
    const res = await request(app)
      .post('/companies/2/domains')
      .set('Host', 'app.statuspage.com')
      .type('form')
      .send({ host: 'Status.Intercom.com' })
    assert.equal(res.status, 422)
    assert.match(res.text, /already connected/)
  })

  it('adds, checks and removes a *.localhost domain', async () => {
    const add = await request(app)
      .post('/companies/2/domains')
      .set('Host', 'localhost')
      .type('form')
      .send({ host: 'globex.localhost' })
    assert.equal(add.status, 303)
    const domain = await prisma.customDomain.findUnique({
      where: { host: 'globex.localhost' },
    })
    assert.equal(domain.status, 'pending')

    await request(app).post(`/domains/${domain.id}/check`).set('Host', 'localhost')
    const page = await request(app).get('/').set('Host', 'globex.localhost:3000')
    assert.match(page.text, /Globex status/)

    await request(app).post(`/domains/${domain.id}/remove`).set('Host', 'localhost')
    const gone = await request(app).get('/').set('Host', 'globex.localhost')
    assert.equal(gone.status, 404)
  })
})

describe('caddy ask', () => {
  it('only approves active domains', async () => {
    const ask = (domain) =>
      request(app).get(`/caddy/ask?domain=${domain}`).set('Host', 'localhost')
    assert.equal((await ask('status.intercom.com')).status, 200)
    assert.equal((await ask('status.globex.com')).status, 404)
    assert.equal((await ask('evil.example')).status, 404)
  })
})

describe('webhooks', () => {
  const hook = (token, body) =>
    request(app)
      .post(`/webhooks/saas-domains?token=${token}`)
      .set('Host', 'app.statuspage.com')
      .send(body)

  it('needs the right token', async () => {
    const res = await hook('nope', {
      event: 'domain_dns_proxy_record_valid',
      domain: { uuid: 'uuid_globex' },
    })
    assert.equal(res.status, 401)
  })

  it('ignores events without a domain uuid', async () => {
    const res = await hook('test_webhook_token', {
      event: 'domain_dns_proxy_record_valid',
      domain: {},
    })
    assert.equal(res.status, 200)
    const globex = await prisma.customDomain.findUnique({
      where: { host: 'status.globex.com' },
    })
    assert.equal(globex.status, 'pending')
  })

  it('updates the status', async () => {
    await hook('test_webhook_token', {
      event: 'domain_dns_proxy_record_valid',
      domain: { uuid: 'uuid_globex' },
    })
    await hook('test_webhook_token', {
      event: 'tls_certificate_issued',
      domain: { uuid: 'uuid_globex' },
    })
    const globex = await prisma.customDomain.findUnique({
      where: { host: 'status.globex.com' },
    })
    assert.equal(globex.status, 'active')
    assert.equal(globex.httpsReady, true)
  })
})
