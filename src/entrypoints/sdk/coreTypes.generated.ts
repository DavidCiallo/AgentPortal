// Simplified SDK types (full versions generated from Zod schemas in coreSchemas.ts)

export type SDKStatus = 'compacting' | null

export type SDKAssistantMessage = {
  type: 'assistant'
  message: Record<string, unknown> & { role: 'assistant'; content: unknown[] }
  parent_tool_use_id: string | null
  error?:
    | 'authentication_failed'
    | 'billing_error'
    | 'rate_limit'
    | 'invalid_request'
    | 'server_error'
    | 'unknown'
    | 'max_output_tokens'
  uuid: string
  session_id: string
}

export type SDKUserMessage = {
  type: 'user'
  message: Record<string, unknown> & {
    role: 'user'
    content: string | unknown[]
  }
  parent_tool_use_id: string | null
  isSynthetic?: boolean
  tool_use_result?: unknown
  priority?: 'now' | 'next' | 'later'
  timestamp?: string
  uuid?: string
  session_id?: string
}

export type SDKUserMessageReplay = SDKUserMessage & {
  uuid: string
  session_id: string
  isReplay: true
}

export type SDKResultMessage = {
  type: 'result'
  subtype:
    | 'success'
    | 'error_during_execution'
    | 'error_max_turns'
    | 'error_max_budget_usd'
    | 'error_max_structured_output_retries'
  duration_ms: number
  duration_api_ms: number
  is_error: boolean
  num_turns: number
  result?: string
  stop_reason: string | null
  total_cost_usd: number
  errors?: string[]
  structured_output?: unknown
  fast_mode_state?: 'off' | 'cooldown' | 'on'
  uuid: string
  session_id: string
}

export type ModelUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests: number
  costUSD: number
  contextWindow: number
  maxOutputTokens: number
}

export type SDKSystemMessage = {
  type: 'system'
  subtype: string
  uuid: string
  session_id: string
  [key: string]: unknown
}

export type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKSystemMessage
  | {
      type: 'stream_event'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      event: any
      parent_tool_use_id: string | null
      uuid: string
      session_id: string
    }
  | {
      type: 'tool_progress'
      tool_use_id: string
      tool_name: string
      parent_tool_use_id: string | null
      elapsed_time_seconds: number
      uuid: string
      session_id: string
      [key: string]: unknown
    }
  | {
      type: 'auth_status'
      isAuthenticating: boolean
      output: string[]
      error?: string
      uuid: string
      session_id: string
    }
  | {
      type: 'rate_limit_event'
      rate_limit_info: Record<string, unknown>
      uuid: string
      session_id: string
    }
  | {
      type: 'tool_use_summary'
      summary: string
      preceding_tool_use_ids: string[]
      uuid: string
      session_id: string
    }
  | {
      type: 'prompt_suggestion'
      suggestion: string
      uuid: string
      session_id: string
    }
  | {
      type: 'permission_request'
      request_id: string
      tool_name: string
      tool_use_id: string
      input: Record<string, unknown>
      uuid: string
      session_id: string
    }
