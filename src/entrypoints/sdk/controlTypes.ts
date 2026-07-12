// SDK Control Types - Types for control messages used by SDK consumers and builders.
//
// Types are derived from Zod schemas in controlSchemas.ts / coreSchemas.ts.
// To modify types:
// 1. Edit Zod schemas in controlSchemas.ts / coreSchemas.ts
// 2. Update corresponding types here.
//
// Schemas are available in controlSchemas.ts for runtime validation.

import type { SDKMessage, SDKUserMessage } from './coreTypes.js'

// ============================================================================
// Streamlined Message Types (from coreSchemas.ts, no exported types exist)
// ============================================================================

export type SDKStreamlinedTextMessage = {
  type: 'streamlined_text'
  text: string
  session_id: string
  uuid: string
}

export type SDKStreamlinedToolUseSummaryMessage = {
  type: 'streamlined_tool_use_summary'
  tool_summary: string
  session_id: string
  uuid: string
}

export type SDKPostTurnSummaryMessage = {
  type: 'system'
  subtype: 'post_turn_summary'
  summarizes_uuid: string
  status_category: 'blocked' | 'waiting' | 'completed' | 'review_ready' | 'failed'
  status_detail: string
  is_noteworthy: boolean
  title: string
  description: string
  recent_action: string
  needs_action: string
  artifact_urls: string[]
  uuid: string
  session_id: string
}

// ============================================================================
// Control Request Types
// ============================================================================

export type SDKControlInitializeRequest = {
  subtype: 'initialize'
  hooks?: Record<string, Array<{ commandName: string; pattern?: string }>>
  sdkMcpServers?: string[]
  jsonSchema?: Record<string, unknown>
  systemPrompt?: string
  appendSystemPrompt?: string
  agents?: Record<string, unknown>
  promptSuggestions?: boolean
  agentProgressSummaries?: boolean
}

export type SDKControlInterruptRequest = {
  subtype: 'interrupt'
}

export type SDKControlEndSessionRequest = {
  subtype: 'end_session'
  reason?: string
}

export type SDKControlSetPermissionModeRequest = {
  subtype: 'set_permission_mode'
  mode: string
  ultraplan?: boolean
}

export type SDKControlSetModelRequest = {
  subtype: 'set_model'
  model?: string
}

export type SDKControlSetMaxThinkingTokensRequest = {
  subtype: 'set_max_thinking_tokens'
  max_thinking_tokens: number | null
}

export type SDKControlMcpStatusRequest = {
  subtype: 'mcp_status'
}

export type SDKControlGetContextUsageRequest = {
  subtype: 'get_context_usage'
}

export type SDKControlMcpMessageRequest = {
  subtype: 'mcp_message'
  server_name: string
  message: unknown
}

export type SDKControlRewindFilesRequest = {
  subtype: 'rewind_files'
  user_message_id: string
  dry_run?: boolean
}

export type SDKControlCancelAsyncMessageRequest = {
  subtype: 'cancel_async_message'
  message_uuid: string
}

export type SDKControlSeedReadStateRequest = {
  subtype: 'seed_read_state'
  path: string
  mtime: number
}

export type SDKControlMcpSetServersRequest = {
  subtype: 'mcp_set_servers'
  servers: unknown
}

export type SDKControlReloadPluginsRequest = {
  subtype: 'reload_plugins'
}

export type SDKControlMcpReconnectRequest = {
  subtype: 'mcp_reconnect'
  serverName: string
}

export type SDKControlMcpToggleRequest = {
  subtype: 'mcp_toggle'
  serverName: string
  enabled?: boolean
}

export type SDKControlStopTaskRequest = {
  subtype: 'stop_task'
  task_id: string
}

export type SDKControlApplyFlagSettingsRequest = {
  subtype: 'apply_flag_settings'
  settings: Record<string, unknown>
}

export type SDKControlGetSettingsRequest = {
  subtype: 'get_settings'
}

export type SDKControlGenerateSessionTitleRequest = {
  subtype: 'generate_session_title'
  description?: string
  persist?: boolean
}

export type SDKControlChannelEnableRequest = {
  subtype: 'channel_enable'
  serverName: string
}

