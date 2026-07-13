/**
 * Stub — terminal notification system. Only the Notification type is
 * still referenced by shared code (Tool.ts).
 */

type Priority = 'low' | 'medium' | 'high' | 'immediate'

type BaseNotification = {
  key: string
  invalidates?: string[]
  priority: Priority
  timeoutMs?: number
  fold?: (accumulator: Notification, incoming: Notification) => Notification
}

type TextNotification = BaseNotification & {
  text: string
  color?: string
}

type JSXNotification = BaseNotification & {
  jsx: any
}

export type Notification = TextNotification | JSXNotification

export function useNotifications(): {
  addNotification: (content: Notification) => void
  removeNotification: (key: string) => void
} {
  return {
    addNotification: () => {},
    removeNotification: () => {},
  }
}

export function getNext(queue: Notification[]): Notification | undefined {
  if (queue.length === 0) return undefined
  const PRIORITIES: Record<Priority, number> = { immediate: 0, high: 1, medium: 2, low: 3 }
  return queue.reduce((min, n) => PRIORITIES[n.priority] < PRIORITIES[min.priority] ? n : min)
}
