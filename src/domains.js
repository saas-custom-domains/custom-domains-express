import { prisma } from './db.js'
import { normalizeHost } from './hosts.js'
import { saasDomains } from './saas-domains.js'

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

// Asks the API to check the DNS records right away
export async function checkDns(domain) {
  const res = await saasDomains.verifyDns(domain.providerUuid)
  if (res.dns_status === 'valid') {
    await prisma.customDomain.update({
      where: { id: domain.id },
      data: { status: 'active' },
    })
  }
  return res.dns_status // 'valid', 'pending' or 'invalid'
}

export async function removeCustomDomain(domain) {
  await saasDomains.deleteDomain(domain.providerUuid)
  await prisma.customDomain.delete({ where: { id: domain.id } })
}
