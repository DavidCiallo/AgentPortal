/**
 * Simplified auth.ts for third-party API usage (Portal)
 *
 * All Claude-specific authentication logic has been removed.
 * Functions return default values to maintain API compatibility.
 */

import memoize from 'lodash-es/memoize.js'
import { isBareMode, isEnvTruthy } from './envUtils.js'
import { getSettings_DEPRECATED } from './settings/settings.js'

/** Default TTL for API key helper cache in milliseconds (5 minutes) */
const DEFAULT_API_KEY_HELPER_TTL = 5 * 60 * 1000

/**
 * CCR and Claude Desktop spawn the CLI with OAuth and should never fall back
 * to the user's ~/.portal/settings.json API-key config (apiKeyHelper,
 * env.OPENAI_API_KEY, env.ANTHROPIC_AUTH_TOKEN). Those settings exist for
 * the user's terminal CLI, not managed sessions. Without this guard, a user
 * who runs `claude` in their terminal with an API key sees every CCD session
 * also use that key — and fail if it's stale/wrong-org.
 */
function isManagedOAuthContext(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ||
    process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop'
  )
}

/** Whether we are supporting direct 1P auth. */
// this code is closely related to getAuthTokenSource
export function isAnthropicAuthEnabled(): boolean {
  // --bare: API-key-only, never OAuth.
  if (isBareMode()) return false

  // Check if user has configured an external API key source
  const settings = getSettings_DEPRECATED() || {}
  const apiKeyHelper = settings.apiKeyHelper
  const hasExternalAuthToken =
    process.env.ANTHROPIC_AUTH_TOKEN ||
    apiKeyHelper ||
    process.env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR

  // Check if API key is from an external source (not managed by /login)
  const { source: apiKeySource } = getAnthropicApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  const hasExternalApiKey =
    apiKeySource === 'OPENAI_API_KEY' || apiKeySource === 'apiKeyHelper'

  // Disable Anthropic auth if:
  // 1. User has an external API key (regardless of proxy configuration)
  // 2. User has an external auth token (regardless of proxy configuration)
  const shouldDisableAuth =
    (hasExternalAuthToken && !isManagedOAuthContext()) ||
    (hasExternalApiKey && !isManagedOAuthContext())

  return !shouldDisableAuth
}

/** Where the auth token is being sourced from, if any. */
// this code is closely related to isAnthropicAuthEnabled
export function getAuthTokenSource() {
  // --bare: API-key-only. apiKeyHelper (from --settings) is the only
  // bearer-token-shaped source allowed.
  if (isBareMode()) {
    if (getConfiguredApiKeyHelper()) {
      return { source: 'apiKeyHelper' as const, hasToken: true }
    }
    return { source: 'none' as const, hasToken: false }
  }

  if (process.env.ANTHROPIC_AUTH_TOKEN && !isManagedOAuthContext()) {
    return { source: 'ANTHROPIC_AUTH_TOKEN' as const, hasToken: true }
  }

  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { source: 'CLAUDE_CODE_OAUTH_TOKEN' as const, hasToken: true }
  }

  if (process.env.OPENAI_API_KEY) {
    return { source: 'OPENAI_API_KEY' as const, hasToken: true }
  }

  return { source: 'none' as const, hasToken: false }
}

/**
 * Get the API key from the environment or config
 */
export function getAnthropicApiKey(): null | string {
  return process.env.OPENAI_API_KEY || null
}

/**
 * Check if there is an Anthropic API key configured
 */
export function hasAnthropicApiKeyAuth(): boolean {
  return !!process.env.OPENAI_API_KEY
}

/**
 * Get the API key with its source
 */
export function getAnthropicApiKeyWithSource(
  options: { skipRetrievingKeyFromApiKeyHelper?: boolean } = {},
): { apiKey: string | null; source: 'OPENAI_API_KEY' | 'apiKeyHelper' | 'none' } {
  const apiKey = process.env.OPENAI_API_KEY
  if (apiKey) {
    return { apiKey, source: 'OPENAI_API_KEY' }
  }

  return { apiKey: null, source: 'none' }
}

/**
 * Get the configured API key helper
 */
export function getConfiguredApiKeyHelper(): string | undefined {
  const settings = getSettings_DEPRECATED()
  return settings?.apiKeyHelper
}

/**
 * Calculate the TTL for API key helper cache
 */
