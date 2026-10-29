# Custom domains in Express

An example Express 5 app where each customer connects their own domain. It's a small status page product: every company gets a status page, and can serve it on `status.theircompany.com` instead of yours.

It goes with the guide [How to Add Custom Domains to a Node.js App](https://saascustomdomains.com/blog/posts/implementing-custom-domains-for-your-saas-app-in-node-js).

What's in it:

- One middleware, `customDomains`, finds the company from the request's hostname and hands customer domains to their own router. Unknown and unverified domains get a 404, and your dashboard is never reachable on a customer's domain.
- Requests from the [SaaS Custom Domains](https://saascustomdomains.com) proxy are accepted only with the upstream's auth token, so nobody can claim a customer's domain by sending `X-Served-For` themselves.
- A subscribe form on each status page that works on the customer's domain, with an `Origin` check against that domain.
- A dashboard to add a domain, check its DNS and remove it. Webhooks update the status.
- HTTPS for every customer domain through SaaS Custom Domains, which issues and renews the certificates.
- Prisma with SQLite, so it runs in one container.

## Run it in 2 minutes

You need Docker.

```bash
git clone https://github.com/saas-custom-domains/custom-domains-express
cd custom-domains-express
docker compose up --build
```

1. Open http://localhost:3000 and add `intercom.localhost` to Intercom.
2. Within a few seconds the status changes to **Live**: the mock API "found" the DNS records and sent a webhook.
3. Open http://intercom.localhost. The request goes through the mock proxy on port 80, exactly like a real customer domain goes through SaaS Custom Domains, and you see Intercom's status page. Try the subscribe form.

`*.localhost` always resolves to your own machine in Chrome, Firefox, Safari and curl, so there's nothing to add to `/etc/hosts`.

The mock is [scd-mock](https://github.com/saas-custom-domains/scd-mock): a local copy of the SaaS Custom Domains API and proxy, so you can try everything without an account.

### Run the app outside Docker

Node.js 22.18 or later. Keep the mock in Docker and point it at your machine:

```bash
npm install            # also runs prisma generate
cp .env.example .env
npm run db:setup       # migrations + two example companies
SCD_MOCK_UPSTREAM_HOST=host.docker.internal \
SCD_MOCK_WEBHOOK_URL=http://host.docker.internal:3000/webhooks/saas-domains \
  docker compose up scd-mock
npm run dev            # in another terminal
```

Add `intercom.localhost` at http://localhost:3000 and open http://intercom.localhost (port 80 is the mock proxy). `APP_HOSTS` in `.env.example` includes `host.docker.internal`, because that's the `Host` the mock's webhooks arrive with.

## How it works

```
Browser ── status.intercom.com ──▶ SaaS Custom Domains ──▶ your Express app
                                   (TLS certificate,       Host: app.statuspage.com
                                    proxy)                 X-Served-For: status.intercom.com
                                                           X-SaaS-Domains-Auth-Token: …
```

The proxy sends your app's own hostname in `Host` and `X-Forwarded-Host`, so your hosting platform routes the request like any other. The customer's domain comes separately, in `X-Served-For`.

| File | What it does |
| --- | --- |
| `src/app.js` | Health check, the proxy token check, then `customDomains`, then your app's routes |
| `src/custom-domains.js` | `hostFrom()`, the company lookup and the customer-facing router |
| `src/routes.js` | Dashboard and webhook endpoint |
| `src/domains.js` | Add, check and remove domains through the API |
| `src/saas-domains.js` | API client for SaaS Custom Domains (built-in `fetch`) |
| `src/hosts.js` | `normalizeHost()` and the domains customers can't claim |
| `prisma/schema.prisma` | `Company`, `CustomDomain` (unique `host`), components, subscribers |
| `scripts/create-upstream.js` | One-off: register your app with SaaS Custom Domains |

`hostFrom()` is the only function that reads the hostname: `X-Served-For` if the request came through the proxy (the token check has run by then), otherwise `req.hostname`.

## Express gotchas

### `trust proxy` set to `true`

With `app.set('trust proxy', true)`, `req.hostname` comes from `X-Forwarded-Host`, and Express trusts it from any client. When you pick the tenant by hostname, that means a request can choose its tenant with one header, past anything in front of you that routes or caches by `Host`. Express only checks the address of the connection, so a hop count such as `1` has the same effect when clients can reach the app directly.

This app sets `trust proxy` from `TRUST_PROXY`, default `loopback`; set it to your load balancer's address or subnet. `tests/unit/app.test.js` shows `true` letting a client switch tenants, and the end-to-end tests check that a direct `X-Forwarded-Host` doesn't.

### Secure cookies that never get set

`express-session` with `cookie: { secure: true }` sends no `Set-Cookie` at all when `req.secure` is `false`, and `req.secure` is `false` behind a TLS-terminating proxy you don't trust. There's no error; only `DEBUG=express-session` prints `not secured`. Trust the proxy that terminates TLS for you (your load balancer), not every client. `tests/unit/express-gotchas.test.js` covers both cases.

Leave the cookie's `domain` unset. A cookie with `domain: '.statuspage.com'` set on `status.intercom.com` is dropped by the browser without a word (checked in Chromium). Host-only cookies work on every customer domain.

### Things that need the customer's domain

If your app needs the customer's domain for something, take it from the company lookup (`req.customDomain`), not from `Host`:

- Origin checks on forms: `POST /subscribe` compares the browser's `Origin` with the customer's domain. A check against `req.get('host')` would reject every real submission behind the proxy, because `Host` is your own hostname there.
- Absolute URLs: the canonical link is built from the customer's domain. `${req.protocol}://${req.get('host')}` would point at your app.
- Redirects: `res.redirect(303, '/?subscribed=1')` sends a relative `Location`, so visitors stay on the customer's domain.

(SaaS Custom Domains can also put the customer's domain in `X-Forwarded-Host` for your account if you ask support, but this app doesn't need it.)

### Health checks and webhooks hit the host check

Load balancers call the health check by IP address, and anything that isn't one of your hosts is a customer domain, so `/up` would get `404 Unknown domain`. It's registered before `customDomains`. In the same way, `APP_HOSTS` has to list every hostname your own traffic arrives on: in `compose.yaml` that's `app`, because webhooks from the mock arrive as `Host: app:3000`.

### Smaller ones

- `req.hostname` is `undefined` for an HTTP/1.0 request without a `Host` header, so `req.hostname.toLowerCase()` throws `TypeError: Cannot read properties of undefined (reading 'toLowerCase')`. `hostFrom()` falls back to `''`.
- Express 5 leaves `req.body` `undefined` when no parser matched, so `req.body.event` throws on a webhook with the wrong content type. Use `req.body?.event`.
- `String(undefined)` is `"undefined"`: a token check against an unset environment variable accepts the token `undefined`. `safeEqual()` rejects everything when the secret is unset.
- Prisma treats `where: { providerUuid: undefined }` as no filter, so `updateMany` on a webhook without a domain UUID would update every domain. The webhook handler checks the UUID first.
- `domainToASCII()` lowercases and converts to punycode, but accepts `-acme.com`, `192.0.2.1` and labels over 63 characters, and turns `1.2.3` into `1.2.0.3`. `normalizeHost()` validates each label too.

## Use it with your SaaS Custom Domains account

1. [Create an API token](https://app.saascustomdomains.com/api_tokens) and copy your account UUID.
2. Register your deployed app as an upstream: `node --env-file=.env scripts/create-upstream.js app.yourproduct.com`.
3. Set the environment variables from `.env.example`: `SCD_API_TOKEN`, `SCD_ACCOUNT_UUID`, `SCD_UPSTREAM_UUID`, `PROXY_AUTH_TOKEN` (the upstream's `auth_token`), `SCD_WEBHOOK_TOKEN` (from the webhook you create in the dashboard, pointing at `/webhooks/saas-domains`), `APP_HOSTS`, `APP_DOMAIN` and `TRUST_PROXY`.
4. Remove `SCD_API_URL` so the client talks to the real API.

Your customers point a CNAME at `in.saascustomdomains.com` (or A records at our two static IPs for a root domain). See the [docs](https://docs.saascustomdomains.com).

## Tests

```bash
npm test                       # unit tests (node:test + supertest)
docker compose up -d --build --wait
npx playwright install chromium
npm run test:e2e               # end to end, through the mock proxy
```

The end-to-end tests use `*.test` domains and send the browser's requests for them to the mock proxy, so nothing depends on DNS or on port 80, and `Host` and `Origin` look like production. To run a second stack side by side, set `APP_PORT`, `SCD_MOCK_API_PORT` and `SCD_MOCK_PROXY_PORT` for both `docker compose` and `npm run test:e2e`.

CI runs both on every push and once a week, so a new Express, Prisma or Node.js release that breaks something shows up here first.

## Tested with

| | Version |
| --- | --- |
| Express | 5.3.0 |
| Prisma | 7.10.1 |
| EJS | 7.0.2 |
| Node.js | 24 (also 26) |

Last checked: 2026-10-28.

## Not production-ready on purpose

There's no login. In your app, check in every dashboard route that the signed-in user owns the company and the domain. SQLite keeps the example to one container; for Postgres, swap the Prisma adapter for `@prisma/adapter-pg` and the queries stay the same. Call the SaaS Custom Domains API from a background job if you don't want a slow API call to hold up the request.

## License

MIT
