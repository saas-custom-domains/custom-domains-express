// A small client for the SaaS Custom Domains API, using the built-in
// fetch. SCD_API_URL is only set to point at the local mock.
const API_URL =
  process.env.SCD_API_URL ?? 'https://app.saascustomdomains.com'
const BASE = `${API_URL}/api/v1/accounts`

export class SaasDomainsError extends Error {
  constructor(status, detail) {
    super(`SaaS Custom Domains ${status}: ${detail}`)
    this.status = status
  }
}

function domainsPath() {
  return `upstreams/${process.env.SCD_UPSTREAM_UUID}/custom_domains`
}

async function request(method, path, body) {
  const url = `${BASE}/${process.env.SCD_ACCOUNT_UUID}/${path}`
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.SCD_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new SaasDomainsError(res.status, detail)
  }
  return res.json()
}

export const saasDomains = {
  createUpstream: (host) => request('POST', 'upstreams', { host }),
  createDomain: (host, options = {}) =>
    request('POST', domainsPath(), { host, ...options }),
  verifyDns: (uuid) =>
    request('POST', `${domainsPath()}/${uuid}/verify_dns_records`),
  async deleteDomain(uuid) {
    try {
      await request('DELETE', `${domainsPath()}/${uuid}`)
    } catch (err) {
      // Already gone, say deleted in the dashboard, is fine
      const gone = err instanceof SaasDomainsError && err.status === 404
      if (!gone) throw err
    }
  },
}
