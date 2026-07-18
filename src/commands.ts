/**
 * Stub — original CLI command aggregator removed. Re-exports the canonical
 * Command types from types/command.ts so that SkillTool, prompt.ts and other
 * consumers get the full type definitions, while the runtime functions are
 * no-ops (no built-in commands remain).
 */

// Re-export the real types from the canonical location
export type {
  Command,
  CommandBase,
  CommandResultDisplay,
  LocalCommandResult,
  LocalJSXCommandContext,
  PromptCommand,
  ResumeEntrypoint,
} from './types/command.js'
export {
  findCommand,
  getCommandName,
  isBridgeSafeCommand,
  isCommandEnabled,
} from './types/command.js'

import memoize from 'lodash-es/memoize.js'
import type { Command } from './types/command.js'

/** No built-in commands remain — returns an empty set. */
export const builtInCommandNames = memoize(
  (): Set<string> => new Set<string>(),
)

export const getCommand = (_name: string): Command | undefined => undefined
export const getCommands = async (_cwd: string): Promise<Command[]> => []
export const getSkillToolCommands = memoize(
  async (_cwd: string): Promise<Command[]> => [],
)
export const hasCommand = (_name: string): boolean => false
export const clearCommandsCache = (): void => {}
export const clearCommandMemoizationCaches = (): void => {}
export const getSlashCommandToolSkills = memoize(
  async (_cwd: string): Promise<any[]> => [],
)
export const formatDescriptionWithSource = (cmd: Command): string => cmd.description ?? cmd.name
export const meetsAvailabilityRequirement = (_cmd: Command): boolean => true
