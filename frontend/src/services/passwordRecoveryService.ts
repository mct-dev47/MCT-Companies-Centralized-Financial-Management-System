export const OTP_TTL_SECONDS = 180

export interface RequestCodeResponse {
  success: boolean
  expiresIn: number
}

export interface VerifyCodeResponse {
  resetToken: string
}

export interface ResetPasswordResponse {
  success: boolean
}

export const passwordRecoveryService = {
  async requestCode(email: string): Promise<RequestCodeResponse> {
    await new Promise((resolve) => setTimeout(resolve, 700))

    if (!email || !email.includes('@')) {
      throw new Error('Please enter a valid email address.')
    }

    return {
      success: true,
      expiresIn: OTP_TTL_SECONDS,
    }
  },

  async verifyCode(_email: string, code: string): Promise<VerifyCodeResponse> {
    await new Promise((resolve) => setTimeout(resolve, 600))

    // Simulate rejection for '0000' to test invalid OTP state
    if (code === '0000') {
      throw new Error('Invalid verification code. Please try again.')
    }

    if (code.length !== 4) {
      throw new Error('Code must be 4 digits.')
    }

    return {
      resetToken: `rtk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    }
  },

  async resendCode(_email: string): Promise<RequestCodeResponse> {
    await new Promise((resolve) => setTimeout(resolve, 700))

    return {
      success: true,
      expiresIn: OTP_TTL_SECONDS,
    }
  },

  async resetPassword(
    resetToken: string,
    newPassword: string
  ): Promise<ResetPasswordResponse> {
    await new Promise((resolve) => setTimeout(resolve, 800))

    if (!resetToken || !resetToken.startsWith('rtk_')) {
      throw new Error('Invalid or expired reset session. Please request a new code.')
    }

    if (!newPassword || newPassword.length < 8) {
      throw new Error('Password does not meet security requirements.')
    }

    return {
      success: true,
    }
  },
}