export function calculateApiKeyHelperTTL(): number {
  return DEFAULT_API_KEY_HELPER_TTL
}

/**
 * Get elapsed time since last API key helper fetch
 */
export function getApiKeyHelperElapsedMs(): number {
  return 0
}

/**
 * Get API key from helper (async)
 */
export async function getApiKeyFromApiKeyHelper(): Promise<string | null> {
  return null
}

/**
 * Get API key from helper (cached)
 */
export const getApiKeyFromApiKeyHelperCached = memoize(
  (): string | null => {
    return null
  },
)

/**
 * Clear the API key helper cache
 */
export function clearApiKeyHelperCache(): void {
  // no-op
}

/**
 * Prefetch API key from helper if safe
 */
export function prefetchApiKeyFromApiKeyHelperIfSafe(): void {
  // no-op
}

/**
 * Get API key from config or macOS keychain
 */
export const getApiKeyFromConfigOrMacOSKeychain = memoize(
  (): string | null => {
    return null
  },
)

/**
 * Check if custom API key is approved
 */
export function isCustomApiKeyApproved(_apiKey: string): boolean {
  return true
}

/**
 * Save OAuth tokens (no-op for third-party usage)
 */
export function saveOAuthTokensIfNeeded(_tokens: unknown): {
  success: boolean
  error?: string
} {
  return { success: false, error: 'OAuth not supported in third-party mode' }
}

/**
 * Get Claude AI OAuth tokens (always returns null for third-party usage)
 */
export const getClaudeAIOAuthTokens = memoize(
  (): unknown | null => {
    return null
  },
)

/**
 * Handle OAuth 401 error
 */
export function handleOAuth401Error(_error: Error): boolean {
  return false
}

/**
 * Check and refresh OAuth token if needed
 */
export async function checkAndRefreshOAuthTokenIfNeeded(): Promise<boolean> {
  return false
}

/**
 * Check if user is a Claude AI subscriber
 */
export function isClaudeAISubscriber(): boolean {
  return false
}

/**
 * Check if user has profile scope
 */
export function hasProfileScope(): boolean {
  return false
}

/**
 * Check if user is a 1P API customer
 */
export function is1PApiCustomer(): boolean {
  return false
}

/**
 * Get OAuth account info
 */
export function getOauthAccountInfo(): unknown | undefined {
  return undefined
}

/**
 * Check if overage provisioning is allowed
 */
export function isOverageProvisioningAllowed(): boolean {
  return false
}

/**
 * Get subscription type
 */
export function getSubscriptionType(): unknown | null {
  return null
}

/**
 * Check if user is a Max subscriber
 */
export function isMaxSubscriber(): boolean {
  return false
}

/**
 * Check if user is a Team subscriber
 */
export function isTeamSubscriber(): boolean {
  return false
}

/**
 * Check if user is a Team Premium subscriber
 */
export function isTeamPremiumSubscriber(): boolean {
  return false
}

/**
 * Check if user is an Enterprise subscriber
 */
export function isEnterpriseSubscriber(): boolean {
  return false
}

/**
 * Check if user is a Pro subscriber
 */
export function isProSubscriber(): boolean {
  return false
}

/**
 * Check if user is a consumer subscriber
 */
export function isConsumerSubscriber(): boolean {
  return false
}

/**
 * Remove API key (no-op for third-party usage)
 */
export function removeApiKey(): void {
  // no-op
}

/**
 * Normalize API key for config
 */
export function normalizeApiKeyForConfig(apiKey: string): string {
  return apiKey
}

/**
 * Validate force login org
 */
export function validateForceLoginOrg(): boolean {
  return false
}

/**
 * Check if using 3P services
 */
export function isUsing3PServices(): boolean {
  return true
}

/**
 * Get rate limit tier
 */
export function getRateLimitTier(): string | undefined {
  return undefined
}

/**
 * Get subscription name
 */
export function getSubscriptionName(): string | undefined {
  return undefined
}

/**
 * Get account information
 */
export function getAccountInformation(): unknown {
  return undefined
}

/**
 * Check if OTEL headers helper is from project or local settings
 */
export function isOtelHeadersHelperFromProjectOrLocalSettings(): boolean {
  return false
}

/**
 * Get OTEL headers from helper
 */
export async function getOtelHeadersFromHelper(): Promise<Record<string, string> | undefined> {
  return undefined
}
