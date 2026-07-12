/**
 * Stub for removed RemoteAgentTask module.
 */
import type { Task, SetAppState } from '../../Task.js'

export const RemoteAgentTask: Task = {
  name: 'Remote Agent',
  type: 'remote_agent',
  kill: async (_taskId: string, _setAppState: SetAppState): Promise<void> => {},
}

export async function checkRemoteAgentEligibility(): Promise<{ eligible: boolean; error?: string }> {
  return { eligible: false, error: 'Remote agent has been removed from this build' }
}

export function formatPreconditionError(_error: string): string {
  return _error
}

export function getRemoteTaskSessionUrl(_taskId: string): string | undefined {
  return undefined
}

export function registerRemoteAgentTask(): void {}

export function restoreRemoteAgentTasks(): void {}
