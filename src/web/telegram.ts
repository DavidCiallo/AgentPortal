import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Bridges a Telegram bot to the same SessionRunner instances the browser uses.
 * Telegram chats are just another client: they subscribe to a runner and
 * receive its broadcast events, so a round started in either place is visible
 * in the other.
 *
 * Long polling only — this runs on a machine with no public address, so a
 * webhook would need an inbound HTTPS endpoint that does not exist here.
 */

const API_BASE = 'https://api.telegram.org'
const POLL_TIMEOUT_S = 25
const MAX_MESSAGE_CHARS = 4000

type ChatState = {
  sessionId: string
  /** Assistant text accumulated for the round currently in flight. */
  pendingText: string
  /** Whether the virtual client is already attached to the runner. */
  subscribed?: boolean
  subscribedSession?: string
  /** Sessions shown by the last /list, so /use N can resolve a number. */
  lastList?: ListedSession[]
  /** Working directory of the current session, used when switching projects. */
  cwd?: string
  /** Wall-clock start of the round in flight, for the heartbeat. */
  roundStartedAt?: number
  /** Highest power-of-two minute already announced this round. */
  lastHeartbeatPower?: number
  heartbeatTimer?: ReturnType<typeof setInterval> | null
}

type ListedSession = { sessionId: string; title: string; lastModified: number; cwd?: string }

export type TelegramToolLine = { name: string; display?: string }

function chatsFile(): string {
  return join(homedir(), '.portal', 'telegram-chats.json')
}

