import { resolve4, resolveCname } from 'node:dns/promises'

// Only used when you run the proxy yourself (DOMAINS_PROVIDER=caddy).
// With SaaS Custom Domains, the API checks DNS for you.
const CNAME_TARGET = process.env.CNAME_TARGET ?? 'in.statuspage.com'
const OUR_IPS = new Set(
  (process.env.SERVER_IPS ?? '').split(',').filter(Boolean),
)

async function lookup(resolve, host) {
  try {
    return await resolve(host)
  } catch {
    return []
  }
}

export async function pointsToUs(host) {
  // Browsers and curl resolve *.localhost to this machine
  if (host.endsWith('.localhost')) return true

  const cnames = await lookup(resolveCname, host)
  if (cnames.some((name) => name.toLowerCase() === CNAME_TARGET)) {
    return true
  }
  const ips = await lookup(resolve4, host)
  return ips.some((ip) => OUR_IPS.has(ip))
}
