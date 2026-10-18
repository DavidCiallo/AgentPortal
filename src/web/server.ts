import { createServer } from 'node:http'
import { readFile, readdir, mkdir, stat, unlink, appendFile } from 'node:fs/promises'
import { join, extname, resolve, win32 } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { createReadStream, readFileSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'

// Web/ static assets embedded into the compiled executable. With
// `with { type: 'file' }` each import resolves to a path string: the real
// file during development, and a $bunfs virtual path inside the binary
// after `bun build --compile`. The binary's virtual filesystem is not
// browsable via Bun.file()/import.meta.dir, so the paths are captured here.
import indexHtml from '../../web/index.html' with { type: 'file' }
import styleCss from '../../web/style.css' with { type: 'file' }
import faviconIco from '../../web/favicon.ico' with { type: 'file' }
import jsEvents from '../../web/js/events.js' with { type: 'file' }
import jsMarkdown from '../../web/js/markdown.js' with { type: 'file' }
import jsProject from '../../web/js/project.js' with { type: 'file' }
import jsSessions from '../../web/js/sessions.js' with { type: 'file' }
import jsSettings from '../../web/js/settings.js' with { type: 'file' }
import jsSidebar from '../../web/js/sidebar.js' with { type: 'file' }
import jsState from '../../web/js/state.js' with { type: 'file' }
import jsTools from '../../web/js/tools.js' with { type: 'file' }
import jsUtils from '../../web/js/utils.js' with { type: 'file' }
import jsWebsocket from '../../web/js/websocket.js' with { type: 'file' }

// URL-relative path → embedded path. Keep in sync with web/index.html.
const EMBEDDED_ASSETS: Record<string, string> = {
  'index.html': indexHtml,
  'style.css': styleCss,
  'favicon.ico': faviconIco,
  'js/events.js': jsEvents,
  'js/markdown.js': jsMarkdown,
  'js/project.js': jsProject,
  'js/sessions.js': jsSessions,
  'js/settings.js': jsSettings,
  'js/sidebar.js': jsSidebar,
  'js/state.js': jsState,
  'js/tools.js': jsTools,
  'js/utils.js': jsUtils,
  'js/websocket.js': jsWebsocket,
}

// @ts-expect-error - ws types not bundled
import { WebSocketServer, WebSocket } from 'ws'
import { QueryEngine } from '../QueryEngine.js'
import { getTools } from '../tools.js'
import { getDefaultAppState } from '../state/AppStateStore.js'
import { AppState } from '../state/AppState.js'
import { FileStateCache, READ_FILE_STATE_CACHE_SIZE } from '../utils/fileStateCache.js'
import { setSessionModelOverride, runWithSessionContext, getOriginalCwd, getSessionId } from '../bootstrap/state.js'

import { parseUserSpecifiedModel } from '../utils/model/model.js'
import {
  loadProfileFile,
  saveProfileFile,
  createProfileFile,
  type ProviderProfile,
  type ProfileEnv,
} from '../utils/providerProfile.js'
import type { SessionInfo } from '../utils/listSessionsImpl.js'
import {
  canonicalizePath,
  getProjectsDir,
  readSessionLite,
  extractFirstPromptFromHead,
  extractLastJsonStringField,
  extractLastPromptFromTail,
  extractJsonStringField,
  sanitizePath,
} from '../utils/sessionStoragePortable.js'
import { listOpenAICompatibleModels, getModelListUrls } from '../utils/providerDiscovery.js'
import { getInitialSettings, updateSettingsForSource } from '../utils/settings/settings.js'
import { TelegramBridge } from './telegram.js'
import { getContextWindowForModel } from '../utils/context.js'

/**
 * Turn metrics for the web bottom bar. contextUsed/contextWindow drive the
 * percentage; cacheRate is cache_read / (cache_read + cache_creation + input)
 * over the latest API call; tps is total output tokens per API second.
 */
function buildMetrics(
  usage: { input: number; output: number; cacheCreation: number; cacheRead: number },
  apiMs: number,
  model: string,
): {
  contextUsed: number
  contextWindow: number
  contextPercent: number
  cacheRate: number | null
  tps: number | null
} {
  const contextUsed = usage.input + usage.cacheCreation + usage.cacheRead
  const contextWindow = getContextWindowForModel(model)
  const cacheableTotal = usage.cacheRead + usage.cacheCreation + usage.input

  return {
    contextUsed,
    contextWindow,
    contextPercent: contextWindow > 0 ? (contextUsed / contextWindow) * 100 : 0,
    cacheRate: cacheableTotal > 0 ? usage.cacheRead / cacheableTotal : null,
    tps: apiMs > 0 ? (usage.output / apiMs) * 1000 : null,
  }
}

/**
 * Format tool use input into human-readable display text (matching CLI output style)
 */
function formatToolUseForDisplay(toolName: string, input: any, cwd?: string): string {
  switch (toolName) {
    case 'Edit': {
      const filePath = input.file_path || input.filePath || ''
      const oldStr = input.old_string || input.oldString || ''
      const newStr = input.new_string || input.newString || ''
      // Show full diff like CLI
      const header = `Update(${filePath})`
      // Split and remove only trailing empty string (from trailing newline)
      const oldLines = oldStr.split('\n')
      const newLines = newStr.split('\n')
      if (oldLines.length > 0 && oldLines[oldLines.length - 1] === '') oldLines.pop()
      if (newLines.length > 0 && newLines[newLines.length - 1] === '') newLines.pop()
      const diffNum = newLines.length - oldLines.length
      const diffStr = diffNum > 0 ? `+${diffNum}` : `${diffNum}`

      // Find line number of old_string in the file
      let startLine = -1
      try {
        const resolvedPath = filePath.startsWith('/') || filePath.match(/^[A-Za-z]:/)
          ? filePath
          : cwd ? join(cwd, filePath) : filePath
        const fileContent = readFileSync(resolvedPath, 'utf-8')
        const fileLines = fileContent.split('\n')
        const firstOldLine = oldLines[0]
        if (firstOldLine !== undefined) {
          for (let i = 0; i < fileLines.length; i++) {
            if (fileLines[i] === firstOldLine) {
              // Verify all old lines match
              let match = true
              for (let j = 0; j < oldLines.length; j++) {
                if (i + j >= fileLines.length || fileLines[i + j] !== oldLines[j]) {
                  match = false
                  break
                }
              }
              if (match) {
                startLine = i + 1 // 1-indexed
                break
              }
            }
          }
        }
      } catch { }

      // Format old and new content with line numbers
      const parts = [`${header} ${diffStr} lines`]
      for (let i = 0; i < oldLines.length; i++) {
        const lineNum = startLine > 0 ? `${startLine + i}` : ''
        parts.push(`- ${lineNum ? lineNum + ': ' : ''}${oldLines[i]}`)
      }
      for (let i = 0; i < newLines.length; i++) {
        const lineNum = startLine > 0 ? `${startLine + i}` : ''
        parts.push(`+ ${lineNum ? lineNum + ': ' : ''}${newLines[i]}`)
      }
      return parts.join('\n')
    }
    case 'Write': {
      const filePath = input.file_path || input.filePath || ''
      const content = input.content || ''
      const lines = content.split('\n').length
      return `Write(${filePath})\n  ${lines} lines`
    }
    case 'Read': {
      const filePath = input.file_path || input.filePath || ''
      const offset = input.offset ? ` from line ${input.offset}` : ''
      const limit = input.limit ? `, ${input.limit} lines` : ''
      return `Read(${filePath}${offset}${limit})`
    }
    case 'Bash': {
      const cmd = input.command || ''
      const truncated = cmd.length > 120 ? cmd.substring(0, 120) + '...' : cmd
      return `Bash: ${truncated}`
    }
    case 'Glob': {
      const pattern = input.pattern || ''
      const path = input.path ? ` in ${input.path}` : ''
      return `Glob(${pattern}${path})`
    }
    case 'Grep': {
      const pattern = input.pattern || ''
      const path = input.path ? ` in ${input.path}` : ''
      return `Grep(${pattern}${path})`
    }
    case 'WebFetch': {
      const url = input.url || ''
      return `WebFetch(${url})`
    }
    case 'WebSearch': {
      const query = input.query || ''
      return `WebSearch(${query})`
    }
    case 'Agent': {
      const desc = input.description || input.prompt?.substring(0, 80) || ''
      return `Agent(${desc})`
    }
    default: {
      // Generic formatting for unknown tools
      const keys = Object.keys(input || {})
      if (keys.length === 0) return toolName
      const summary = keys.map(k => `${k}: ${JSON.stringify(input[k]).substring(0, 50)}`).join(', ')
      return `${toolName}(${summary})`
    }
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

/**
 * Read a static asset embedded into the compiled executable. The `web/`
 * assets are embedded via `with { type: 'file' }` imports above; in the
 * binary their paths point into the $bunfs virtual filesystem. Returns null
 * when the file is missing, letting callers fall back to the filesystem
 * webRoot (dev mode / explicit --web-root override).
 */
async function readEmbeddedAsset(relPath: string): Promise<Buffer | null> {
  const assetPath = EMBEDDED_ASSETS[relPath]
  if (!assetPath) return null
  try {
    return Buffer.from(await Bun.file(assetPath).arrayBuffer())
  } catch {
    // Not an embedded build — fall through to the filesystem fallback.
  }
  return null
}

interface SessionData {
  messages: any[]
  createdAt: number
}

type Client = {
  ws: WebSocket
  send: (data: any) => void
}

/**
 * Owns the agent lifecycle for a session, decoupled from any single WS connection.
 * All connected clients subscribed to this session receive every event.
 * Late joiners get a replay of the current round's buffered events.
 */
class SessionRunner {
  sessionId: string
  cwd: string
  model: string | undefined
  private server: WebServer
  private clients = new Set<Client>()
  private engine: QueryEngine | null = null
  private appState: AppState = getDefaultAppState()
  private messages: any[] = []
  private interrupted = false
  private running = false
  private roundStartTime = 0
  private toolNameById = new Map<string, string>()
  private fileCache = new FileStateCache(READ_FILE_STATE_CACHE_SIZE, 25 * 1024 * 1024)
  // Event buffer for late joiners — events from the current execution round
  private eventBuffer: any[] = []
  private bufferSeq = 0

  constructor(server: WebServer, sessionId: string, cwd: string, model?: string) {
    this.server = server
    this.sessionId = sessionId
    this.cwd = cwd || process.cwd()
    this.model = model
  }

  addClient(c: Client) {
    this.clients.add(c)
    // Replay buffered events so the late joiner sees the current round's progress
    if (this.eventBuffer.length > 0) {
      for (const ev of this.eventBuffer) {
        c.send(ev)
      }
    }
    // Tell the newcomer whether a round is already in flight.
    // Tag with _sessionId so the client-side stale-event filter can
    // discard it if the user has already switched to another session.
    c.send({ type: 'subscribed', sessionId: this.sessionId, running: this.running, roundStartTime: this.roundStartTime, _sessionId: this.sessionId })
  }

  removeClient(c: Client) {
    this.clients.delete(c)
  }

  private broadcast(data: any) {
    // Tag every event with the originating session so clients can
    // discard stale events from a previous session after switching.
    data._sessionId = this.sessionId
    this.eventBuffer.push(data)
    this.bufferSeq++
    for (const c of this.clients) c.send(data)
  }

  isRunning() { return this.running }

  /** Replace the event buffer when starting a new round. */
  private resetBuffer() {
    this.eventBuffer = []
    this.bufferSeq = 0
  }

  async startRound(userMessage: string): Promise<void> {
    if (this.running) {
      // Notify all clients that the request was queued/rejected
      this.broadcast({ type: 'error', message: 'A request is already in progress' })
      return
    }

    // No global lock needed — runWithSessionContext scopes the session ID
    // per-async-chain, so multiple runners can execute concurrently.

    this.running = true
    this.interrupted = false
    this.roundStartTime = Date.now()
    this.resetBuffer()

    // Tell clients which session this round is being written to. The browser
    // needs this immediately (not at `done`) so that: (a) the active session
    // indicator tracks the freshly-created session, and (b) the sidebar can
    // refresh once the round finishes and the JSONL gains a summary record.
    const effectiveCwd = this.cwd || getOriginalCwd()
    this.broadcast({
      type: 'session_started',
      sessionId: this.sessionId,
      cwd: this.cwd,
      projectId: sanitizePath(effectiveCwd),
    })

    // Update the session title in the JSONL file so the sidebar shows
    // a meaningful label based on the user's message.
    this.updateSessionTitle(userMessage, effectiveCwd)

    // Load history from in-memory cache or JSONL file
    if (this.messages.length === 0) {
      const cached = this.server.getSessionMessages(this.sessionId)
      if (cached && cached.length > 0) {
        this.messages = [...cached]
      } else {
        try {
          const loaded = await this.server.loadSessionMessagesFromDisk(this.sessionId)
          if (loaded.length > 0) {
            const MAX_HISTORY = 40
            this.messages = loaded.slice(-MAX_HISTORY)
            this.server.setSessionMessages(this.sessionId, this.messages)
          }
        } catch {
          // fresh session
        }
      }
    }

    // Resolve model: prefer client-sent, then profile, then env
    let resolvedModel: string | undefined = this.model
    if (!resolvedModel) {
      const profile = loadProfileFile({ cwd: this.cwd })
      if (profile?.env?.OPENAI_MODEL) resolvedModel = profile.env.OPENAI_MODEL
    }
    if (!resolvedModel && process.env.OPENAI_MODEL) resolvedModel = process.env.OPENAI_MODEL

    // Scope the session ID, project dir, and working directory to this
    // async chain via AsyncLocalStorage so that recordTranscript (called
    // inside the engine) writes to the correct JSONL — and concurrent
    // runners each see their own cwd/model without clobbering each other.
    const transcriptProjectDir = join(getProjectsDir(), sanitizePath(effectiveCwd))

    // Pass this.cwd as initialCwd so getCwdState() returns the session's
    // directory instead of the global STATE.cwd (which concurrent runners
    // may have overwritten).  Shell `cd` commands inside this scope will
    // update the per-session ALS store via setCwdState().
    await runWithSessionContext(this.sessionId, transcriptProjectDir, async () => {
      // Set per-session model override (scoped to this ALS context).
      // Do NOT call setMainLoopModelOverride() — that mutates the global
      // singleton, which clobbers concurrent runners' model selection.
      if (resolvedModel) {
        setSessionModelOverride(parseUserSpecifiedModel(resolvedModel))
      }
      // Ensure the session's cwd is in the allowed working directories so
      // resetCwdIfOutsideProject() (called after every Bash execution) does
      // not reset the agent back to the server process's original cwd.
      // Must write back to this.appState: BashTool reads toolPermissionContext
      // via getAppState(), so a detached local copy is invisible to it.
      if (!this.appState.toolPermissionContext.additionalWorkingDirectories.has(this.cwd)) {
        const dirs = new Map(this.appState.toolPermissionContext.additionalWorkingDirectories)
        dirs.set(this.cwd, { path: this.cwd, source: 'session' })
        this.appState = {
          ...this.appState,
          toolPermissionContext: {
            ...this.appState.toolPermissionContext,
            additionalWorkingDirectories: dirs,
          },
        }
      }
      const toolPermCtx = this.appState.toolPermissionContext
      this.engine = new QueryEngine({
        cwd: this.cwd,
        tools: getTools(toolPermCtx),
        commands: [],
        mcpClients: [],
        agents: [],
        ...(this.messages.length > 0 ? { initialMessages: this.messages } : {}),
        includePartialMessages: true,
        canUseTool: async (tool, input, _context, _assistantMsg, toolUseID) => {
          if (toolUseID) this.toolNameById.set(toolUseID, tool.name)
          this.broadcast({
            type: 'tool_start',
            toolName: tool.name,
            arguments: input,
            toolUseId: toolUseID,
          })
          // Auto-approve all tool calls unconditionally
          return { behavior: 'allow' }
        },
        getAppState: () => this.appState,
        setAppState: (updater) => { this.appState = updater(this.appState) },
        readFileCache: this.fileCache,
        userSpecifiedModel: resolvedModel,
        fallbackModel: resolvedModel,
      })

      let fullText = ''
      let isThinking = false
      let currentToolUse: { id: string; name: string; inputJson: string } | null = null
      let lastDataTime = Date.now()
      let thinkingTokenEstimate = 0
      let turnUsage: {
        input: number
        output: number
        cacheCreation: number
        cacheRead: number
      } | null = null
      let turnApiMs = 0
      let apiCallStartedAt = 0
      const generator = this.engine.submitMessage(userMessage)

      const keepaliveTimer = setInterval(() => {
        const idleMs = Date.now() - lastDataTime
        this.broadcast({ type: 'keepalive', idleMs })
      }, 3000)

      try {
        for await (const event of generator) {
          lastDataTime = Date.now()
          if (this.interrupted) {
            clearInterval(keepaliveTimer)
            break
          }

        if (event.type === 'stream_event') {
          const delta = event.event
          if (delta.type === 'content_block_start') {
            if (delta.content_block?.type === 'thinking') {
              isThinking = true
              this.broadcast({ type: 'thinking_start' })
            } else if (delta.content_block?.type === 'tool_use') {
              if (isThinking) {
                isThinking = false
                this.broadcast({ type: 'thinking_end' })
              }
              currentToolUse = {
                id: delta.content_block.id,
                name: delta.content_block.name,
                inputJson: '',
              }
            }
          } else if (delta.type === 'content_block_delta') {
            if (delta.delta.type === 'thinking_delta') {
              thinkingTokenEstimate += delta.delta.thinking.length
              this.broadcast({ type: 'thinking_chunk', text: delta.delta.thinking, estimatedTokens: Math.round(thinkingTokenEstimate / 4) })
            } else if (delta.delta.type === 'text_delta') {
              if (isThinking) {
                isThinking = false
                this.broadcast({ type: 'thinking_end' })
              }
              this.broadcast({ type: 'text_chunk', text: delta.delta.text })
              fullText += delta.delta.text
            } else if (delta.delta.type === 'input_json_delta' && currentToolUse) {
              currentToolUse.inputJson += delta.delta.partial_json
            }
          } else if (delta.type === 'message_start') {
            apiCallStartedAt = Date.now()
          } else if (delta.type === 'message_delta') {
            // Authoritative per-call usage arrives here, not on the assembled
            // assistant message: the OpenAI shim only ever sets it on
            // message_delta. Values are cumulative for this one API call, so
            // input/cache describe the current context while output adds up
            // across the calls in a multi-tool turn.
            if (apiCallStartedAt > 0) {
              turnApiMs += Date.now() - apiCallStartedAt
              apiCallStartedAt = 0
            }
            const u = (delta as any).usage
            if (u) {
              const prevOutput: number = turnUsage ? turnUsage.output : 0
              turnUsage = {
                input: u.input_tokens ?? 0,
                output: prevOutput + (u.output_tokens ?? 0),
                cacheCreation: u.cache_creation_input_tokens ?? 0,
                cacheRead: u.cache_read_input_tokens ?? 0,
              }
            }
          } else if (delta.type === 'content_block_stop') {
            if (isThinking) {
              isThinking = false
              this.broadcast({ type: 'thinking_end' })
            }
            if (currentToolUse) {
              let toolInput: any = {}
              try { toolInput = JSON.parse(currentToolUse.inputJson) } catch { }
              const display = formatToolUseForDisplay(currentToolUse.name, toolInput, this.cwd)
              this.broadcast({
                type: 'tool_use_display',
                toolName: currentToolUse.name,
                toolUseId: currentToolUse.id,
                display,
              })
              currentToolUse = null
            }
          }
        } else if (event.type === 'user') {
          const content = event.message.content as Array<{ type: string, content: any, tool_use_id: string, is_error: boolean }>
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_result') {
                let outputStr = ''
                if (typeof block.content === 'string') {
                  outputStr = block.content
                } else if (Array.isArray(block.content)) {
                  outputStr = block.content
                    .map((c: any) => (c.type === 'text' ? c.text : ''))
                    .join('\n')
                }
                this.broadcast({
                  type: 'tool_result',
                  toolName: this.toolNameById.get(block.tool_use_id) ?? block.tool_use_id,
                  toolUseId: block.tool_use_id,
                  output: outputStr,
                  isError: block.is_error || false,
                })
              }
            }
          }
        } else if (event.type === 'assistant') {
          // Usage is captured from message_delta above — the assembled message
          // carries whatever message_start provided, which the shim leaves at
          // zero. Nothing to read here.
        } else if (event.type === 'result') {
          if (event.subtype === 'success') {
            if (event.is_error) {
              console.error('[web] API error (is_error):', event.result)
              this.broadcast({ type: 'error', message: event.result || 'Unknown API error' })
            } else if (event.result) {
              fullText = event.result
            }
          } else if (event.subtype === 'error_during_execution') {
            console.error('[web] error_during_execution:', event.result)
            this.broadcast({ type: 'error', message: event.result || 'Execution error' })
          } else if (event.subtype === 'error_max_turns') {
            this.broadcast({ type: 'error', message: event.result || 'Reached max turns' })
          }
        } else if (event.type === 'system') {
          // System events — no-op
        } else {
          // console.log('[web] unhandled event:', event)
        }
        // console.log(new Date(), '[web] event:', event.type)
      }

      if (!this.interrupted) {
        const rawMessages = [...this.engine.getMessages()]
        this.messages = rawMessages.slice(-60)
        this.server.setSessionMessages(this.sessionId, this.messages)
        const doneMsg: any = { type: 'done', fullText, sessionId: this.sessionId }
        // Only surface the bar when the provider actually reported usage.
        // Some OpenAI-compatible endpoints omit it entirely, and showing
        // 0/256k (0%) would read as "context is empty" rather than "unknown".
        if (turnUsage && turnUsage.input + turnUsage.output + turnUsage.cacheRead > 0) {
          Object.assign(doneMsg, { metrics: buildMetrics(turnUsage, turnApiMs, resolvedModel ?? '') })
        }
        this.broadcast(doneMsg)
      }
      } catch (err: any) {
        console.error('[web] runner error:', err.message, err.stack)
        this.broadcast({ type: 'error', message: err.message || 'Internal error' })
      } finally {
        clearInterval(keepaliveTimer)
        this.engine = null
        this.running = false
        this.resetBuffer()
      }
    }, this.cwd)
  }

  /**
   * Append a custom-title entry to the session JSONL file so the sidebar
   * shows a meaningful label based on the user's latest message.
   * Fire-and-forget — errors are logged but never block the round.
   */
  private updateSessionTitle(userMessage: string, effectiveCwd: string) {
    // Clean and truncate the message for use as a title
    let title = userMessage.replace(/[\r\n]+/g, ' ').trim()
    // Strip XML-like tags (task-notification, system-reminder, etc.)
    title = title.replace(/<[^>]+>/g, '').trim()
    if (!title) return
    if (title.length > 100) title = title.slice(0, 100).trim() + '\u2026'

    const projectDir = join(getProjectsDir(), sanitizePath(effectiveCwd))
    const filePath = join(projectDir, `${this.sessionId}.jsonl`)

    const entry = JSON.stringify({
      type: 'custom-title',
      customTitle: title,
      sessionId: this.sessionId,
    }) + '\n'

    appendFile(filePath, entry, { mode: 0o600 }).catch(err => {
      console.error('[web] Failed to update session title:', err.message)
    })
  }

  cancel() {
    this.interrupted = true
    if (this.engine) this.engine.interrupt()
    this.broadcast({ type: 'cancelled' })
  }

}

