/**
 * Stub for removed InProcessTeammateTask module.
 */
import type { InProcessTeammateTaskState } from './types.js'

export function getRunningTeammatesSorted(): InProcessTeammateTaskState[] {
  return []
}

export function getAllInProcessTeammateTasks(): InProcessTeammateTaskState[] {
  return []
}

export function findTeammateTaskByAgentId(_agentId: string): InProcessTeammateTaskState | undefined {
  return undefined
}

export const InProcessTeammateTask = {
  kill: async (_taskId: string, _setAppState: (fn: (state: unknown) => unknown) => void): Promise<void> => {},
}

export function injectUserMessageToTeammate(): void {}
