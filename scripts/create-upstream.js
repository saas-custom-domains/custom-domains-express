// Run once: node --env-file=.env scripts/create-upstream.js <host>
// Copy uuid into SCD_UPSTREAM_UUID, auth_token into PROXY_AUTH_TOKEN.
import { saasDomains } from '../src/saas-domains.js'

const host = process.argv[2] ?? 'app.statuspage.com'
console.log(await saasDomains.createUpstream(host))
