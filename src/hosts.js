import { domainToASCII } from 'node:url'

// Every hostname your own traffic arrives on, including internal
// names your platform, webhooks or Caddy use to reach the app.
export const APP_HOSTS = new Set(
  (process.env.APP_HOSTS ?? 'localhost')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
)

// Customers can't claim this domain or any subdomain of it
const APP_DOMAIN = process.env.APP_DOMAIN ?? 'statuspage.com'

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

export function normalizeHost(input) {
  const host = domainToASCII(String(input).trim().replace(/\.$/, ''))
  const labels = host.split('.')
  const valid =
    host.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => LABEL.test(label)) &&
    // domainToASCII turns "1.2.3" into "1.2.0.3"; IPs aren't domains
    !/^\d+$/.test(labels.at(-1))
  if (!valid) return null

  // Don't let customers claim admin.statuspage.com
  const ours =
    APP_HOSTS.has(host) ||
    host === APP_DOMAIN ||
    host.endsWith(`.${APP_DOMAIN}`)
  if (ours) return null

  return host
}
