export function formatPHP(
  amount: number,
  options?: Intl.NumberFormatOptions
): string {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return '₱0.00'
  }
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  }).format(amount)
}
