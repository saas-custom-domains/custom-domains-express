// One-off: register your app with SaaS Custom Domains.
//   node --env-file=.env scripts/create-upstream.js app.statuspage.com
// Copy the uuid into SCD_UPSTREAM_UUID and auth_token into PROXY_AUTH_TOKEN.
import { saasDomains } from '../src/saas-domains.js'

const host = process.argv[2] ?? 'app.statuspage.com'
console.log(await saasDomains.createUpstream(host))
