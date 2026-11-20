import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getSalesDoubleEntryWarning } from '../../config/companyFeatures.ts'

describe('Sales double-entry warning for Tenant / Lending companies', () => {
  it('warns JK Property about tenant rent being counted twice', () => {
    for (const company of ['JK Property and Ventures Corporation', 'JK Property and Ventures']) {
      const msg = getSalesDoubleEntryWarning(company)
      assert.ok(msg, `Expected a warning for ${company}`)
      assert.match(msg!, /Tenants page/)
    }
  })

  it('warns FilCap about loan collections being counted twice', () => {
    for (const company of ['Filcap Prime Holdings Corp', 'FilCap Prime Holdings Corp.']) {
      const msg = getSalesDoubleEntryWarning(company)
      assert.ok(msg, `Expected a warning for ${company}`)
      assert.match(msg!, /Lending page/)
    }
  })

  it('shows no warning for other companies or All Companies', () => {
    assert.equal(getSalesDoubleEntryWarning('MCT Food Corp'), null)
    assert.equal(getSalesDoubleEntryWarning('All Companies'), null)
    assert.equal(getSalesDoubleEntryWarning(null), null)
  })
})
