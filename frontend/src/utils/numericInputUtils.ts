/**
 * Utility functions for numeric and currency input handling
 */

/**
 * Sanitizes numeric input strings for currency and balance fields.
 *
 * Replaces unintended leading zeros before whole digits while preserving
 * lone zero and decimal sequences starting with zero.
 *
 * @param value Raw string or number input
 * @returns Clean numeric string suitable for controlled input value state
 */
export function sanitizeNumericInput(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value).trim()
  if (str === '') return ''

  // Strip all characters except digits and decimal point
  let cleaned = str.replace(/[^0-9.]/g, '')

  // Prevent multiple decimal points and restrict to two decimal places
  const dotIndex = cleaned.indexOf('.')
  if (dotIndex !== -1) {
    const integerPart = cleaned.slice(0, dotIndex)
    const decimalPart = cleaned.slice(dotIndex + 1).replace(/\./g, '').slice(0, 2)
    cleaned = `${integerPart}.${decimalPart}`
  }

  // Prepend zero if input begins with decimal point
  if (cleaned.startsWith('.')) {
    cleaned = `0${cleaned}`
  }

  // Preserve lone zero
  if (cleaned === '0') {
    return '0'
  }

  // Preserve decimals starting with zero (such as 0., 0.0, 0.05, 0.50)
  if (/^0\./.test(cleaned)) {
    return cleaned
  }

  // Normalize multiple leading zeros before decimal point
  if (/^0+\./.test(cleaned)) {
    return cleaned.replace(/^0+/, '0')
  }

  // Replace leading zeros before whole digits (such as 0100 to 100, 05 to 5)
  if (/^0+[1-9]/.test(cleaned)) {
    return cleaned.replace(/^0+/, '')
  }

  // Collapse consecutive zeros without decimals to single zero
  if (/^0+$/.test(cleaned)) {
    return '0'
  }

  return cleaned
}

