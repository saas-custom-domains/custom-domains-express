import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeHost } from '../../src/hosts.js'
import { safeEqual } from '../../src/safe-equal.js'

describe('normalizeHost', () => {
  it('lowercases, drops the trailing dot and converts to punycode', () => {
    assert.equal(normalizeHost(' Status.Intercom.COM. '), 'status.intercom.com')
    assert.equal(normalizeHost('bücher.example'), 'xn--bcher-kva.example')
  })

  for (const input of [
    'intercom',
    'status.intercom.com:443',
    'https://status.intercom.com',
    'exa mple.com',
    'a..com',
    '-acme.com',
    'acme-.com',
    'under_score.com',
    '*.intercom.com',
    '192.0.2.1',
    '1.2.3',
    `${'a'.repeat(64)}.com`,
  ]) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      assert.equal(normalizeHost(input), null)
    })
  }

  it('rejects our own domains', () => {
    assert.equal(normalizeHost('statuspage.com'), null)
    assert.equal(normalizeHost('admin.statuspage.com'), null)
    assert.equal(normalizeHost('app.statuspage.com'), null)
    assert.equal(normalizeHost('notstatuspage.com'), 'notstatuspage.com')
  })
})

describe('safeEqual', () => {
  it('compares strings of any length', () => {
    assert.equal(safeEqual('abc', 'abc'), true)
    assert.equal(safeEqual('abd', 'abc'), false)
    assert.equal(safeEqual('ab', 'abc'), false)
    assert.equal(safeEqual(undefined, 'abc'), false)
  })

  it('never matches when the secret is unset', () => {
    // Without the check, String(undefined) makes "undefined" the token.
    assert.equal(safeEqual('undefined', undefined), false)
    assert.equal(safeEqual('', ''), false)
  })
})
