# Portal

An open-source coding-agent CLI with a web UI.

## Quick Start

```bash
bun install
bun run build
node dist/cli.mjs
```

## Web UI

Portal includes a built-in web interface with WebSocket-based chat, session management, and directory browsing.

```bash
bun run dev:web
```

Then open `http://localhost:3004` in your browser.

## Features

- **CLI + Web UI** — terminal-first with a browser companion interface
- **Multi-provider** — OpenAI-compatible APIs, Ollama, and other backends via `/provider` setup
- **Tool-driven workflows** — bash, file read/write/edit, grep, glob, agents, MCP, and web tools
- **Session persistence** — chat history saved per-project, browsable from the web UI
- **Theme support** — light, dark, and auto modes in the web UI

## Commands

| Command | Description |
| --- | --- |
| `bun run dev:web` | Start web UI server |
| `bun run build` | Build the project |
| `bun test` | Run unit tests |
| `bun run doctor:runtime` | Check runtime health |

## Project Structure

- `src/` — core CLI and server runtime
- `web/` — web UI frontend (HTML, CSS, JS)
- `scripts/` — build and verification scripts
- `docs/` — documentation

## License

MIT
