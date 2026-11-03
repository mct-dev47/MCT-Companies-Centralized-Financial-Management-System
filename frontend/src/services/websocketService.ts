/**
 * WebSocket Real-Time Sync Service with Exponential Backoff, Jitter,
 * Status Observers, and Multi-Tab BroadcastChannel support.
 */

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline'

export type SyncEventType =
  | 'LOANS_UPDATED'
  | 'PETTY_CASH_UPDATED'
  | 'TRANSACTION_UPDATED'
  | 'BANK_UPDATED'
  | 'AUDIT_UPDATED'
  | 'TENANTS_UPDATED'
  | 'NOTIFICATION_RECEIVED'
  | 'WS_STATUS_CHANGE'
  | 'ALL'

export type Listener = (payload?: any) => void

class WebSocketService {
  private socket: WebSocket | null = null
  private listeners: Map<string, Set<Listener>> = new Map()
  private reconnectTimeout: number | null = null
  private pingInterval: number | null = null
  private stableTimer: number | null = null
  private broadcastChannel: BroadcastChannel | null = null
  private isConnecting: boolean = false
  private reconnectAttempts: number = 0
  private status: ConnectionStatus = 'offline'

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

  public getStatus(): ConnectionStatus {
    return this.status
  }

  private setStatus(newStatus: ConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus
      this.notifyListeners('WS_STATUS_CHANGE', newStatus)
    }
  }

  public connect(): void {
    if (typeof window === 'undefined') return
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return
    }
    if (this.isConnecting) return
    this.isConnecting = true
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'offline')

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    try {
      this.socket = new WebSocket(wsUrl)

      this.socket.onopen = () => {
        this.isConnecting = false
        this.setStatus('connected')
        this.startPing()

        // Reset reconnect attempts after 5 seconds of stable connection
        if (this.stableTimer) clearTimeout(this.stableTimer)
        this.stableTimer = window.setTimeout(() => {
          this.reconnectAttempts = 0
        }, 5000)
      }

      this.socket.onmessage = (event) => {
        if (event.data === 'pong') return
        try {
          const data = JSON.parse(event.data)
          if (data && data.type) {
            this.notifyListeners(data.type, data.payload || data)
            this.broadcastChannel?.postMessage(data)
          }
        } catch {
          // Non-JSON message
        }
      }

      this.socket.onclose = () => {
        this.handleDisconnect()
      }

      this.socket.onerror = () => {
        this.handleDisconnect()
      }
    } catch {
      this.handleDisconnect()
    }
  }

  private handleDisconnect(): void {
    this.isConnecting = false
    this.stopPing()
    if (this.stableTimer) {
      clearTimeout(this.stableTimer)
      this.stableTimer = null
    }
    this.setStatus('reconnecting')
    this.scheduleReconnect()
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

    this.reconnectAttempts += 1
    // Exponential backoff with random jitter (1s, 2s, 4s, 8s, max 30s)
    const baseDelay = Math.min(30000, Math.pow(2, Math.min(this.reconnectAttempts, 5)) * 1000)
    const jitter = Math.floor(Math.random() * 500)
    const delay = baseDelay + jitter

    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null
      this.connect()
    }, delay)
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
