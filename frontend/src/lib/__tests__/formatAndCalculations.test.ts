import { describe, it } from 'node:test'
import assert from 'node:assert'
import { formatPHP } from '../format.ts'
import { formatPersonInitialAndLastName } from '../../utils/formatUtils.ts'

describe('Format & Financial Utility Spec', () => {
  describe('formatPHP', () => {
    it('formats standard positive numbers to PHP currency', () => {
      const result = formatPHP(1250.5)
      // Normalizes non-breaking spaces if any from Intl
      const normalized = result.replace(/\u00a0/g, ' ')
      assert.ok(normalized.includes('1,250.50'), `Expected 1,250.50 in ${normalized}`)
      assert.ok(normalized.includes('₱'), `Expected ₱ symbol in ${normalized}`)
    })

    it('formats integer amounts with two decimal zeros', () => {
      const result = formatPHP(5000).replace(/\u00a0/g, ' ')
      assert.ok(result.includes('5,000.00'), `Expected 5,000.00 in ${result}`)
    })

    it('formats 0 properly as ₱0.00', () => {
      const result = formatPHP(0).replace(/\u00a0/g, ' ')
      assert.ok(result.includes('0.00'), `Expected 0.00 in ${result}`)
    })

    it('handles negative balances gracefully', () => {
      const result = formatPHP(-345.75).replace(/\u00a0/g, ' ')
      assert.ok(result.includes('345.75'), `Expected 345.75 in ${result}`)
      assert.ok(result.includes('-') || result.includes('('), `Expected negative notation in ${result}`)
    })

    it('falls back safely to ₱0.00 for NaN or invalid numbers', () => {
      assert.strictEqual(formatPHP(NaN), '₱0.00')
      assert.strictEqual(formatPHP(undefined as unknown as number), '₱0.00')
      assert.strictEqual(formatPHP(null as unknown as number), '₱0.00')
    })
  })

  describe('formatPersonInitialAndLastName', () => {
    it('formats First Last to F. Last', () => {
      assert.strictEqual(formatPersonInitialAndLastName('Virgie Masiglat'), 'V. Masiglat')
      assert.strictEqual(formatPersonInitialAndLastName('Princess Tayam'), 'P. Tayam')
    })

    it('formats multi-word names to first initial and last surname', () => {
      assert.strictEqual(formatPersonInitialAndLastName('Mary Jane Watson'), 'M. Watson')
      assert.strictEqual(formatPersonInitialAndLastName('John Fitzgerald Kennedy'), 'J. Kennedy')
    })

    it('retains single name as-is without crashing', () => {
      assert.strictEqual(formatPersonInitialAndLastName('Manuel'), 'Manuel')
      assert.strictEqual(formatPersonInitialAndLastName('Admin'), 'Admin')
    })

    it('formats known system role email addresses cleanly', () => {
      assert.strictEqual(formatPersonInitialAndLastName('audit@mct.com'), 'Audit')
      assert.strictEqual(formatPersonInitialAndLastName('admin@mct.com'), 'Admin')
      assert.strictEqual(formatPersonInitialAndLastName('finance@mct.com'), 'Finance')
      assert.strictEqual(formatPersonInitialAndLastName('supervisor@mct.com'), 'Supervisor')
    })

    it('returns em-dash for null, empty or undefined strings', () => {
      assert.strictEqual(formatPersonInitialAndLastName(''), '—')
      assert.strictEqual(formatPersonInitialAndLastName('   '), '—')
      assert.strictEqual(formatPersonInitialAndLastName(null), '—')
      assert.strictEqual(formatPersonInitialAndLastName(undefined), '—')
    })
  })
})