export type SDKControlMcpAuthenticateRequest = {
  subtype: 'mcp_authenticate'
  serverName: string
}

export type SDKControlMcpClearAuthRequest = {
  subtype: 'mcp_clear_auth'
  serverName: string
}

export type SDKControlMcpOauthCallbackUrlRequest = {
  subtype: 'mcp_oauth_callback_url'
  serverName: string
  callbackUrl: string
}

export type SDKControlClaudeAuthenticateRequest = {
  subtype: 'claude_authenticate'
  loginWithClaudeAi?: boolean
}

export type SDKControlClaudeOauthCallbackRequest = {
  subtype: 'claude_oauth_callback'
  authorizationCode: string
  state: string
}

export type SDKControlClaudeOauthWaitForCompletionRequest = {
  subtype: 'claude_oauth_wait_for_completion'
}

export type SDKControlSideQuestionRequest = {
  subtype: 'side_question'
  question: string
}

export type SDKControlPermissionRequest = {
  subtype: 'can_use_tool'
  tool_name: string
  tool_use_id: string
  input?: Record<string, unknown>
}

/**
 * Discriminated union of all typed control request shapes. Narrowing on
 * `subtype` correctly resolves typed members. No index signature is present on
 * any member — adding one breaks narrowing across the whole union.
 */
export type SDKControlRequestInner =
  | SDKControlInitializeRequest
  | SDKControlInterruptRequest
  | SDKControlEndSessionRequest
  | SDKControlSetPermissionModeRequest
  | SDKControlSetModelRequest
  | SDKControlSetMaxThinkingTokensRequest
  | SDKControlMcpStatusRequest
  | SDKControlGetContextUsageRequest
  | SDKControlMcpMessageRequest
  | SDKControlRewindFilesRequest
  | SDKControlCancelAsyncMessageRequest
  | SDKControlSeedReadStateRequest
  | SDKControlMcpSetServersRequest
  | SDKControlReloadPluginsRequest
  | SDKControlMcpReconnectRequest
  | SDKControlMcpToggleRequest
  | SDKControlStopTaskRequest
  | SDKControlApplyFlagSettingsRequest
  | SDKControlGetSettingsRequest
  | SDKControlGenerateSessionTitleRequest
  | SDKControlChannelEnableRequest
  | SDKControlMcpAuthenticateRequest
  | SDKControlMcpClearAuthRequest
  | SDKControlMcpOauthCallbackUrlRequest
  | SDKControlClaudeAuthenticateRequest
  | SDKControlClaudeOauthCallbackRequest
  | SDKControlClaudeOauthWaitForCompletionRequest
  | SDKControlSideQuestionRequest
  | SDKControlPermissionRequest

export type SDKControlMcpSetServersResponse = {
  added: string[]
  removed: string[]
  errors: Record<string, string>
}

export type SDKControlReloadPluginsResponse = {
  commands: unknown[]
  agents: unknown[]
  plugins: Array<{ name: string; path: string; source?: string }>
  mcpServers: unknown[]
  error_count: number
}

// ============================================================================
// Control Request/Response Envelope Types
// ============================================================================

export type SDKControlRequest = {
  type: 'control_request'
  request_id: string
  request: SDKControlRequestInner
}

export type SDKControlResponse = {
  type: 'control_response'
  response:
    | { subtype: 'success'; request_id: string; response?: Record<string, unknown> }
    | {
        subtype: 'error'
        request_id: string
        error: string
        pending_permission_requests?: SDKControlRequest[]
      }
}

// ============================================================================
// Aggregate Message Types
// ============================================================================

export type StdoutMessage =
  | SDKMessage
  | SDKStreamlinedTextMessage
  | SDKStreamlinedToolUseSummaryMessage
  | SDKPostTurnSummaryMessage
  | SDKControlResponse
  | SDKControlRequest
  | { type: 'control_cancel_request'; request_id: string }
  | { type: 'keep_alive' }

export type StdinMessage =
  | SDKUserMessage
  | SDKControlRequest
  | SDKControlResponse
  | { type: 'keep_alive' }
  | { type: 'update_environment_variables'; variables: Record<string, string> }
