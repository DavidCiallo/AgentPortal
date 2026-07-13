/**
 * Shared stub UI exports for terminal tool rendering.
 * All tool UI.tsx files re-export from here.
 * In web mode, these are never called — the frontend renders directly.
 */
import type { ReactNode } from 'react'

const noop = () => null

export const renderToolUseMessage: (...args: any[]) => ReactNode = noop
export const renderToolResultMessage: (...args: any[]) => ReactNode = noop
export const renderToolUseErrorMessage: (...args: any[]) => ReactNode = noop
export const renderToolUseProgressMessage: (...args: any[]) => ReactNode = noop
export const renderToolUseQueuedMessage: (...args: any[]) => ReactNode = noop
export const renderToolUseRejectedMessage: (...args: any[]) => ReactNode = noop
export const renderToolUseTag: (...args: any[]) => ReactNode = noop
export const renderGroupedAgentToolUse: (...args: any[]) => ReactNode = noop
export const renderCreateResultMessage: (...args: any[]) => ReactNode = noop
export const renderCreateToolUseMessage: (...args: any[]) => ReactNode = noop
export const renderDeleteResultMessage: (...args: any[]) => ReactNode = noop
export const renderDeleteToolUseMessage: (...args: any[]) => ReactNode = noop
export const renderListResultMessage: (...args: any[]) => ReactNode = noop
export const renderListToolUseMessage: (...args: any[]) => ReactNode = noop
export const AgentPromptDisplay: (...args: any[]) => ReactNode = noop
export const AgentResponseDisplay: (...args: any[]) => ReactNode = noop
export const BackgroundHint: (...args: any[]) => ReactNode = noop

export const userFacingName = 'Tool'
export const userFacingNameBackgroundColor = '#666'

// Tool summary / result helpers
export const getToolUseSummary = (_input?: any): string | null => null
export const isResultTruncated = (_output: any): boolean => false

// FileEditTool-specific
export const renderEditConfirmation: (...args: any[]) => ReactNode = noop
export const renderEditResultSummary: (...args: any[]) => ReactNode = noop
export const renderPatchPreview: (...args: any[]) => ReactNode = noop
