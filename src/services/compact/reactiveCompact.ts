/**
 * Reactive compact — compacts conversation when API returns "prompt too long" error.
 * This is a simplified implementation for the Portal fork.
 */

import type { QuerySource } from '../../constants/querySource.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import { compactConversation } from './compact.js'

export function isReactiveCompactEnabled(): boolean {
  return true
}

export function isReactiveOnlyMode(): boolean {
  return false
}

export function isWithheldPromptTooLong(msg: Message | undefined): boolean {
  if (!msg || msg.type !== 'assistant' || !('isApiErrorMessage' in msg)) {
    return false
  }
  const assistantMsg = msg as any
  if (!assistantMsg.isApiErrorMessage || !assistantMsg.message?.content) {
    return false
  }
  const content = assistantMsg.message.content
  if (!Array.isArray(content) || content.length === 0) {
    return false
  }
  return content.some(
    (block: any) =>
      block.type === 'text' &&
      block.text?.startsWith('Prompt is too long'),
  )
}

export function isWithheldMediaSizeError(msg: Message | undefined): boolean {
  if (!msg || msg.type !== 'assistant' || !('isApiErrorMessage' in msg)) {
    return false
  }
  const assistantMsg = msg as any
  if (!assistantMsg.isApiErrorMessage || !assistantMsg.message?.content) {
    return false
  }
  const content = assistantMsg.message.content
  if (!Array.isArray(content) || content.length === 0) {
    return false
  }
  return content.some(
    (block: any) =>
      block.type === 'text' &&
      (block.text?.includes('image exceeds') ||
       block.text?.includes('PDF too large')),
  )
}

export async function tryReactiveCompact(params: {
  hasAttempted: boolean
  querySource?: QuerySource
  aborted: boolean
  messages: Message[]
  cacheSafeParams: CacheSafeParams
}): Promise<boolean> {
  const { hasAttempted, aborted, messages, cacheSafeParams, querySource } = params

  // Don't retry if already attempted or aborted
  if (hasAttempted || aborted) {
    logForDebugging('reactive compact: skipping (already attempted or aborted)')
    return false
  }

  logForDebugging('reactive compact: attempting compaction due to prompt-too-long error')

  try {
    await compactConversation(
      messages,
      cacheSafeParams.toolUseContext,
      cacheSafeParams,
      true, // Suppress user questions
      undefined, // No custom instructions
      false, // Not auto-compact
      {
        isRecompactionInChain: false,
        turnsSincePreviousCompact: -1,
        previousCompactTurnId: undefined,
        autoCompactThreshold: 0,
        querySource,
      },
    )

    logForDebugging('reactive compact: compaction successful')
    return true
  } catch (error) {
    logForDebugging(`reactive compact: compaction failed: ${error}`)
    return false
  }
}

export async function reactiveCompactOnPromptTooLong(
  _messages: Message[],
  _cacheSafeParams: CacheSafeParams,
  _options?: { customInstructions?: string; trigger?: string },
): Promise<{ ok: boolean; reason?: string }> {
  return { ok: false, reason: 'not_implemented' }
}