async function loadChats(): Promise<Record<string, ChatState>> {
  try {
    const raw = await readFile(chatsFile(), 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function saveChats(chats: Record<string, ChatState>): Promise<void> {
  const file = chatsFile()
  await mkdir(dirname(file), { recursive: true })
  // sessionId and cwd are the only fields worth keeping across restarts; the
  // transient round buffers would otherwise resurrect a half-finished message.
  const trimmed: Record<string, { sessionId: string; cwd?: string }> = {}
  for (const [chatId, state] of Object.entries(chats)) {
    trimmed[chatId] = { sessionId: state.sessionId, cwd: state.cwd }
  }
  await writeFile(file, JSON.stringify(trimmed, null, 2), 'utf8')
}

export class TelegramBridge {
  private token: string
  private cwd: string
  private getRunner: (sessionId: string) => any
  private createRunner: (sessionId: string) => any
  private createRunnerIn: (sessionId: string, cwd: string) => any
  private attachClient: (sessionId: string, client: any) => void
  private detachClient: (sessionId: string, client: any) => void
  private listSessions: () => Promise<ListedSession[]>
  private chats: Record<string, ChatState> = {}
  private clients = new Map<string, any>()
  private offset = 0
  private stopped = false
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private botUsername = ''

  constructor(opts: {
    token: string
    cwd: string
    getRunner: (sessionId: string) => any
    createRunner: (sessionId: string) => any
    createRunnerIn: (sessionId: string, cwd: string) => any
    attachClient: (sessionId: string, client: any) => void
    detachClient: (sessionId: string, client: any) => void
    listSessions: () => Promise<ListedSession[]>
  }) {
    this.token = opts.token
    this.cwd = opts.cwd
    this.getRunner = opts.getRunner
    this.createRunner = opts.createRunner
    this.createRunnerIn = opts.createRunnerIn
    this.attachClient = opts.attachClient
    this.detachClient = opts.detachClient
    this.listSessions = opts.listSessions
  }

  async start(): Promise<boolean> {
    this.chats = {}
    const stored = await loadChats()
    for (const [chatId, v] of Object.entries(stored)) {
      this.chats[chatId] = {
        sessionId: v.sessionId,
        cwd: v.cwd,
        pendingText: '',
        subscribed: false,
      }
    }

    const me = await this.call('getMe', {})
    if (!me.ok) {
      console.error('[telegram] getMe failed:', me.description)
      return false
    }
    this.botUsername = me.result?.username ?? ''
    console.log(`[telegram] connected as @${this.botUsername}`)
    this.stopped = false
    void this.pollLoop()
    return true
  }

  stop(): void {
    this.stopped = true
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = null
  }

  get isRunning(): boolean {
    return !this.stopped
  }

  private async call(method: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${API_BASE}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  /** Returns the sent message's id, or null when nothing was sent. */
  private async send(chatId: number | string, text: string, markdown = true): Promise<number | null> {
    const chunk = text.length > MAX_MESSAGE_CHARS
      ? text.slice(0, MAX_MESSAGE_CHARS) + '\n\n… (truncated)'
      : text
    if (!chunk.trim()) return null
    const res = await this.call('sendMessage', {
      chat_id: chatId,
      text: chunk,
      ...(markdown ? { parse_mode: 'Markdown' } : {}),
    })
    if (res.ok) return res.result?.message_id ?? null

    // Telegram rejects malformed Markdown outright; resend as plain text so
    // the reply is never swallowed by a formatting error.
    if (markdown) {
      const plain = await this.call('sendMessage', { chat_id: chatId, text: chunk })
      return plain.ok ? (plain.result?.message_id ?? null) : null
    }
    return null
  }

  private async pollLoop(): Promise<void> {
    if (this.stopped) return
    try {
      const res = await this.call('getUpdates', {
        offset: this.offset,
        timeout: POLL_TIMEOUT_S,
        allowed_updates: ['message'],
      })
      if (res.ok && Array.isArray(res.result)) {
        for (const update of res.result) {
          this.offset = update.update_id + 1
          const msg = update.message
          if (!msg?.text) continue
          await this.handleMessage(msg)
        }
      } else if (!res.ok) {
        console.error('[telegram] getUpdates:', res.description)
        // Back off on a rejected token or network error instead of spinning.
        await new Promise(r => setTimeout(r, 5000))
      }
    } catch (err: any) {
      console.error('[telegram] poll error:', err.message)
      await new Promise(r => setTimeout(r, 5000))
    }
    if (!this.stopped) this.pollLoop()
  }

  private async handleMessage(msg: any): Promise<void> {
    const chatId = String(msg.chat.id)
    const text = String(msg.text).trim()

    if (text.startsWith('/')) {
      await this.handleCommand(chatId, text)
      return
    }

    const state = this.ensureChat(chatId)
    const runner = this.getRunner(state.sessionId)
      ?? (state.cwd
        ? this.createRunnerIn(state.sessionId, state.cwd)
        : this.createRunner(state.sessionId))

    this.ensureSubscribed(chatId, state)

    if (runner.isRunning()) {
      await this.send(chatId, 'A request is already in progress. Send /stop to cancel it.', false)
      return
    }

    state.pendingText = ''
    await this.send(chatId, 'working...', false)
    this.startHeartbeat(chatId)
    // Fire-and-forget: the runner broadcasts into this chat's client.
    void runner.startRound(text)
  }

  private async handleCommand(chatId: string, text: string): Promise<void> {
    const [rawCmd, ...rest] = text.split(/\s+/)
    const cmd = rawCmd.replace(/@.*$/, '').toLowerCase()

    if (cmd === '/start' || cmd === '/help') {
      await this.send(
        chatId,
        [
          'Portal agent bridge.',
          '',
          'Send any message to talk to the agent in the current session.',
          '',
          `/new — start a fresh session`,
          `/list — show recent sessions`,
          `/use <n> — switch to session n from the last /list`,
          `/stop — cancel the running round`,
          `/pwd — show the working directory`,
        ].join('\n'),
        false,
      )
      return
    }

    if (cmd === '/new') {
      const state = this.ensureChat(chatId)
      state.sessionId = randomUUID()
      state.pendingText = ''
      state.subscribed = false
      state.subscribedSession = undefined
      await saveChats(this.chats)
      await this.send(chatId, `New session: \`${state.sessionId}\``)
      return
    }

    if (cmd === '/list') {
      const state = this.ensureChat(chatId)
      let sessions: ListedSession[] = []
      try {
        sessions = await this.listSessions()
      } catch (err: any) {
        await this.send(chatId, `Could not read sessions: ${err.message}`, false)
        return
      }
      // The current session may be brand new and not on disk yet.
      if (!sessions.some(s => s.sessionId === state.sessionId)) {
        sessions.unshift({ sessionId: state.sessionId, title: '(current, new)', lastModified: Date.now() })
      }
      const shown = sessions.slice(0, 10)
      state.lastList = shown
      await saveChats(this.chats)

      const lines = shown.map((s, i) => {
        const mark = s.sessionId === state.sessionId ? '>>' : '  '
        const title = s.title.replace(/\s+/g, ' ').slice(0, 60)
        const dir = s.cwd ? ` — ${s.cwd.split(/[/\\]/).pop()}` : ''
        return `${mark} ${i + 1}. ${title}${dir}`
      })
      await this.send(
        chatId,
        ['Recent sessions (>> = current):', '', ...lines, '', 'Switch with /use <n>'].join('\n'),
        false,
      )
      return
    }

    if (cmd === '/use') {
      const state = this.ensureChat(chatId)
      const arg = (rest[0] || '').trim()
      if (!arg) {
        await this.send(chatId, 'Usage: /use <n>  (n from the last /list)', false)
        return
      }

      const picked: ListedSession | undefined = /^\d+$/.test(arg)
        ? state.lastList?.[Number(arg) - 1]
        : state.lastList?.find(s => s.sessionId === arg)
          ?? { sessionId: arg, title: '', lastModified: 0 }
      if (!picked) {
        await this.send(chatId, `No session ${arg}. Send /list first.`, false)
        return
      }
      const target = picked.sessionId

      if (target === state.sessionId) {
        await this.send(chatId, 'Already on that session.', false)
        return
      }

      const runner = this.getRunner(state.sessionId)
      if (runner?.isRunning()) {
        await this.send(chatId, 'Current session is still running. /stop it first.', false)
        return
      }

      state.sessionId = target
      state.cwd = picked.cwd || state.cwd
      state.pendingText = ''
      state.subscribed = false
      state.subscribedSession = undefined
      await saveChats(this.chats)

      // Recreate the runner in the session's own project directory; a runner
      // left on the previous cwd would run tools in the wrong repo.
      if (state.cwd) this.createRunnerIn(target, state.cwd)
      this.ensureSubscribed(chatId, state)

      const where = state.cwd ? `\nWorking dir: \`${state.cwd}\`` : ''
      await this.send(chatId, `Switched to \`${target}\`.${where}\nSend a message to continue it.`)
      return
    }

    if (cmd === '/pwd') {
      await this.send(chatId, `\`${this.cwd}\``)
      return
    }

    if (cmd === '/stop') {
      const state = this.ensureChat(chatId)
      const runner = this.getRunner(state.sessionId)
      if (runner?.isRunning()) {
        runner.cancel()
        await this.send(chatId, 'Cancelled.', false)
      } else {
        await this.send(chatId, 'Nothing is running.', false)
      }
      return
    }

    await this.send(chatId, `Unknown command: ${rawCmd}. Send /help.`, false)
  }

  private ensureChat(chatId: string): ChatState {
    let state = this.chats[chatId]
    if (!state) {
      state = { sessionId: randomUUID(), pendingText: '', subscribed: false }
      this.chats[chatId] = state
      void saveChats(this.chats)
    }
    return state
  }

  /**
   * A Client-shaped object for SessionRunner. The runner only ever calls
   * `send`, so no WebSocket is needed. Cached per chat so the same object can
   * be handed to detachClient when the chat switches sessions.
   */
  private clientFor(chatId: string): any {
    let client = this.clients.get(chatId)
    if (!client) {
      client = { ws: null, send: (event: any) => this.onRunnerEvent(chatId, event) }
      this.clients.set(chatId, client)
    }
    return client
  }

  private ensureSubscribed(chatId: string, state: ChatState): void {
    if (state.subscribed && state.subscribedSession === state.sessionId) return
    if (state.subscribedSession) {
      this.detachClient(state.subscribedSession, this.clientFor(chatId))
    }
    this.attachClient(state.sessionId, this.clientFor(chatId))
    state.subscribed = true
    state.subscribedSession = state.sessionId
  }

  /**
   * Announces that a round is still running at 1, 2, 4, 8… minutes. A round
   * that takes a while produces no output otherwise, and silence is
   * indistinguishable from a hung process.
   */
  private startHeartbeat(chatId: string): void {
    const state = this.chats[chatId]
    if (!state) return
    this.stopHeartbeat(chatId)
    state.roundStartedAt = Date.now()
    state.lastHeartbeatPower = 0

    state.heartbeatTimer = setInterval(() => {
      const s = this.chats[chatId]
      if (!s?.roundStartedAt) return
      // A round that died without broadcasting `done` would otherwise leave
      // this timer announcing a session that is no longer working.
      const running = this.getRunner(s.sessionId)?.isRunning()
      if (!running) {
        this.stopHeartbeat(chatId)
        return
      }
      const minutes = Math.floor((Date.now() - s.roundStartedAt) / 60_000)
      if (minutes < 1) return
      // Largest power of two <= minutes; announce each one once.
      let p = 1
      while (p * 2 <= minutes) p *= 2
      if (p > (s.lastHeartbeatPower ?? 0)) {
        s.lastHeartbeatPower = p
        void this.send(chatId, `still running (${minutes} min)`, false)
      }
    }, 15_000)
  }

  private stopHeartbeat(chatId: string): void {
    const state = this.chats[chatId]
    if (!state) return
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer)
    state.heartbeatTimer = null
    state.roundStartedAt = undefined
    state.lastHeartbeatPower = 0
  }

  private onRunnerEvent(chatId: string, event: any): void {
    const state = this.chats[chatId]
    if (!state) return

    switch (event.type) {
      case 'text_chunk':
        state.pendingText += event.text ?? ''
        break

      case 'tool_use_display':
        break

      case 'thinking_start':
      case 'thinking_chunk':
      case 'thinking_end':
        // Reasoning is not relayed; the heartbeat covers "still working".
        break

      case 'error':
        state.pendingText += `\n\nError: ${event.message ?? 'error'}`
        break

      case 'done': {
        const body = event.fullText || state.pendingText
        state.pendingText = ''
        this.stopHeartbeat(chatId)
        void this.send(chatId, body.trim() || '(no output)')
        break
      }

      case 'cancelled':
        this.stopHeartbeat(chatId)
        void this.send(chatId, 'Cancelled.', false)
        break
    }
  }
}