/**
 * Resolve the filesystem web/ static assets directory. Only used as a
 * fallback in dev mode (or an explicit --web-root override) — in the
 * compiled binary the assets are embedded and served first.
 */
function resolveWebRoot(explicit?: string): string {
  if (explicit) return resolve(explicit)
  if (process.env.PORTAL_WEB_ROOT) return resolve(process.env.PORTAL_WEB_ROOT)

  const candidates: string[] = []
  candidates.push(join(process.cwd(), 'web'))
  if (import.meta.dirname) {
    candidates.push(join(import.meta.dirname, '../../web'))
  }

  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) return resolve(c)
  }
  // Fall back to the last candidate so error messages reference a real path.
  return resolve(candidates[candidates.length - 1])
}

export class WebServer {
  private httpServer: ReturnType<typeof createServer>
  private wss: WebSocketServer
  private sessions: Map<string, SessionData> = new Map()
  private runners: Map<string, SessionRunner> = new Map()
  private webRoot: string
  private webRootExplicit: boolean
  private port: number | undefined
  private host: string
  private telegram: TelegramBridge | null = null

  constructor(options: { port?: number; host?: string; webRoot?: string } = {}) {
    this.port = options.port
    this.host = options.host ?? '0.0.0.0'
    this.webRoot = resolveWebRoot(options.webRoot)
    this.webRootExplicit = !!options.webRoot

    this.httpServer = createServer(this.handleHttpRequest.bind(this))
    this.wss = new WebSocketServer({ server: this.httpServer })
    this.wss.on('connection', this.handleConnection.bind(this))
  }

