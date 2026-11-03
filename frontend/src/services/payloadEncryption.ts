const encoder = new TextEncoder()

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_')
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export async function encryptPayload(payload: Record<string, unknown>): Promise<string> {
  const configuredKey = import.meta.env.VITE_PAYLOAD_ENCRYPTION_KEY
  if (!configuredKey) {
    return ''
  }

  const key = base64UrlDecode(configuredKey)
  if (key.length !== 32) {
    return ''
  }

  const signingKey = key.slice(0, 16)
  const encryptionKey = key.slice(16)
  const iv = crypto.getRandomValues(new Uint8Array(16))
  const timestamp = new Uint8Array(8)
  const seconds = BigInt(Math.floor(Date.now() / 1000))
  new DataView(timestamp.buffer).setBigUint64(0, seconds)
  const header = new Uint8Array([0x80, ...timestamp, ...iv])

  const aesKey = await crypto.subtle.importKey(
    'raw',
    encryptionKey,
    { name: 'AES-CBC' },
    false,
    ['encrypt']
  )
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      aesKey,
      encoder.encode(JSON.stringify(payload))
    )
  )
  const message = new Uint8Array(header.length + ciphertext.length)
  message.set(header)
  message.set(ciphertext, header.length)

  const hmacKey = await crypto.subtle.importKey(
    'raw',
    signingKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, message))
  const token = new Uint8Array(message.length + signature.length)
  token.set(message)
  token.set(signature, message.length)
  return base64UrlEncode(token)
}
