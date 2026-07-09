import type { NonNullableUsage } from '../../entrypoints/sdk/sdkUtilityTypes.js'

/**
 * Zero-initialized usage object. Extracted from logging.ts so that
 * bridge/replBridge.ts can import it without transitively pulling in
 * api/errors.ts → utils/messages.ts → BashTool.tsx → the world.
 */
export const EMPTY_USAGE: Readonly<NonNullableUsage> = {
  input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 0,
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  service_tier: 'standard',
  cache_creation: {
    ephemeral_1h_input_tokens: 0,
    ephemeral_5m_input_tokens: 0,
  },
  inference_geo: '',
  iterations: [],
  speed: 'standard',
}

/**
 * Merge two usage objects by summing token counts. Used to accumulate
 * usage across streaming message_start / message_delta events.
 */
export function updateUsage(
  prev: NonNullableUsage,
  next: Partial<NonNullableUsage>,
): NonNullableUsage {
  return {
    input_tokens: prev.input_tokens + (next.input_tokens ?? 0),
    cache_creation_input_tokens:
      prev.cache_creation_input_tokens +
      (next.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens:
      prev.cache_read_input_tokens + (next.cache_read_input_tokens ?? 0),
    output_tokens: prev.output_tokens + (next.output_tokens ?? 0),
    server_tool_use: {
      web_search_requests:
        prev.server_tool_use.web_search_requests +
        (next.server_tool_use?.web_search_requests ?? 0),
      web_fetch_requests:
        prev.server_tool_use.web_fetch_requests +
        (next.server_tool_use?.web_fetch_requests ?? 0),
    },
    service_tier: next.service_tier ?? prev.service_tier,
    cache_creation: {
      ephemeral_1h_input_tokens:
        prev.cache_creation.ephemeral_1h_input_tokens +
        (next.cache_creation?.ephemeral_1h_input_tokens ?? 0),
      ephemeral_5m_input_tokens:
        prev.cache_creation.ephemeral_5m_input_tokens +
        (next.cache_creation?.ephemeral_5m_input_tokens ?? 0),
    },
    inference_geo: next.inference_geo ?? prev.inference_geo,
    iterations: next.iterations ?? prev.iterations,
    speed: next.speed ?? prev.speed,
  }
}
