export interface CompanyPaymentMethod {
  id: number
  name: string
  company_name?: string
  company_id?: number
  created_at?: string
}

class PaymentMethodService {
  private cache: Map<string, CompanyPaymentMethod[]> = new Map()

  private getAuthHeader(): Record<string, string> {
    const token =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('mct_access_token')
        : null
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async getPaymentMethods(companyName?: string): Promise<CompanyPaymentMethod[]> {
    const key = (companyName || '').trim().toLowerCase()
    if (this.cache.has(key)) {
      return this.cache.get(key) || []
    }

    try {
      const url = companyName
        ? `/api/v1/payment-methods?company_name=${encodeURIComponent(companyName)}`
        : '/api/v1/payment-methods'

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeader(),
        },
      })

      if (res.ok) {
        const data: CompanyPaymentMethod[] = await res.json()
        this.cache.set(key, data)
        return data
      }
    } catch (err) {
      console.warn('Failed to fetch payment methods from backend:', err)
    }

    return this.cache.get(key) || []
  }

  async addPaymentMethod(companyName: string, name: string): Promise<CompanyPaymentMethod> {
    const trimmedName = name.trim()
    const key = (companyName || '').trim().toLowerCase()

    try {
      const res = await fetch('/api/v1/payment-methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeader(),
        },
        body: JSON.stringify({
          company_name: companyName,
          name: trimmedName,
        }),
      })

      if (res.ok) {
        const created: CompanyPaymentMethod = await res.json()
        const current = this.cache.get(key) || []
        if (!current.some((p) => p.name.toLowerCase() === trimmedName.toLowerCase())) {
          this.cache.set(key, [...current, created].sort((a, b) => a.name.localeCompare(b.name)))
        }
        return created
      }
    } catch (err) {
      console.warn('Failed to save payment method to backend:', err)
    }

    // Local fallback
    const fallbackItem: CompanyPaymentMethod = {
      id: Date.now(),
      name: trimmedName,
      company_name: companyName,
      created_at: new Date().toISOString(),
    }
    const current = this.cache.get(key) || []
    if (!current.some((p) => p.name.toLowerCase() === trimmedName.toLowerCase())) {
      this.cache.set(key, [...current, fallbackItem].sort((a, b) => a.name.localeCompare(b.name)))
    }
    return fallbackItem
  }

  async deletePaymentMethod(id: number, companyName?: string): Promise<void> {
    const key = (companyName || '').trim().toLowerCase()
    try {
      await fetch(`/api/v1/payment-methods/${id}`, {
        method: 'DELETE',
        headers: {
          ...this.getAuthHeader(),
        },
      })
    } catch (err) {
      console.warn('Failed to delete payment method on backend:', err)
    }

    const current = this.cache.get(key) || []
    this.cache.set(
      key,
      current.filter((p) => p.id !== id)
    )
  }

  invalidateCache(companyName?: string) {
    if (companyName) {
      this.cache.delete(companyName.trim().toLowerCase())
    } else {
      this.cache.clear()
    }
  }
}

export const paymentMethodService = new PaymentMethodService()

