import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ERROR_PAGE_CONFIGS,
  DEFAULT_ERROR_CONFIG,
  getErrorPageConfig,
} from '../../config/errorConfig.ts'
import { httpErrorService } from '../../services/httpErrorService.ts'

describe('Error Page Configuration & System Spec', () => {
  it('contains valid configuration for all required status codes', () => {
    const requiredCodes = [400, 401, 403, 404, 408, 429, 500, 502, 503, 504]

    for (const code of requiredCodes) {
      const config = ERROR_PAGE_CONFIGS[code]
      assert.ok(config, `Config for status code ${code} must exist`)
      assert.equal(config.code, code)
      assert.ok(config.heading, `Heading for status code ${code} must not be empty`)
      assert.ok(config.helperText, `Helper text for status code ${code} must not be empty`)
      assert.ok(config.primaryAction, `Primary action for status code ${code} must exist`)
      assert.ok(config.primaryAction.label, `Primary action label for ${code} must exist`)
      if (config.secondaryAction) {
        assert.ok(config.secondaryAction.label, `Secondary action label for ${code} must exist`)
      }
    }
  })

  it('matches the exact status code config specification from requirements', () => {
    // 400
    const cfg400 = getErrorPageConfig(400)
    assert.equal(cfg400.variant, 'code')
    assert.equal(cfg400.heading, 'Bad request')
    assert.equal(cfg400.helperText, 'The request could not be understood. Please check and try again.')
    assert.equal(cfg400.primaryAction.label, 'Go Back')
    assert.equal(cfg400.secondaryAction?.label, 'Back to Dashboard')

    // 401
    const cfg401 = getErrorPageConfig(401)
    assert.equal(cfg401.variant, 'code')
    assert.equal(cfg401.heading, 'Session expired')
    assert.equal(cfg401.helperText, 'Please log in again to continue.')
    assert.equal(cfg401.primaryAction.label, 'Log In')
    assert.equal(cfg401.secondaryAction?.label, 'Back to Home')

    // 403
    const cfg403 = getErrorPageConfig(403)
    assert.equal(cfg403.variant, 'code')
    assert.equal(cfg403.heading, 'Access denied')
    assert.equal(
      cfg403.helperText,
      "You don't have permission to view this page. Contact your administrator if you think this is a mistake."
    )
    assert.equal(cfg403.primaryAction.label, 'Back to Dashboard')
    assert.equal(cfg403.secondaryAction?.label, 'Go Back')

    // 404
    const cfg404 = getErrorPageConfig(404)
    assert.equal(cfg404.variant, 'code')
    assert.equal(cfg404.heading, 'Page not found')
    assert.equal(
      cfg404.helperText,
      "The page you are looking for doesn't exist or another error occurred."
    )
    assert.equal(cfg404.primaryAction.label, 'Back to Dashboard')
    assert.equal(cfg404.secondaryAction?.label, 'Go Back')

    // 408
    const cfg408 = getErrorPageConfig(408)
    assert.equal(cfg408.variant, 'illustration')
    assert.equal(cfg408.heading, 'Request timed out')
    assert.equal(cfg408.helperText, 'The server took too long to respond. Please try again.')
    assert.equal(cfg408.primaryAction.label, 'Try Again')
    assert.equal(cfg408.secondaryAction?.label, 'Back to Dashboard')

    // 429
    const cfg429 = getErrorPageConfig(429)
    assert.equal(cfg429.variant, 'code')
    assert.equal(cfg429.heading, 'Too many requests')
    assert.equal(cfg429.helperText, "You've made too many requests. Please wait a moment and try again.")
    assert.equal(cfg429.primaryAction.label, 'Try Again')
    assert.equal(cfg429.secondaryAction?.label, 'Back to Dashboard')

    // 500
    const cfg500 = getErrorPageConfig(500)
    assert.equal(cfg500.variant, 'illustration')
    assert.equal(cfg500.heading, 'Something went wrong')
    assert.equal(cfg500.helperText, 'An unexpected error occurred on our end. Please try again shortly.')
    assert.equal(cfg500.primaryAction.label, 'Try Again')
    assert.equal(cfg500.secondaryAction?.label, 'Back to Dashboard')

    // 502
    const cfg502 = getErrorPageConfig(502)
    assert.equal(cfg502.variant, 'illustration')
    assert.equal(cfg502.heading, 'Bad gateway')
    assert.equal(cfg502.helperText, "We're having trouble reaching the server. Please try again in a moment.")
    assert.equal(cfg502.primaryAction.label, 'Try Again')
    assert.equal(cfg502.secondaryAction?.label, 'Back to Dashboard')

    // 503
    const cfg503 = getErrorPageConfig(503)
    assert.equal(cfg503.variant, 'illustration')
    assert.equal(cfg503.heading, 'Service unavailable')
    assert.equal(
      cfg503.helperText,
      'The system is temporarily down for maintenance or high traffic. Please try again soon.'
    )
    assert.equal(cfg503.primaryAction.label, 'Try Again')
    assert.equal(cfg503.secondaryAction?.label, 'Back to Dashboard')

    // 504
    const cfg504 = getErrorPageConfig(504)
    assert.equal(cfg504.variant, 'illustration')
    assert.equal(cfg504.heading, 'Gateway timeout')
    assert.equal(cfg504.helperText, 'The server took too long to respond. Please try again.')
    assert.equal(cfg504.primaryAction.label, 'Try Again')
    assert.equal(cfg504.secondaryAction?.label, 'Back to Dashboard')
  })

  it('correctly assigns "code" vs "illustration" variants according to error categories', () => {
    // 4xx client errors (except timeout 408) use "code"
    assert.equal(getErrorPageConfig(400).variant, 'code')
    assert.equal(getErrorPageConfig(401).variant, 'code')
    assert.equal(getErrorPageConfig(403).variant, 'code')
    assert.equal(getErrorPageConfig(404).variant, 'code')
    assert.equal(getErrorPageConfig(429).variant, 'code')

    // 5xx server errors and 408 timeout use "illustration"
    assert.equal(getErrorPageConfig(408).variant, 'illustration')
    assert.equal(getErrorPageConfig(500).variant, 'illustration')
    assert.equal(getErrorPageConfig(502).variant, 'illustration')
    assert.equal(getErrorPageConfig(503).variant, 'illustration')
    assert.equal(getErrorPageConfig(504).variant, 'illustration')
  })

  it('falls back to generic "Something went wrong" for unknown error codes', () => {
    const unknownNumeric = getErrorPageConfig(418)
    assert.equal(unknownNumeric.heading, DEFAULT_ERROR_CONFIG.heading)
    assert.equal(unknownNumeric.helperText, DEFAULT_ERROR_CONFIG.helperText)
    assert.equal(unknownNumeric.variant, 'illustration')
    assert.equal(unknownNumeric.code, 418)

    const unknownString = getErrorPageConfig('CUSTOM_ERR')
    assert.equal(unknownString.heading, DEFAULT_ERROR_CONFIG.heading)
    assert.equal(unknownString.variant, 'illustration')
    assert.equal(unknownString.code, 'CUSTOM_ERR')

    const nullCode = getErrorPageConfig(undefined)
    assert.equal(nullCode.heading, DEFAULT_ERROR_CONFIG.heading)
    assert.equal(nullCode.code, 500)
  })

  it('supports string representation of status codes', () => {
    const fromString = getErrorPageConfig('404')
    assert.equal(fromString.code, 404)
    assert.equal(fromString.heading, 'Page not found')

    const from500String = getErrorPageConfig('500')
    assert.equal(from500String.code, 500)
    assert.equal(from500String.heading, 'Something went wrong')
  })

  it('handles httpErrorService subscriptions and fatal error state', () => {
    let receivedEvent: any = null
    const unsubscribe = httpErrorService.subscribe((event) => {
      receivedEvent = event
    })

    // Fatal error dispatch
    httpErrorService.dispatch(503, { fatal: true, message: 'Database connection failed' })
    assert.ok(receivedEvent)
    assert.equal(receivedEvent.status, 503)
    assert.equal(receivedEvent.fatal, true)
    assert.equal(httpErrorService.getActiveFatalError()?.status, 503)

    // Clear fatal error
    httpErrorService.clear()
    assert.equal(receivedEvent, null)
    assert.equal(httpErrorService.getActiveFatalError(), null)

    unsubscribe()
  })
})
