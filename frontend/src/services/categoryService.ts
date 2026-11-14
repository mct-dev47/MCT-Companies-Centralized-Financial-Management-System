export interface CompanyCategory {
  category_id: number
  company_id: number
  company_name?: string
  category_type: 'sales' | 'expense'
  name: string
  description?: string
  created_at?: string
  updated_at?: string
}

class CategoryService {
  private cache: Map<string, CompanyCategory[]> = new Map()

  private getAuthHeader(): Record<string, string> {
    const token =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('mct_access_token')
        : null
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  private buildKey(companyName?: string, categoryType?: string): string {
    const comp = (companyName || '').trim().toLowerCase()
    const type = (categoryType || 'sales').trim().toLowerCase()
    return `${comp}::${type}`
  }

  invalidateCache(companyName?: string, categoryType?: string): void {
    if (companyName && categoryType) {
      this.cache.delete(this.buildKey(companyName, categoryType))
    } else if (companyName) {
      const comp = companyName.trim().toLowerCase()
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${comp}::`)) {
          this.cache.delete(key)
        }
      }
    } else {
      this.cache.clear()
    }
  }

  async getCompanyCategories(
    companyName: string,
    categoryType: 'sales' | 'expense',
    options?: { forceRefresh?: boolean }
  ): Promise<CompanyCategory[]> {
    if (!companyName || companyName === 'All Companies') return []
    const key = this.buildKey(companyName, categoryType)
    if (!options?.forceRefresh && this.cache.has(key)) {
      return this.cache.get(key) || []
    }

    try {
      const params = new URLSearchParams()
      params.append('company_name', companyName)
      params.append('category_type', categoryType)
      const url = `/api/v1/categories?${params.toString()}`

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeader(),
        },
      })

      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          const list: CompanyCategory[] = data.map((item: any) => ({
            category_id: item.category_id,
            company_id: item.company_id,
            company_name: item.company_name || companyName,
            category_type: (item.category_type || categoryType).toLowerCase() as 'sales' | 'expense',
            name: item.name,
            description: item.description,
            created_at: item.created_at,
            updated_at: item.updated_at,
          }))
          this.cache.set(key, list)
          return list
        }
      }
      return []
    } catch (err) {
      console.warn('Failed to fetch categories:', err)
      return this.cache.get(key) || []
    }
  }

  async createCompanyCategory(
    companyName: string,
    categoryType: 'sales' | 'expense',
    name: string,
    description?: string
  ): Promise<CompanyCategory> {
    const cleaned = name.trim()
    if (!cleaned) throw new Error('Category name cannot be empty')

    const res = await fetch('/api/v1/categories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeader(),
      },
      body: JSON.stringify({
        company_name: companyName,
        category_type: categoryType,
        name: cleaned,
        description: description || undefined,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Failed to create category')
    }

    const created: CompanyCategory = await res.json()
    this.invalidateCache(companyName, categoryType)
    return created
  }

  async updateCompanyCategory(
    categoryId: number,
    name: string,
    companyName?: string,
    categoryType?: 'sales' | 'expense',
    description?: string
  ): Promise<CompanyCategory> {
    const cleaned = name.trim()
    if (!cleaned) throw new Error('Category name cannot be empty')

    const res = await fetch(`/api/v1/categories/${categoryId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeader(),
      },
      body: JSON.stringify({
        name: cleaned,
        description: description !== undefined ? description : undefined,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Failed to update category')
    }

    const updated: CompanyCategory = await res.json()
    this.invalidateCache(companyName, categoryType)
    return updated
  }

  async deleteCompanyCategory(
    categoryId: number,
    companyName?: string,
    categoryType?: 'sales' | 'expense'
  ): Promise<void> {
    const res = await fetch(`/api/v1/categories/${categoryId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeader(),
      },
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Failed to delete category')
    }

    this.invalidateCache(companyName, categoryType)
  }
}

export const categoryService = new CategoryService()

