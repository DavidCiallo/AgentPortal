/** Stub — original CLI slash command processor removed */
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { CanUseToolFn } from '../../types/canUseTool.js'
import type { LocalJSXCommandContext } from '../../types/command.js'
import type { SetToolJSXFn } from '../../Tool.js'
import type { AttachmentMessage } from '../../types/message.js'
import type { ProcessUserInputBaseResult } from './processUserInput.js'

export async function processSlashCommand(
  _input: string,
  _precedingInputBlocks: ContentBlockParam[],
  _imageContentBlocks: ContentBlockParam[],
  _attachmentMessages: AttachmentMessage[],
  _context: LocalJSXCommandContext,
  _setToolJSX: SetToolJSXFn,
  _uuid?: string,
  _isAlreadyProcessing?: boolean,
  _canUseTool?: CanUseToolFn,
): Promise<ProcessUserInputBaseResult> {
  return {
    messages: [],
    shouldQuery: false,
  }
}

/** Stub for SkillTool — processes a prompt slash command by name */
export async function processPromptSlashCommand(
  _commandName: string,
  _args: string,
  _commands: unknown,
  _context: unknown,
): Promise<ProcessUserInputBaseResult> {
  return {
    messages: [],
    shouldQuery: false,
  }
}
