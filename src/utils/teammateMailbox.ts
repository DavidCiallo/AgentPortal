/**
 * Stub for removed teammate mailbox module.
 */

export type IdleNotificationMessage = { from: string; text: string }
export type PlanApprovalRequestMessage = { from: string; text: string }
export type PlanApprovalResponseMessage = { from: string; text: string }
export type ShutdownRequestMessage = { from: string; text: string }
export type ShutdownRejectedMessage = { from: string; text: string }
export type TaskAssignmentMessage = { from: string; text: string }

export async function readUnreadMessages(
  _agentName: string,
  _teamName?: string,
): Promise<Array<{ from: string; text: string; timestamp: string; color?: string; summary?: string }>> {
  return []
}

export async function markMessagesAsReadByPredicate(
  _agentName: string,
  _predicate: (m: { text: string }) => boolean,
  _teamName?: string,
): Promise<void> {}

export async function writeToMailbox(
  _agentName: string,
  _message: unknown,
  _teamName?: string,
): Promise<void> {}

export function isShutdownApproved(_text: string): { from: string } | null {
  return null
}

export function isShutdownRequest(_text: string): ShutdownRequestMessage | null {
  return null
}

export function isShutdownRejected(_text: string): ShutdownRejectedMessage | null {
  return null
}

export function isStructuredProtocolMessage(_text: string): boolean {
  return false
}

export function isIdleNotification(_text: string): IdleNotificationMessage | null {
  return null
}

export function isPlanApprovalRequest(_text: string): PlanApprovalRequestMessage | null {
  return null
}

export function isPlanApprovalResponse(_text: string): PlanApprovalResponseMessage | null {
  return null
}

export function isTaskAssignment(_text: string): TaskAssignmentMessage | null {
  return null
}

export function createShutdownApprovedMessage(): string {
  return ''
}

export function createShutdownRejectedMessage(): string {
  return ''
}

export function createShutdownRequestMessage(_reason?: string): string {
  return ''
}