  private async handleHttpRequest(req: any, res: any) {
    const url = new URL(req.url, `http://${req.headers.host}`)
    // API endpoints
    if (url.pathname === '/api/projects') {
      return this.handleListProjects(res)
    }
    if (url.pathname === '/api/sessions') {
      const project = url.searchParams.get('project') || undefined
      return this.handleListSessions(res, project)
    }
    if (url.pathname === '/api/session-messages') {
      const project = url.searchParams.get('project') || ''
      const session = url.searchParams.get('session') || ''
      const offset = parseInt(url.searchParams.get('offset') || '0', 10)
      const limit = parseInt(url.searchParams.get('limit') || '40', 10)
      return this.handleGetSessionMessages(res, project, session, offset, limit)
    }
    if (url.pathname === '/api/browse-directory') {
      const dirPath = url.searchParams.get('path') || ''
      return this.handleBrowseDirectory(res, dirPath)
    }
    if (url.pathname === '/api/create-directory') {
      let body = ''
      req.on('data', (chunk: string) => { body += chunk })
      req.on('end', () => {
        const { path: dirPath } = JSON.parse(body)
        return this.handleCreateDirectory(res, dirPath)
      })
      return
    }
    if (url.pathname === '/api/models') {
      const baseUrl = url.searchParams.get('baseUrl') || undefined
      const apiKey = url.searchParams.get('apiKey') || undefined
      return this.handleListModels(res, baseUrl, apiKey)
    }
    if (url.pathname === '/api/session' && req.method === 'DELETE') {
      const project = url.searchParams.get('project') || ''
      const session = url.searchParams.get('session') || ''
      return this.handleDeleteSession(res, project, session)
    }

    // Static files: embedded assets first (compiled binary), then the
    // filesystem webRoot (dev mode / explicit --web-root override).
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname
    const rel = filePath.replace(/^\/+/, '')
    const ext = extname(filePath)

    if (!this.webRootExplicit && !rel.includes('..')) {
      const embedded = await readEmbeddedAsset(rel)
      if (embedded) {
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' })
        res.end(embedded)
        return
      }
    }

    try {
      const content = await readFile(join(this.webRoot, filePath))
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' })
      res.end(content)
    } catch (err: any) {
      res.writeHead(404)
      res.end('Not Found')
    }
  }

