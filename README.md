# Portal

A web-based coding agent.

## Quick Start

```bash
bun install
bun run dev:web
```

Then open `http://localhost:3200` in your browser (override with `WEB_PORT`).

## Provider setup

Portal talks to any OpenAI-compatible API. Configure a provider profile once and reuse it:

```bash
bun run profile:auto     # auto-recommend and apply a local Ollama profile
bun run profile:codex    # configure for Codex
bun run profile:fast     # configure for Ollama llama3.2:3b
bun run profile:code     # configure for Ollama qwen2.5-coder:7b
bun run dev:codex        # set up codex profile then launch the web UI
bun run dev:ollama       # set up ollama profile then launch the web UI
bun run dev:openai       # set up OpenAI profile then launch the web UI
bun run dev:gemini       # set up Gemini profile then launch the web UI
```

## Features

- **Web UI** — WebSocket-based chat with session management and directory browsing
- **Multi-provider** — OpenAI-compatible APIs, Ollama, Codex, Gemini, and more
- **Tool-driven workflows** — bash, file read/write/edit, grep, glob, agents, MCP, and web tools
- **Session persistence** — chat history saved per-project, browsable from the web UI
- **Theme support** — light, dark, and auto modes in the web UI

## Commands

| Command | Description |
| --- | --- |
| `bun run dev:web` | Start web UI server |
| `bun run profile:auto` | Auto-configure a provider profile |
| `bun run typecheck` | Run TypeScript type checking |
| `bun run doctor:runtime` | Check runtime health |

## Project Structure

- `src/` — core runtime, tools, and web server
- `web/` — web UI frontend (HTML, CSS, JS)
- `scripts/` — startup and verification scripts
- `docs/` — documentation

## License

MIT
