import type { Tool, ToolUseContext } from '../Tool.js'
import type { AssistantMessage } from './message.js'
import type { PermissionDecision } from './permissions.js'

export type CanUseToolFn = (
  tool: Tool,
  input: { [key: string]: unknown },
  context: ToolUseContext,
  assistantMessage: AssistantMessage,
  toolUseID: string,
  forceDecision?: boolean,
) => Promise<PermissionDecision>