  private async handleListProjects(res: any) {
    try {
      const projectsDir = getProjectsDir()
      const dirents = await readdir(projectsDir, { withFileTypes: true })

      const projects = await Promise.all(
        dirents
          .filter(d => d.isDirectory())
          .map(async d => {
            const projectPath = join(projectsDir, d.name)
            // Get sessions directly from the project directory
            const sessions = await this.getProjectSessions(projectPath)
            // Get real filesystem path from first session's cwd
            const realPath = sessions[0]?.cwd || this.denormalizeProjectName(d.name)
            return {
              id: d.name,
              name: this.denormalizeProjectName(d.name),
              path: realPath,
              lastModified: sessions[0]?.lastModified || 0,
              sessionCount: sessions.length,
            }
          })
      )

      // Sort by last modified
      projects.sort((a, b) => b.lastModified - a.lastModified)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(projects))
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  }

  private async collectSessions(project?: string): Promise<SessionInfo[]> {
    const projectsDir = getProjectsDir()

    if (project) {
      return this.getProjectSessions(join(projectsDir, project), 50)
    }

    const dirents = await readdir(projectsDir, { withFileTypes: true })
    const all: SessionInfo[] = []
    for (const d of dirents) {
      if (!d.isDirectory()) continue
      all.push(...(await this.getProjectSessions(join(projectsDir, d.name), 10)))
    }
    all.sort((a, b) => b.lastModified - a.lastModified)
    return all.slice(0, 50)
  }

