/**
 * Minimal framework-agnostic toast store.
 *
 * Kept free of React so it can be called from services and utilities
 * (see `notifyError` / `notifySuccess` in `@/utils/errorUtils`).
 * The `<Toaster />` component subscribes to this store and renders the stack.
 */

export type ToastVariant = 'error' | 'success' | 'warning' | 'info'

export interface ToastItem {
  id: number
  variant: ToastVariant
  message: string
  title?: string
  duration: number
}

type Listener = (toasts: ToastItem[]) => void

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  error: 6000,
  warning: 5000,
  success: 4000,
  info: 4000,
}

const MAX_VISIBLE = 4

let toasts: ToastItem[] = []
let nextId = 1
const listeners = new Set<Listener>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit() {
  listeners.forEach((listener) => listener(toasts))
}

export function dismissToast(id: number) {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function pushToast(input: {
  variant: ToastVariant
  message: string
  title?: string
  duration?: number
}): number {
  const message = input.message.trim()
  if (!message) return -1

  // Collapse identical consecutive messages instead of stacking duplicates.
  const duplicate = toasts.find((t) => t.message === message && t.variant === input.variant)
  if (duplicate) dismissToast(duplicate.id)

  const item: ToastItem = {
    id: nextId++,
    variant: input.variant,
    message,
    title: input.title,
    duration: input.duration ?? DEFAULT_DURATION[input.variant],
  }

  toasts = [...toasts, item].slice(-MAX_VISIBLE)
  if (item.duration > 0) {
    timers.set(item.id, setTimeout(() => dismissToast(item.id), item.duration))
  }
  emit()
  return item.id
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getToasts(): ToastItem[] {
  return toasts
}

