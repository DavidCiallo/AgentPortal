/**
 * Minimal commands.ts — replaces the deleted 600-line aggregator.
 *
 * Built-in slash commands (src/commands/) have been removed. This module now
 * only provides the skill-loading infrastructure that SkillTool and other
 * consumers still depend on.
 */
import memoize from 'lodash-es/memoize.js'
import { logForDebugging } from './utils/debug.js'
import { toError } from './utils/errors.js'
import { logError } from './utils/log.js'
import {
  clearSkillCaches,
  getDynamicSkills,
  getSkillDirCommands,
} from './skills/loadSkillsDir.js'
import {
  clearPluginCommandCache,
  clearPluginSkillsCache,
  getPluginCommands,
  getPluginSkills,
} from './utils/plugins/loadPluginCommands.js'

// Re-export types from the centralized location
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

/** No built-in commands remain — returns an empty set. */
export const builtInCommandNames = memoize(
  (): Set<string> => new Set<string>(),
)

/**
 * Loads all available commands (skills from disk + plugins).
 * Built-in commands have been removed.
 */
const loadAllCommands = memoize(async (cwd: string): Promise<Command[]> => {
  const [skillDirCommands, pluginSkills, pluginCommands] = await Promise.all([
    getSkillDirCommands(cwd).catch(err => {
      logError(toError(err))
      logForDebugging(
        'Skill directory commands failed to load, continuing without them',
      )
      return []
    }),
    getPluginSkills().catch(err => {
      logError(toError(err))
      logForDebugging('Plugin skills failed to load, continuing without them')
      return []
    }),
    getPluginCommands().catch(err => {
      logError(toError(err))
      logForDebugging('Plugin commands failed to load, continuing without them')
      return []
    }),
  ])

  return [...skillDirCommands, ...pluginSkills, ...pluginCommands]
})

/**
 * Returns commands available to the current user.
 */
export async function getCommands(cwd: string): Promise<Command[]> {
  const allCommands = await loadAllCommands(cwd)
  const dynamicSkills = getDynamicSkills()

  const baseNames = new Set(allCommands.map(c => c.name))
  const uniqueDynamicSkills = dynamicSkills.filter(s => !baseNames.has(s.name))

  return [...allCommands, ...uniqueDynamicSkills]
}

export function clearCommandMemoizationCaches(): void {
  loadAllCommands.cache?.clear?.()
  getSkillToolCommands.cache?.clear?.()
  getSlashCommandToolSkills.cache?.clear?.()
}

export function clearCommandsCache(): void {
  clearCommandMemoizationCaches()
  clearPluginCommandCache()
  clearPluginSkillsCache()
  clearSkillCaches()
}

/** MCP skills feature has been removed. Returns empty array. */
export function getMcpSkillCommands(
  _mcpCommands: readonly Command[],
): readonly Command[] {
  return []
}

/** SkillTool shows ALL prompt-based commands the model can invoke. */
export const getSkillToolCommands = memoize(
  async (cwd: string): Promise<Command[]> => {
    const allCommands = await getCommands(cwd)
    return allCommands.filter(
      cmd =>
        cmd.type === 'prompt' &&
        !cmd.disableModelInvocation &&
        cmd.source !== 'builtin' &&
        (cmd.loadedFrom === 'bundled' ||
          cmd.loadedFrom === 'skills' ||
          cmd.loadedFrom === 'commands_DEPRECATED' ||
          cmd.hasUserSpecifiedDescription ||
          cmd.whenToUse),
    )
  },
)

/** Filters commands to only skills (model-invocable prompt commands). */
export const getSlashCommandToolSkills = memoize(
  async (cwd: string): Promise<Command[]> => {
    try {
      const allCommands = await getCommands(cwd)
      return allCommands.filter(
        cmd =>
          cmd.type === 'prompt' &&
          cmd.source !== 'builtin' &&
          (cmd.hasUserSpecifiedDescription || cmd.whenToUse) &&
          (cmd.loadedFrom === 'skills' ||
            cmd.loadedFrom === 'plugin' ||
            cmd.loadedFrom === 'bundled' ||
            cmd.disableModelInvocation),
      )
    } catch (error) {
      logError(toError(error))
      logForDebugging('Returning empty skills array due to load failure')
      return []
    }
  },
)

/** Checks if a command exists by name. */
export function hasCommand(
  commandName: string,
  commands: Command[],
): boolean {
  return findCommand(commandName, commands) !== undefined
}

/** Gets a command by name, throws if not found. */
export function getCommand(
  commandName: string,
  commands: Command[],
): Command {
  const command = findCommand(commandName, commands)
  if (!command) {
    throw ReferenceError(
      `Command ${commandName} not found. Available commands: ${commands
        .map(_ => {
          const name = getCommandName(_)
          return _.aliases ? `${name} (aliases: ${_.aliases.join(', ')})` : name
        })
        .sort((a, b) => a.localeCompare(b))
        .join(', ')}`,
    )
  }
  return command
}

/** All commands are available (no auth gating in open-source build). */
export function meetsAvailabilityRequirement(_cmd: Command): boolean {
  return true
}

/**
 * Formats a command's description with its source annotation for user-facing UI.
 */
export function formatDescriptionWithSource(cmd: Command): string {
  if (cmd.type !== 'prompt') {
    return cmd.description
  }
  if (cmd.kind === 'workflow') {
    return `${cmd.description} (workflow)`
  }
  if (cmd.source === 'plugin') {
    const pluginName = cmd.pluginInfo?.pluginManifest.name
    if (pluginName) {
      return `(${pluginName}) ${cmd.description}`
    }
    return `${cmd.description} (plugin)`
  }
  if (cmd.source === 'builtin' || cmd.source === 'mcp') {
    return cmd.description
  }
  if (cmd.source === 'bundled') {
    return `${cmd.description} (bundled)`
  }
  return cmd.description
}
