export interface CompanyParticular {
  id: number
  name: string
  company_name?: string
  company_id?: number
  transaction_type?: string
  created_at?: string
}

class ParticularsService {
  private cache: Map<string, CompanyParticular[]> = new Map()

  private getAuthHeader(): Record<string, string> {
    const token =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('mct_access_token')
        : null
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  private buildKey(companyName?: string, transactionType?: string): string {
    const comp = (companyName || '').trim().toLowerCase()
    const tx = (transactionType || 'Sales').trim().toLowerCase()
    return `${comp}::${tx}`
  }

  async getParticulars(
    companyName?: string,
    transactionType: string = 'Sales'
  ): Promise<CompanyParticular[]> {
    const key = this.buildKey(companyName, transactionType)
    if (this.cache.has(key)) {
      return this.cache.get(key) || []
    }

    try {
      const params = new URLSearchParams()
      if (companyName) params.append('company_name', companyName)
      if (transactionType) params.append('transaction_type', transactionType)
      const query = params.toString() ? `?${params.toString()}` : ''
      const url = `/api/v1/particulars${query}`

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeader(),
        },
      })

      if (res.ok) {
        const data: CompanyParticular[] = await res.json()
        this.cache.set(key, data)
        return data
      }
    } catch (err) {
      console.warn('Failed to fetch particulars from backend:', err)
    }

    return this.cache.get(key) || []
  }

  async addParticular(
    companyName: string,
    name: string,
    transactionType: string = 'Sales'
  ): Promise<CompanyParticular> {
    const trimmedName = name.trim()
    const key = this.buildKey(companyName, transactionType)

    try {
      const res = await fetch('/api/v1/particulars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeader(),
        },
        body: JSON.stringify({
          company_name: companyName,
          name: trimmedName,
          transaction_type: transactionType,
        }),
      })

      if (res.ok) {
        const created: CompanyParticular = await res.json()
        const current = this.cache.get(key) || []
        if (!current.some((p) => p.name.toLowerCase() === trimmedName.toLowerCase())) {
          this.cache.set(
            key,
            [...current, created].sort((a, b) => a.name.localeCompare(b.name))
          )
        }
        return created
      }
    } catch (err) {
      console.warn('Failed to save particular to backend:', err)
    }

    // Local fallback
    const fallbackItem: CompanyParticular = {
      id: Date.now(),
      name: trimmedName,
      company_name: companyName,
      transaction_type: transactionType,
      created_at: new Date().toISOString(),
    }
    const current = this.cache.get(key) || []
    if (!current.some((p) => p.name.toLowerCase() === trimmedName.toLowerCase())) {
      this.cache.set(
        key,
        [...current, fallbackItem].sort((a, b) => a.name.localeCompare(b.name))
      )
    }
    return fallbackItem
  }

  async deleteParticular(
    id: number,
    companyName?: string,
    transactionType?: string
  ): Promise<void> {
    const key = this.buildKey(companyName, transactionType)
    try {
      await fetch(`/api/v1/particulars/${id}`, {
        method: 'DELETE',
        headers: {
          ...this.getAuthHeader(),
        },
      })
    } catch (err) {
      console.warn('Failed to delete particular on backend:', err)
    }

    // Update cache
    const current = this.cache.get(key) || []
    this.cache.set(
      key,
      current.filter((p) => p.id !== id)
    )
  }

  invalidateCache(companyName?: string, transactionType?: string) {
    if (companyName && transactionType) {
      this.cache.delete(this.buildKey(companyName, transactionType))
    } else if (companyName) {
      this.cache.delete(this.buildKey(companyName, 'Sales'))
      this.cache.delete(this.buildKey(companyName, 'Expense'))
    } else {
      this.cache.clear()
    }
  }
}

export const particularsService = new ParticularsService()
