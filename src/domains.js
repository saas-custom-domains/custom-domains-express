import { prisma } from './db.js'
import { pointsToUs } from './dns-check.js'
import { normalizeHost } from './hosts.js'
import { saasDomains } from './saas-domains.js'

// "saascustomdomains" (the default), or "caddy" if you run the proxy
const provider = process.env.DOMAINS_PROVIDER ?? 'saascustomdomains'
const managed = provider === 'saascustomdomains'

// A problem the user can fix, shown next to the form
export class DomainError extends Error {}

export async function addCustomDomain(
  company,
  input,
  dnsContact = company.dnsContactEmail,
) {
  const host = normalizeHost(input)
  if (!host) {
    throw new DomainError(`"${input}" isn't a domain you can connect.`)
  }

  let domain
  try {
    domain = await prisma.customDomain.create({
      data: { host, companyId: company.id },
    })
  } catch (err) {
    // The unique index on host: another company already has it
    if (err.code !== 'P2002') throw err
    throw new DomainError(`${host} is already connected.`)
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
    // Don't keep a row the proxy doesn't know about: the host is
    // unique, so the customer could never add this domain again
    await prisma.customDomain.delete({ where: { id: domain.id } })
    throw err
  }
}

export async function checkDns(domain) {
  let dnsStatus // 'valid', 'pending' or 'invalid'
  if (managed && domain.providerUuid) {
    const res = await saasDomains.verifyDns(domain.providerUuid)
    dnsStatus = res.dns_status
  } else {
    const ok = await pointsToUs(domain.host)
    dnsStatus = ok ? 'valid' : 'invalid'
  }
  if (dnsStatus === 'valid') {
    await prisma.customDomain.update({
      where: { id: domain.id },
      // Your own Caddy issues the certificate on the first request
      data: { status: 'active', ...(!managed && { httpsReady: true }) },
    })
  }
  return dnsStatus
}

export async function removeCustomDomain(domain) {
  if (managed && domain.providerUuid) {
    await saasDomains.deleteDomain(domain.providerUuid)
  }
  await prisma.customDomain.delete({ where: { id: domain.id } })
}
