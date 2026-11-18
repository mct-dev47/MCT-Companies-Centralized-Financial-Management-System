import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isSalesEnabledCompany,
  isSalesBlockedForCompany,
} from '../../config/companyFeatures.ts'

describe('Company-specific Sales page visibility and route guard', () => {
  const restrictedCompanies = [
    'JK Property and Ventures Corporation',
    'JK Property and Ventures',
    'Filcap Prime Holdings Corp',
    'FilCap Prime Holdings Corp.',
  ]

  const nonAdminRoles = [
    'Finance',
    'Supervisor',
    'Audit',
    'Auditor',
    'Owner',
    'Company',
  ]

  it('disables Sales for JK Property and FilCap companies', () => {
    for (const company of restrictedCompanies) {
      assert.equal(isSalesEnabledCompany(company), false)
    }
  })

  it('enables Sales for other companies and All Companies', () => {
    assert.equal(isSalesEnabledCompany('MCT Food Corp'), true)
    assert.equal(isSalesEnabledCompany('All Companies'), true)
    assert.equal(isSalesEnabledCompany(null), true)
  })

  it('blocks all non-admin roles from Sales when active company is JK Property or FilCap', () => {
    for (const role of nonAdminRoles) {
      for (const company of restrictedCompanies) {
        assert.equal(
          isSalesBlockedForCompany(role, company, 'All Companies'),
          true,
          `Expected ${role} to be blocked from Sales for ${company}`
        )
      }
    }
  })

  it('blocks all non-admin roles from Sales when assigned company is JK Property or FilCap and activeCompany is empty', () => {
    for (const role of nonAdminRoles) {
      for (const company of restrictedCompanies) {
        assert.equal(
          isSalesBlockedForCompany(role, '', company),
          true,
          `Expected ${role} to be blocked from Sales for assigned company ${company}`
        )
      }
    }
  })

  it('does not block non-admin roles when active company is All Companies or another company', () => {
    for (const role of nonAdminRoles) {
      assert.equal(isSalesBlockedForCompany(role, 'All Companies', 'All Companies'), false)
      assert.equal(isSalesBlockedForCompany(role, 'MCT Food Corp', 'JK Property and Ventures Corporation'), false)
    }
  })
})
