/**
 * Stub for removed InProcessTeammateTask types.
 */
import type { Task } from '../Task.js'

export interface InProcessTeammateTaskState extends Task {
  type: 'in-process-teammate'
  teammateName: string
  teamName: string
  messages: Array<{ role: string; content: string }>
  status: 'running' | 'completed' | 'failed'
}

export function isInProcessTeammateTask(
  task: Task,
): task is InProcessTeammateTaskState {
  return (task as InProcessTeammateTaskState).type === 'in-process-teammate'
}