  private async handleListSessions(res: any, project?: string) {
    try {
      const sessions = await this.collectSessions(project)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(sessions))
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  }

  private async handleDeleteSession(res: any, project: string, session: string) {
    try {
      if (!project || !session) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing project or session parameter' }))
        return
      }

      // Don't allow deleting the current active session
      const currentSessionId = getSessionId()
      if (session === currentSessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Cannot delete the currently active session' }))
        return
      }

      const projectsDir = getProjectsDir()
      const sessionPath = join(projectsDir, project, `${session}.jsonl`)

      // Verify the session file exists
      try {
        await stat(sessionPath)
      } catch {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Session not found' }))
        return
      }

      // Delete the session file
      await unlink(sessionPath)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  }

  /**
   * Read session files directly from a project directory
   */
  private async getProjectSessions(projectPath: string, limit?: number): Promise<SessionInfo[]> {
    try {
      const files = await readdir(projectPath)
      const sessionFiles = files.filter(f => f.endsWith('.jsonl') && !f.includes('subagents'))

      const sessions: SessionInfo[] = []

      for (const file of sessionFiles) {
        const sessionId = file.replace('.jsonl', '')
        const filePath = join(projectPath, file)

        try {
          const lite = await readSessionLite(filePath)
          if (!lite) continue

          const { head, tail, mtime, size } = lite

          // Skip sidechain sessions
          const firstNewline = head.indexOf('\n')
          const firstLine = firstNewline >= 0 ? head.slice(0, firstNewline) : head
          if (firstLine.includes('"isSidechain":true') || firstLine.includes('"isSidechain": true')) {
            continue
          }

          // Extract metadata
          const customTitle =
            extractLastJsonStringField(tail, 'customTitle') ||
            extractLastJsonStringField(head, 'customTitle') ||
            extractLastJsonStringField(tail, 'aiTitle') ||
            extractLastJsonStringField(head, 'aiTitle') ||
            undefined
          const firstPrompt = extractFirstPromptFromHead(head) || undefined

          const firstTimestamp = extractJsonStringField(head, 'timestamp')
          let createdAt: number | undefined
          if (firstTimestamp) {
            const parsed = Date.parse(firstTimestamp)
            if (!Number.isNaN(parsed)) createdAt = parsed
          }

          const summary =
            customTitle ||
            extractLastPromptFromTail(tail) ||
            extractLastJsonStringField(tail, 'lastPrompt') ||
            extractLastJsonStringField(tail, 'summary') ||
            firstPrompt

          // Skip sessions with no summary
          if (!summary) continue

          const gitBranch =
            extractLastJsonStringField(tail, 'gitBranch') ||
            extractJsonStringField(head, 'gitBranch') ||
            undefined
          const cwd = extractJsonStringField(head, 'cwd') || undefined

          sessions.push({
            sessionId,
            summary,
            lastModified: mtime,
            fileSize: size,
            customTitle,
            firstPrompt,
            gitBranch,
            cwd,
            createdAt,
          })
        } catch {
          // Skip unreadable files
          continue
        }
      }

      // Sort by last modified (newest first)
      sessions.sort((a, b) => b.lastModified - a.lastModified)

      return limit ? sessions.slice(0, limit) : sessions
    } catch {
      return []
    }
  }

  private denormalizeProjectName(sanitized: string): string {
    // Convert -Users-foo-my-project back to /Users/foo/my-project
    // The sanitized name uses - for path separators
    const parts = sanitized.split('-').filter(p => p.length > 0)
    // Check if first part is a Windows drive letter (e.g., "C")
    if (parts.length >= 2 && parts[0].length === 1 && /^[A-Z]$/.test(parts[0])) {
      // Windows path: C--items-portal -> C:/items/portal
      return parts[0] + ':/' + parts.slice(1).join('/')
    }
    // Unix path: Users-foo-my-project -> /Users/foo/my-project
    return '/' + parts.join('/')
  }

