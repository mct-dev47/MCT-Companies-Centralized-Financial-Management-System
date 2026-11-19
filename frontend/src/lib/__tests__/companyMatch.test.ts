import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isCompanyMatch } from '../../utils/companyUtils.ts'

describe('isCompanyMatch', () => {
  it('does not match distinct companies that only share a generic word', () => {
    assert.equal(
      isCompanyMatch('AB Property and Ventures Corporation', 'North Star Property Ventures Corporation'),
      false
    )
    assert.equal(
      isCompanyMatch('North Star Property Ventures Corporation', 'AB Property and Ventures Corporation'),
      false
    )
  })

  it('does not match distinct companies that share a prefix or single token', () => {
    assert.equal(
      isCompanyMatch('AB Property and Ventures Corporation', 'AB Global Printing Service'),
      false
    )
    assert.equal(
      isCompanyMatch('Sample Hospitality Business Corporation', 'Sample College Foundation, Incorporation'),
      false
    )
    assert.equal(
      isCompanyMatch('Acme Pharma Corporation | Branch A', 'Acme Pharma Corporation | Branch B'),
      false
    )
  })

  it('matches exact names, All Companies, and valid shorthands', () => {
    assert.equal(
      isCompanyMatch('North Star Property Ventures Corporation', 'North Star Property Ventures Corporation'),
      true
    )
    assert.equal(
      isCompanyMatch('All Companies', 'North Star Property Ventures Corporation'),
      true
    )
    assert.equal(
      isCompanyMatch('North Star Corp.', 'North Star Property Ventures Corporation'),
      true
    )
    assert.equal(
      isCompanyMatch('AB Property & Ventures', 'AB Property and Ventures Corporation'),
      true
    )
  })
})
