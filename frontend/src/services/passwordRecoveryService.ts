export interface ForgotPasswordResponse {
  message: string
  success: boolean
}

export const passwordRecoveryService = {
  async requestPasswordReset(email: string): Promise<ForgotPasswordResponse> {
    const cleanEmail = (email || '').trim().toLowerCase()
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Please enter a valid email address.')
    }

    const res = await fetch('/api/v1/auth/forgot-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: cleanEmail }),
    })

    const data = await res.json()
    if (!res.ok) {
      throw new Error(data.detail || 'Unable to request password reset. Please try again later.')
    }

    return data
  },

  // Backward compatibility alias for any existing callers
  async requestCode(email: string): Promise<{ success: boolean; expiresIn: number }> {
    await this.requestPasswordReset(email)
    return { success: true, expiresIn: 1800 }
  },
}