  private async handleGetSessionMessages(res: any, project: string, session: string, offset: number = 0, limit: number = 40) {
    try {
      if (!project || !session) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing project or session parameter' }))
        return
      }

      const projectsDir = getProjectsDir()
      const projectPath = join(projectsDir, project)
      const filePath = join(projectPath, `${session}.jsonl`)

      // Read and parse JSONL file
      const messages: any[] = []
      let sessionCwd = ''
      const fileStream = createReadStream(filePath, { encoding: 'utf8' })
      const rl = createInterface({ input: fileStream, crlfDelay: Infinity })

      let isFirstLine = true
      for await (const line of rl) {
        if (!line.trim()) continue
        try {
          const entry = JSON.parse(line)
          // Extract cwd from first line (session metadata)
          if (isFirstLine) {
            isFirstLine = false
            sessionCwd = entry.cwd || ''
          }
          // Only include user and assistant messages (skip metadata and summaries)
          if (entry.type === 'user' || entry.type === 'assistant') {
            // Skip compact summary messages
            if (entry.isCompactSummary || entry.isMeta) continue

            // Filter out system notification messages
            const rawContent = entry.message?.content
            if (typeof rawContent === 'string' && (rawContent.includes('<task-notification>') || rawContent.includes('<system-reminder>'))) {
              continue
            }
            if (Array.isArray(rawContent)) {
              const hasNotification = rawContent.some((b: any) =>
                b.type === 'text' && (b.text.includes('<task-notification>') || b.text.includes('<system-reminder>'))
              )
              if (hasNotification) continue
            }

            let content = ''
            const toolCalls: any[] = []
            const msgContent = entry.message?.content

            if (typeof msgContent === 'string') {
              content = msgContent
            } else if (Array.isArray(msgContent)) {
              // Extract text from content blocks (skip thinking blocks)
              content = msgContent
                .filter((block: any) => block.type === 'text')
                .map((block: any) => block.text)
                .join('\n')

              // Extract tool_use blocks for display
              for (const block of msgContent) {
                if (block.type === 'tool_use') {
                  toolCalls.push({
                    toolName: block.name,
                    toolUseId: block.id,
                    display: formatToolUseForDisplay(block.name, block.input, sessionCwd),
                  })
                }
              }
            }

            // Skip messages that look like session continuation summaries
            if (content.startsWith('This session is being continued from')) continue
            if (content.startsWith('Summary:')) continue

            if (content || toolCalls.length > 0) {
              const msg: any = {
                role: entry.type,
                content,
                timestamp: entry.timestamp,
              }
              if (toolCalls.length > 0) {
                msg.toolCalls = toolCalls
              }
              messages.push(msg)
            }
          }
        } catch {
          // Skip malformed lines
        }
      }

      // Pagination: offset is how many messages from the end to skip
      const total = messages.length
      const start = Math.max(0, total - offset - limit)
      const end = total - offset
      const sliced = messages.slice(start, end)
      const hasMore = start > 0

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ messages: sliced, total, hasMore }))
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  }

  private async handleBrowseDirectory(res: any, dirPath: string) {
    try {
      if (!dirPath) {
        // Default to home directory
        dirPath = homedir()
      }

      // On Windows, normalize bare drive letters: "C:" -> "C:\\"
      if (process.platform === 'win32') {
        dirPath = dirPath.replace(/^([A-Za-z]):$/i, '$1:\\')
      }

      // Resolve the path to prevent directory traversal attacks
      const resolved = await canonicalizePath(dirPath)
      if (!resolved) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid path' }))
        return
      }

      // On Windows, ensure drive root paths have trailing separator for stat/readdir
      let statPath = resolved
      if (process.platform === 'win32' && /^[A-Za-z]:$/i.test(resolved)) {
        statPath = resolved + '\\'
      }

      const dirStat = await stat(statPath)
      if (!dirStat.isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not a directory' }))
        return
      }

      const dirents = await readdir(statPath, { withFileTypes: true })
      const entries = await Promise.all(
        dirents
          .filter(d => d.isDirectory())
          .map(async d => {
            const fullPath = join(statPath, d.name)
            let isAccessible = true
            try {
              await stat(fullPath)
            } catch {
              isAccessible = false
            }
            return {
              name: d.name,
              path: fullPath,
              accessible: isAccessible,
            }
          })
      )

      // Sort: accessible first, then by name
      entries.sort((a, b) => {
        if (a.accessible !== b.accessible) return a.accessible ? -1 : 1
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      })

      // Get parent path — use resolve to handle Windows drive roots correctly
      const parentPath = resolve(statPath, '..')

      // On Windows, resolve('C:\\', '..') returns 'C:\\' — detect root by comparing normalized forms
      let normalizedResolved = statPath
      let normalizedParent = parentPath
      if (process.platform === 'win32') {
        // Normalize trailing separator for comparison: "C:\" vs "C:\" — should match
        normalizedResolved = win32.normalize(statPath)
        normalizedParent = win32.normalize(parentPath)
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        currentPath: normalizedResolved,
        parentPath: normalizedResolved === normalizedParent ? null : parentPath,
        entries,
      }))
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  }

  private async handleCreateDirectory(res: any, dirPath: string) {
    try {
      if (!dirPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Path is required' }))
        return
      }

      // On Windows, normalize bare drive letters
      if (process.platform === 'win32') {
        dirPath = dirPath.replace(/^([A-Za-z]):$/i, '$1:\\')
      }

      // Prevent directory traversal
      const resolved = await canonicalizePath(dirPath)
      // Verify the parent exists before creating
      const parent = join(resolved, '..')

      let parentStatPath = parent
      if (process.platform === 'win32' && /^[A-Za-z]:$/i.test(parent)) {
        parentStatPath = parent + '\\'
      }

      try {
        await stat(parentStatPath)
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Parent directory does not exist' }))
        return
      }

      await mkdir(resolved, { recursive: false })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ path: resolved }))
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        res.writeHead(409, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Directory already exists' }))
        return
      }
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  }

  private async handleListModels(res: any, baseUrlOverride?: string, apiKeyOverride?: string) {
    try {
      const profile = loadProfileFile({ cwd: process.cwd() })
      const baseUrl = baseUrlOverride || profile?.env?.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL
      const apiKey = apiKeyOverride || profile?.env?.OPENAI_API_KEY || process.env.OPENAI_API_KEY

      const models = await listOpenAICompatibleModels({ baseUrl, apiKey })

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ models: models ?? [] }))
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message, models: [] }))
    }
  }

  private async loadSessionMessagesFromFile(filePath: string): Promise<any[]> {
    const messages: any[] = []
    const fileStream = createReadStream(filePath, { encoding: 'utf8' })
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity })

    for await (const line of rl) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line)
        if (entry.type === 'user' || entry.type === 'assistant') {
          // Skip compact summary and meta messages
          if (entry.isCompactSummary || entry.isMeta) continue

          // Reconstruct Message object from TranscriptMessage
          // Message type needs: type, uuid, timestamp, message, plus optional fields
          if (entry.message) {
            // Filter out system notification messages (task-notification, system-reminder)
            const msgContent = entry.message.content
            if (typeof msgContent === 'string' && (msgContent.includes('<task-notification>') || msgContent.includes('<system-reminder>'))) {
              continue
            }
            if (Array.isArray(msgContent)) {
              const hasNotification = msgContent.some((b: any) =>
                b.type === 'text' && (b.text.includes('<task-notification>') || b.text.includes('<system-reminder>'))
              )
              if (hasNotification) continue
            }

            const msg: any = {
              type: entry.type,
              uuid: entry.uuid,
              timestamp: entry.timestamp,
              message: entry.message,
            }
            // Preserve optional fields that QueryEngine may use
            if (entry.toolUseResult) msg.toolUseResult = entry.toolUseResult
            if (entry.isMeta) msg.isMeta = entry.isMeta
            if (entry.isCompactSummary) msg.isCompactSummary = entry.isCompactSummary
            messages.push(msg)
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    return messages
  }

  private handleConnection(ws: WebSocket) {
    let subscribedRunner: SessionRunner | null = null

    const send = (data: any) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data))
      }
    }

    const client: Client = { ws, send }

    ws.on('message', async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString())

        if (msg.type === 'subscribe') {
          // Subscribe this connection to a session's event stream
          const sid = msg.sessionId
          if (!sid) {
            send({ type: 'error', message: 'subscribe requires sessionId' })
            return
          }
          // Detach from previous runner if any
          if (subscribedRunner) {
            subscribedRunner.removeClient(client)
          }
          let runner = this.runners.get(sid)
          if (!runner) {
            // Do NOT silently fall back to process.cwd() here (unlike the
            // chat path): subscribe is automatic (page load / reconnect),
            // so a missing cwd almost always means the frontend hasn't
            // resolved the project yet.  Creating a runner now would pin
            // the session to the server's cwd, leaking transcript/memory
            // into the wrong project directory (unrecoverable).  Bail out
            // and let the frontend re-subscribe once it has the real cwd.
            if (!msg.cwd) {
              send({ type: 'error', message: 'subscribe requires cwd; retry after project is selected' })
              return
            }
            runner = new SessionRunner(this, sid, msg.cwd, msg.model)
            this.runners.set(sid, runner)
          } else if (msg.cwd && msg.cwd !== runner.cwd) {
            // Correct a stale cwd on an existing runner (e.g. created by a
            // previous subscribe that didn't carry cwd).
            runner.cwd = msg.cwd
          }
          runner.addClient(client)
          subscribedRunner = runner
          return
        }

        if (msg.type === 'chat') {
          // Ensure we have (or create) a runner for this session
          const sid = msg.sessionId || randomUUID()
          let runner = this.runners.get(sid)
          if (!runner) {
            // Prefer the client-supplied cwd; only fall back to process.cwd()
            // if the client didn't send one.  Logging here makes it obvious
            // when the frontend forgot to send cwd (a frequent source of
            // "agent ran in the wrong directory" bugs).
            const initialCwd = msg.cwd || process.cwd()
            if (!msg.cwd) {
              console.warn(`[web] chat for sid=${sid} missing cwd; falling back to ${initialCwd}`)
            }
            runner = new SessionRunner(this, sid, initialCwd, msg.model)
            this.runners.set(sid, runner)
          } else if (msg.cwd && msg.cwd !== runner.cwd) {
            // Update the runner's cwd so a stale runner (e.g. one created by
            // an earlier subscribe that didn't carry cwd) is corrected before
            // this round starts.  Without this, the agent can end up running
            // in the server's process.cwd() even though the UI shows the
            // correct project path.
            runner.cwd = msg.cwd
          }
          // Auto-subscribe this client if not already
          if (subscribedRunner !== runner) {
            if (subscribedRunner) subscribedRunner.removeClient(client)
            runner.addClient(client)
            subscribedRunner = runner
          }

          if (runner.isRunning()) {
            send({ type: 'error', message: 'A request is already in progress' })
            return
          }

          // Update the runner's model so changes in the settings dropdown
          // take effect immediately for this and subsequent rounds.
          if (msg.model) runner.model = msg.model

          // Fire-and-forget: the runner broadcasts to all subscribers
          runner.startRound(msg.message)
          return
        }

        if (msg.type === 'cancel') {
          if (subscribedRunner) subscribedRunner.cancel()
          return
        }

        if (msg.type === 'get_config') {
          const profile = loadProfileFile({ cwd: process.cwd() })
          const settings = getInitialSettings()
          send({
            type: 'config',
            profile: profile?.profile || 'openai',
            baseUrl: profile?.env?.OPENAI_BASE_URL || '',
            model: profile?.env?.OPENAI_MODEL || '',
            apiKey: profile?.env?.OPENAI_API_KEY ? '••••••••' : '',
            hasApiKey: !!profile?.env?.OPENAI_API_KEY,
            language: settings.language || 'chinese',
            hasTelegramToken: !!(settings as any).telegramBotToken,
            telegramRunning: this.telegram?.isRunning ?? false,
            cwd: process.cwd(),
          })
          return
        }

        if (msg.type === 'save_config') {
          const profile: ProviderProfile = msg.profile || 'openai'
          const env: ProfileEnv = {
            OPENAI_BASE_URL: msg.baseUrl || undefined,
            OPENAI_MODEL: msg.model || undefined,
          }

          if (msg.apiKey && msg.apiKey !== '••••••••') {
            env.OPENAI_API_KEY = msg.apiKey
          } else {
            const existing = loadProfileFile({ cwd: process.cwd() })
            if (existing?.env?.OPENAI_API_KEY) {
              env.OPENAI_API_KEY = existing.env.OPENAI_API_KEY
            }
          }

          send({ type: 'config_validating' })

          try {
            // Try the same candidate URLs as /api/models (listOpenAICompatibleModels)
            // so validation accepts exactly the configs that can actually list
            // models. The naive "{baseUrl}/models" construction rejects valid
            // providers that only serve /v1/models (OpenAI, Ollama, etc.).
            const baseUrl = env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
            const validateUrls = getModelListUrls(baseUrl)

            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
            }
            if (env.OPENAI_API_KEY) {
              headers['Authorization'] = `Bearer ${env.OPENAI_API_KEY}`
            }

            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 10000)

            let lastError = 'Unable to reach the API. Check your Base URL.'
            let validated = false
            for (const validateUrl of validateUrls) {
              if (controller.signal.aborted) break

              let response: Response | undefined
              try {
                response = await fetch(validateUrl, {
                  method: 'GET',
                  headers,
                  signal: controller.signal,
                })
              } catch (fetchErr: any) {
                if (fetchErr.name === 'AbortError') {
                  lastError = 'Connection timeout. Check your Base URL.'
                  break
                }
                lastError = `Connection failed: ${fetchErr.message}`
                continue
              }

              if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error')
                lastError = `API returned ${response.status}: ${errorText}`
                continue
              }

              const data = await response.json().catch(() => null)
              if (!data || (!data.data && !Array.isArray(data))) {
                lastError = 'Invalid response from API. Check your Base URL.'
                continue
              }

              validated = true
              break
            }
            clearTimeout(timeout)

            if (!validated) {
              send({ type: 'config_error', message: lastError })
              return
            }

            const profileFile = createProfileFile(profile, env)
            saveProfileFile(profileFile, { cwd: process.cwd() })

            if (env.OPENAI_BASE_URL) process.env.OPENAI_BASE_URL = env.OPENAI_BASE_URL
            if (env.OPENAI_MODEL) process.env.OPENAI_MODEL = env.OPENAI_MODEL
            if (env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = env.OPENAI_API_KEY

            // Save language setting to settings.json
            if (msg.language !== undefined) {
              const langValue = msg.language || undefined  // empty string → undefined to delete
              updateSettingsForSource('userSettings', { language: langValue } as any)
            }

            if (msg.telegramToken !== undefined) {
              // The mask means "keep the saved token"; undefined means untouched.
              if (msg.telegramToken !== '••••••••') {
                const tgValue = msg.telegramToken.trim() || undefined
                updateSettingsForSource('userSettings', { telegramBotToken: tgValue } as any)
                void this.restartTelegram(tgValue)
              }
            }

            send({ type: 'config_saved', success: true })

          } catch (validateErr: any) {
            const message = validateErr.name === 'AbortError'
              ? 'Connection timeout. Check your Base URL.'
              : `Connection failed: ${validateErr.message}`
            send({
              type: 'config_error',
              message,
            })
          }
          return
        }

      } catch (err: any) {
        console.error('[web] WebSocket handler error:', err.message, err.stack)
        send({ type: 'error', message: err.message || 'Internal error' })
      }
    })

    ws.on('close', () => {
      // Just detach from the runner — do NOT interrupt the agent.
      // Other subscribers (if any) keep the session alive; if none remain,
      // the agent finishes on its own.
      if (subscribedRunner) {
        subscribedRunner.removeClient(client)
        subscribedRunner = null
      }
    })
  }

  start() {
    return new Promise<void>((resolveStart, rejectStart) => {
      this.httpServer.once('error', rejectStart)
      this.httpServer.listen(this.port ?? 0, this.host, () => {
        const addr = this.httpServer.address()
        const boundPort = typeof addr === 'object' && addr ? addr.port : this.port
        this.port = boundPort
        const displayHost = this.host === '0.0.0.0' || this.host === '::' ? '127.0.0.1' : this.host
        const url = `http://${displayHost}:${boundPort}`
        // Plain log line so launchers/grep can find the URL reliably.
        console.log(`Portal Web UI listening on ${url} (host=${this.host})`)
        void this.restartTelegram((getInitialSettings() as any).telegramBotToken)
        resolveStart()
      })
    })
  }

  /** Start the bridge with `token`, or stop it when there is none. */
  async restartTelegram(token: string | undefined): Promise<void> {
    this.telegram?.stop()
    this.telegram = null
    if (!token) return

    const bridge = new TelegramBridge({
      token,
      cwd: getOriginalCwd(),
      getRunner: sid => this.runners.get(sid),
      createRunner: sid => {
        const runner = new SessionRunner(this, sid, getOriginalCwd())
        this.runners.set(sid, runner)
        return runner
      },
      createRunnerIn: (sid, cwd) => {
        const existing = this.runners.get(sid)
        if (existing) {
          existing.cwd = cwd
          return existing
        }
        const runner = new SessionRunner(this, sid, cwd)
        this.runners.set(sid, runner)
        return runner
      },
      attachClient: (sessionId, client) => {
        this.runners.get(sessionId)?.addClient(client)
      },
      detachClient: (sessionId, client) => {
        this.runners.get(sessionId)?.removeClient(client)
      },
      listSessions: async () => {
        const sessions = await this.collectSessions()
        return sessions.map(s => ({
          sessionId: s.sessionId,
          title: s.customTitle || s.summary || s.firstPrompt || '(untitled)',
          lastModified: s.lastModified,
          cwd: s.cwd,
        }))
      },
    })
    if (await bridge.start()) this.telegram = bridge
  }

  /** Actual bound port (resolved after start()). */
  get boundPort(): number {
    return this.port ?? 0
  }

  /** Local URL for this machine's browser (resolved after start()). */
  get localUrl(): string {
    return `http://127.0.0.1:${this.boundPort}`
  }

  /** In-memory message cache accessor (used by SessionRunner) */
  getSessionMessages(sessionId: string): any[] | null {
    const s = this.sessions.get(sessionId)
    return s ? s.messages : null
  }

  setSessionMessages(sessionId: string, messages: any[]) {
    this.sessions.set(sessionId, { messages, createdAt: Date.now() })
  }

  /** Load messages for a session by scanning project dirs for the JSONL file. */
  async loadSessionMessagesFromDisk(sessionId: string): Promise<any[]> {
    try {
      const projectsDir = getProjectsDir()
      const dirents = await readdir(projectsDir, { withFileTypes: true })
      for (const d of dirents) {
        if (!d.isDirectory()) continue
        const projectPath = join(projectsDir, d.name)
        const filePath = join(projectPath, `${sessionId}.jsonl`)
        try {
          await readFile(filePath)
          return await this.loadSessionMessagesFromFile(filePath)
        } catch {
          // not in this project dir
        }
      }
    } catch {
      // projects dir missing
    }
    return []
  }
}
