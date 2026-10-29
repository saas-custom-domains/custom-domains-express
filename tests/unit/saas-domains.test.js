import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, describe, it } from 'node:test'

// A stand-in for the SaaS Custom Domains API.
const calls = []
const api = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    const json = body ? JSON.parse(body) : null
    calls.push({ method: req.method, url: req.url, json })
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'POST' && json?.host === 'taken.example.com') {
      res.statusCode = 400
      return res.end('{"error":"Host has already been taken","error_code":"host_taken"}')
    }
    if (req.url.endsWith('/verify_dns_records')) {
      res.statusCode = 200
      return res.end('{"dns_status":"valid"}')
    }
    if (req.method === 'DELETE') {
      res.statusCode = 404
      return res.end('{"error":"Custom domain not found.","error_code":"not_found"}')
    }
    res.statusCode = 201
    res.end(JSON.stringify({ uuid: `domain_${calls.length}`, host: json?.host }))
  })
})

let domains, prisma, company
before(async () => {
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
  process.env.SCD_API_URL = `http://127.0.0.1:${api.address().port}`
  process.env.SCD_ACCOUNT_UUID = 'acc'
  process.env.SCD_UPSTREAM_UUID = 'up'
  // Imported after the env is set: the modules read it on load.
  domains = await import('../../src/domains.js')
  ;({ prisma } = await import('../../src/db.js'))
  company = await prisma.company.findUnique({ where: { slug: 'globex' } })
})
after(() => api.close())

describe('domains through the API', () => {
  it('registers the domain and keeps its uuid', async () => {
    const domain = await domains.addCustomDomain(company, 'status.example.com')
    assert.equal(domain.providerUuid, 'domain_1')
    assert.deepEqual(calls.at(-1).json, { host: 'status.example.com' })
  })

  it('sends instructions_recipient only when there is one', async () => {
    await domains.addCustomDomain(company, 'dns.example.com', 'it@example.com')
    assert.deepEqual(calls.at(-1).json, {
      host: 'dns.example.com',
      instructions_recipient: 'it@example.com',
    })
  })

  it("doesn't keep the row when the API rejects the domain", async () => {
    await assert.rejects(
      domains.addCustomDomain(company, 'taken.example.com'),
      /host_taken/,
    )
    const row = await prisma.customDomain.findUnique({
      where: { host: 'taken.example.com' },
    })
    assert.equal(row, null)
  })

  it('marks a domain active when the API finds its DNS records', async () => {
    const domain = await prisma.customDomain.findUnique({
      where: { host: 'status.example.com' },
    })
    assert.equal(domain.status, 'pending')
    assert.equal(await domains.checkDns(domain), 'valid')
    assert.match(calls.at(-1).url, /custom_domains\/domain_\d+\/verify_dns_records$/)
    const checked = await prisma.customDomain.findUnique({
      where: { id: domain.id },
    })
    assert.equal(checked.status, 'active')
  })

  it('treats a 404 on delete as already removed', async () => {
    const domain = await prisma.customDomain.findUnique({
      where: { host: 'status.example.com' },
    })
    await domains.removeCustomDomain(domain)
    assert.equal(calls.at(-1).method, 'DELETE')
    assert.equal(calls.at(-1).url, '/api/v1/accounts/acc/upstreams/up/custom_domains/domain_1')
    const row = await prisma.customDomain.findUnique({ where: { id: domain.id } })
    assert.equal(row, null)
  })
})
