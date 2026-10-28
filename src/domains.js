import { prisma } from './db.js'
import { pointsToUs } from './dns-check.js'
import { normalizeHost } from './hosts.js'
import { saasDomains } from './saas-domains.js'

// "saascustomdomains" (the default) or "caddy" if you run the proxy.
const managed =
  (process.env.DOMAINS_PROVIDER ?? 'saascustomdomains') === 'saascustomdomains'

// A problem the user can fix, shown next to the form.
export class DomainError extends Error {}

export async function addCustomDomain(
  company,
  input,
  dnsContact = company.dnsContactEmail,
) {
  const host = normalizeHost(input)
  if (!host) throw new DomainError(`"${input}" isn't a domain you can connect.`)

  let domain
  try {
    domain = await prisma.customDomain.create({
      data: { host, companyId: company.id },
    })
  } catch (err) {
    // The unique index on host: another company already has it.
    if (err.code === 'P2002') {
      throw new DomainError(`${host} is already connected to a status page.`)
    }
    throw err
  }
  if (!managed) return domain

  try {
    const created = await saasDomains.createDomain(host, {
      // Whoever manages their DNS gets step-by-step instructions
      ...(dnsContact && { instructions_recipient: dnsContact }),
    })
    return await prisma.customDomain.update({
      where: { id: domain.id },
      data: { providerUuid: created.uuid },
    })
  } catch (err) {
    // Don't keep a row the proxy doesn't know about, or the customer
    // can never add this domain again (the host is unique).
    await prisma.customDomain.delete({ where: { id: domain.id } })
    throw err
  }
}

// Returns 'valid', 'pending' or 'invalid'.
export async function checkDns(domain) {
  let dnsStatus
  if (managed && domain.providerUuid) {
    const res = await saasDomains.verifyDns(domain.providerUuid)
    dnsStatus = res.dns_status
  } else {
    dnsStatus = (await pointsToUs(domain.host)) ? 'valid' : 'invalid'
  }
  if (dnsStatus === 'valid') {
    await prisma.customDomain.update({
      where: { id: domain.id },
      // With your own Caddy, the certificate is issued on the first
      // HTTPS request, so there's no separate "HTTPS ready" event.
      data: { status: 'active', ...(!managed && { httpsReady: true }) },
    })
  }
  return dnsStatus
}

// The proxy first, your database second: if the API call fails, the
// row is still there and you can try again.
export async function removeCustomDomain(domain) {
  if (managed && domain.providerUuid) {
    await saasDomains.deleteDomain(domain.providerUuid)
  }
  await prisma.customDomain.delete({ where: { id: domain.id } })
}
