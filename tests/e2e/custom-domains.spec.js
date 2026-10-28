import { expect, test } from '@playwright/test'

// Customer domains go through the mock proxy (see playwright.config.js).
const customerUrl = (host, path = '/') => `http://${host}${path}`

test('connect a domain, serve the status page through the proxy, remove it', async ({
  page,
}) => {
  const host = `intercom-${Date.now()}.test`
  const company = page.getByTestId('company-intercom')

  await page.goto('/')
  await company.getByLabel('Domain').fill(host)
  await company.getByLabel('DNS contact email').fill('it@intercom.test')
  await company.getByRole('button', { name: 'Add domain' }).click()
  const row = page.getByTestId(`domain-${host}`)
  await expect(row).toContainText('Waiting for DNS')

  // The mock marks *.test as pointed after ~2s and sends webhooks.
  await expect(async () => {
    await page.reload()
    await expect(row).toContainText('Live')
  }).toPass({ timeout: 15_000 })

  await page.goto(customerUrl(host))
  await expect(
    page.getByRole('heading', { name: 'Intercom status' }),
  ).toBeVisible()
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
    'href',
    `https://${host}/`,
  )

  // A form on the custom domain, through the proxy. The redirect after
  // it keeps the visitor on the custom domain.
  await page.getByLabel('Email').fill('reader@example.com')
  await page.getByRole('button', { name: 'Get updates' }).click()
  await expect(page.getByRole('status')).toHaveText(
    'Subscribed to Intercom status updates.',
  )
  expect(new URL(page.url()).host).toBe(host)

  // Your app's routes don't exist on a customer's domain.
  const caddyAsk = await page.goto(customerUrl(host, '/caddy/ask'))
  expect(caddyAsk?.status()).toBe(404)

  await page.goto('/')
  await row.getByRole('button', { name: 'Remove' }).click()
  await expect(row).toBeHidden()
  const gone = await page.goto(customerUrl(host))
  expect(gone?.status()).toBe(404)
})

test('a domain that does not point at us stays pending', async ({ page }) => {
  const host = `status-${Date.now()}.example.com`
  const company = page.getByTestId('company-globex')

  await page.goto('/')
  await company.getByLabel('Domain').fill(host)
  await company.getByRole('button', { name: 'Add domain' }).click()
  const row = page.getByTestId(`domain-${host}`)
  await row.getByRole('button', { name: 'Check DNS' }).click()
  await expect(row).toContainText('Waiting for DNS')

  await row.getByRole('button', { name: 'Remove' }).click()
  await expect(row).toBeHidden()
})

test('rejects our own domains', async ({ page }) => {
  const company = page.getByTestId('company-intercom')
  await page.goto('/')
  await company.getByLabel('Domain').fill('admin.statuspage.com')
  await company.getByRole('button', { name: 'Add domain' }).click()
  await expect(company.getByRole('alert')).toHaveText(
    '"admin.statuspage.com" isn\'t a domain you can connect.',
  )
})

test('requests that skip the proxy cannot claim a domain', async ({
  request,
}) => {
  const spoofed = await request.get('/', {
    headers: { 'X-Served-For': 'intercom.test' },
  })
  expect(spoofed.status()).toBe(403)

  const wrongToken = await request.get('/', {
    headers: {
      'X-Served-For': 'intercom.test',
      'X-SaaS-Domains-Auth-Token': 'guess',
    },
  })
  expect(wrongToken.status()).toBe(403)
})

test('X-Forwarded-Host from a client does not pick the tenant', async ({
  page,
  request,
}) => {
  const host = `xfh-${Date.now()}.test`
  const company = page.getByTestId('company-intercom')
  await page.goto('/')
  await company.getByLabel('Domain').fill(host)
  await company.getByRole('button', { name: 'Add domain' }).click()
  const row = page.getByTestId(`domain-${host}`)
  await expect(async () => {
    await page.reload()
    await expect(row).toContainText('Live')
  }).toPass({ timeout: 15_000 })

  const res = await request.get('/', { headers: { 'X-Forwarded-Host': host } })
  expect(await res.text()).toContain('<h1>Status pages</h1>')

  await row.getByRole('button', { name: 'Remove' }).click()
  await expect(row).toBeHidden()
})

test('webhooks need the right token', async ({ request }) => {
  const res = await request.post('/webhooks/saas-domains?token=x', {
    data: { event: 'domain_dns_proxy_record_valid', domain: { uuid: 'x' } },
  })
  expect(res.status()).toBe(401)
})

test('unknown domains get a 404', async ({ page }) => {
  const res = await page.goto(customerUrl('unknown.test'))
  expect(res?.status()).toBe(404)
})

test('health check answers on any host', async ({ request }) => {
  const res = await request.get('/up', { headers: { Host: '10.0.0.12' } })
  expect(res.status()).toBe(200)
})
