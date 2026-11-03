/**
 * WebSocket Real-Time Sync Service with Multi-Tab BroadcastChannel support.
 */

type SyncEventType =
  | 'LOANS_UPDATED'
  | 'PETTY_CASH_UPDATED'
  | 'TRANSACTION_UPDATED'
  | 'BANK_UPDATED'
  | 'AUDIT_UPDATED'
  | 'TENANTS_UPDATED'
  | 'SALES_UPDATED'
  | 'EXPENSE_CREATED'
  | 'EXPENSE_UPDATED'
  | 'EXPENSE_DELETED'
  | 'ALL'
type Listener = (payload?: any) => void

class WebSocketService {
  private socket: WebSocket | null = null
  private listeners: Map<string, Set<Listener>> = new Map()
  private reconnectTimeout: number | null = null
  private pingInterval: number | null = null
  private broadcastChannel: BroadcastChannel | null = null
  private isConnecting: boolean = false

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel('mct_realtime_sync')
        this.broadcastChannel.onmessage = (event) => {
          if (event.data && event.data.type) {
            this.notifyListeners(event.data.type, event.data.payload)
          }
        }
      } catch {
        // Fallback gracefully if BroadcastChannel fails
      }
    }
  }

  private getToken(): string | null {
    if (typeof window === 'undefined') return null
    return (
      sessionStorage.getItem('mct_access_token') ||
      sessionStorage.getItem('auth_token') ||
      localStorage.getItem('auth_token')
    )
  }

  public connect(): void {
    if (typeof window === 'undefined') return
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return
    }
    if (this.isConnecting) return

    const token = this.getToken()
    if (!token) {
      // Avoid connecting without authorization token to prevent 1008 policy violation
      return
    }

    this.isConnecting = true

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    // Connect via relative proxy (/ws) with auth token query param
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`

    try {
      this.socket = new WebSocket(wsUrl)

      this.socket.onopen = () => {
        this.isConnecting = false
        this.startPing()
      }

      this.socket.onmessage = (event) => {
        if (event.data === 'pong') return
        try {
          const data = JSON.parse(event.data)
          if (data && data.type) {
            this.notifyListeners(data.type, data.payload)
            // Forward to other local tabs
            this.broadcastChannel?.postMessage(data)
          }
        } catch {
          // Non-JSON message
        }
      }

      this.socket.onclose = () => {
        this.isConnecting = false
        this.stopPing()
        this.scheduleReconnect()
      }

      this.socket.onerror = () => {
        this.isConnecting = false
        try {
          this.socket?.close()
        } catch {
          // ignore
        }
      }
    } catch {
      this.isConnecting = false
      this.scheduleReconnect()
    }
  }

  public disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    this.stopPing()
    this.isConnecting = false
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        // ignore
      }
      this.socket = null
    }
  }

  private startPing(): void {
    this.stopPing()
    this.pingInterval = window.setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send('ping')
      }
    }, 25000)
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return
    const token = this.getToken()
    if (!token) return

    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null
      this.connect()
    }, 5000)
  }

  public subscribe(eventType: SyncEventType, callback: Listener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(callback)
    this.connect()

    return () => {
      this.listeners.get(eventType)?.delete(callback)
    }
  }

  public emitLocal(type: SyncEventType, payload?: any): void {
    this.notifyListeners(type, payload)
    this.broadcastChannel?.postMessage({ type, payload })
  }

  private notifyListeners(type: string, payload?: any): void {
    const specific = this.listeners.get(type)
    if (specific) {
      specific.forEach((fn) => {
        try {
          fn(payload)
        } catch (e) {
          console.error('WebSocket listener error:', e)
        }
      })
    }
    const all = this.listeners.get('ALL')
    if (all) {
      all.forEach((fn) => {
        try {
          fn({ type, payload })
        } catch (e) {
          console.error('WebSocket ALL listener error:', e)
        }
      })
    }
  }
}

export const websocketService = new WebSocketService()
