import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getApiKeyFromApiKeyHelper,
} from 'src/utils/auth.js'
import { getUserAgent } from 'src/utils/http.js'
import {
  getIsNonInteractiveSession,
  getSessionId,
} from '../../bootstrap/state.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

/**
 * Environment variables:
 * - OPENAI_API_KEY: API key for OpenAI-compatible endpoint
 * - OPENAI_BASE_URL: Base URL for OpenAI-compatible endpoint
 * - OPENAI_MODEL: Model name to use
 * - API_TIMEOUT_MS: Request timeout in milliseconds (default: 600000)
 * - ANTHROPIC_CUSTOM_HEADERS: Custom headers (newline-separated, "Name: Value" format)
 */

export async function getAnthropicClient({
  apiKey,
  maxRetries,
  model: _model,
  fetchOverride,
  source,
  providerOverride,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: ClientOptions['fetch']
  source?: string
  providerOverride?: { model: string; baseURL: string; apiKey: string }
}): Promise<Anthropic> {
  const containerId = process.env.CLAUDE_CODE_CONTAINER_ID
  const remoteSessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  const clientApp = process.env.CLAUDE_AGENT_SDK_CLIENT_APP
  const customHeaders = getCustomHeaders()
  const defaultHeaders: { [key: string]: string } = {
    'x-app': 'cli',
    'User-Agent': getUserAgent(),
    'X-Claude-Code-Session-Id': getSessionId(),
    ...customHeaders,
    ...(containerId ? { 'x-claude-remote-container-id': containerId } : {}),
    ...(remoteSessionId
      ? { 'x-claude-remote-session-id': remoteSessionId }
      : {}),
    // SDK consumers can identify their app/library for backend analytics
    ...(clientApp ? { 'x-client-app': clientApp } : {}),
  }

  // Log API client configuration for HFI debugging
  logForDebugging(
    `[API:request] Creating client, ANTHROPIC_CUSTOM_HEADERS present: ${!!process.env.ANTHROPIC_CUSTOM_HEADERS}, has Authorization header: ${!!customHeaders['Authorization']}`,
  )

  // Add additional protection header if enabled via env var
  const additionalProtectionEnabled = isEnvTruthy(
    process.env.CLAUDE_CODE_ADDITIONAL_PROTECTION,
  )
  if (additionalProtectionEnabled) {
    defaultHeaders['x-anthropic-additional-protection'] = 'true'
  }

  logForDebugging('[API:auth] OAuth token check starting')
  await checkAndRefreshOAuthTokenIfNeeded()
  logForDebugging('[API:auth] OAuth token check complete')

  await configureApiKeyHeaders(defaultHeaders, getIsNonInteractiveSession())

  // Agent routing override: use per-agent provider when configured.
  // Strip auth-related headers to prevent leaking credentials
  // to third-party endpoints (SSRF / credential forwarding mitigation).
  if (providerOverride) {
    const { createOpenAIShimClient } = await import('./openaiShim.js')
    const safeHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(defaultHeaders)) {
      const lower = k.toLowerCase()
      if (lower === 'authorization' || lower === 'x-api-key' || lower === 'api-key') continue
      safeHeaders[k] = v
    }
    return createOpenAIShimClient({
      defaultHeaders: safeHeaders,
      maxRetries,
      timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
      providerOverride,
    }) as unknown as Anthropic
  }

  // Always use OpenAI-compatible shim
  const { createOpenAIShimClient } = await import('./openaiShim.js')
  return createOpenAIShimClient({
    defaultHeaders,
    maxRetries,
    timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
  }) as unknown as Anthropic
}

async function configureApiKeyHeaders(
  headers: Record<string, string>,
  isNonInteractiveSession: boolean,
): Promise<void> {
  const token =
    process.env.ANTHROPIC_AUTH_TOKEN ||
    (await getApiKeyFromApiKeyHelper())
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
}

function getCustomHeaders(): Record<string, string> {
  const customHeaders: Record<string, string> = {}
  const customHeadersEnv = process.env.ANTHROPIC_CUSTOM_HEADERS

  if (!customHeadersEnv) return customHeaders

  // Split by newlines to support multiple headers
  const headerStrings = customHeadersEnv.split(/\n|\r\n/)

  for (const headerString of headerStrings) {
    if (!headerString.trim()) continue

    // Parse header in format "Name: Value" (curl style). Split on first `:`
    // then trim — avoids regex backtracking on malformed long header lines.
    const colonIdx = headerString.indexOf(':')
    if (colonIdx === -1) continue
    const name = headerString.slice(0, colonIdx).trim()
    const value = headerString.slice(colonIdx + 1).trim()
    if (name) {
      customHeaders[name] = value
    }
  }

  return customHeaders
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'
