# Agent Development Guide

This file provides instructions for agentic coding agents operating in this repository.

## Project Overview

A multi-service TypeScript application with three main services:

- **agent-service**: AI agent with file system tools, runs as WebSocket or HTTP server
- **telegram-service**: Telegram bot interface to the agent
- **frontend-service**: Static frontend served via nginx

## Services Architecture

```
┌─────────────────┐     ┌─────────────────┐
│ telegram-service│────▶│  agent-service  │
└─────────────────┘     │  (WebSocket)    │
                        └─────────────────┘
                              ▲
┌─────────────────┐           │
│     caddy       │───────────┘
│ (reverse proxy) │
└─────────────────┘
```

## Build, Lint, and Test Commands

### Agent Service
```bash
cd agent-service
npm run build        # Compile TypeScript to dist/
npm run dev          # Run in development mode with tsx
npm run start        # Run compiled JavaScript
```

### Telegram Service
```bash
cd telegram-service
npm run build        # Compile TypeScript to dist/
npm run dev          # Run in development mode with tsx
npm run start        # Run compiled JavaScript
```

### Docker Compose
```bash
docker compose up --build    # Build and start all services
docker compose build agent   # Build specific service
docker compose up -d         # Start in detached mode
docker compose down          # Stop all services
```

### Type Checking
```bash
cd agent-service && npx tsc --noEmit
cd telegram-service && npx tsc --noEmit
```

## Code Style Guidelines

### General
- **No semicolons** at statement ends
- **2-space indentation**
- **Single quotes** for strings
- **ESM modules** (type: "module" in package.json)
- **Strict TypeScript** enabled (strict: true in tsconfig.json)

### Imports
- Use named imports where possible: `import { Agent } from "@mariozechner/pi-coding-agent"`
- Use type-only imports for types: `import type { AgentEvent } from "@mariozechner/pi-agent-core"`
- Group imports: external packages first, then local modules
- Use `* as` namespace import for Node.js built-ins: `import * as fs from "fs"`
- Always include `.js` extension for local imports: `import { WebsocketServer } from "./websocket-server.js"`

### Types
- Use `Type.Object()` from pi-ai for tool parameter schemas
- Use `Static<typeof ...>` to extract TypeScript types from schemas
- Always type function parameters and return values
- Use `unknown` type when catching errors, then narrow with `instanceof Error`

### Naming Conventions
- **PascalCase** for types: `ReadFileParams`, `ClientMessage`
- **camelCase** for variables, functions, and object keys
- **SCREAMING_SNAKE_CASE** for constants: `MAX_CONNECTIONS`
- Prefix interfaces with descriptive names: `ClientMessage`
- Descriptive names - avoid single letters except in loops

### Error Handling
- Always wrap potentially failing code in try/catch
- When catching errors, handle both Error objects and primitive values:
  ```typescript
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // use message...
  }
  ```
- Return error details in tool response objects, not throw
- For WebSocket: use `sendError` helper to send error messages to clients

### Functions
- Use async/await for asynchronous operations
- Keep functions focused and small (< 50 lines when possible)
- Use function declarations or arrow functions consistently
- Use generic types for reusable functions: `async function withRetry<T>(fn: () => Promise<T>)`

### Classes
- Use private fields for encapsulation: `private wss: WSServer | null`
- Validate constructor parameters with early throws
- Implement proper cleanup with `dispose()` or `stop()` methods
- Use signal handlers for graceful shutdown

## Environment Variables

### Agent Service
| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_BASE_URL` | Yes | Base URL for LLM API |
| `LLM_MODEL` | Yes | Model identifier |
| `LLM_API` | No | API type (default: "openai-completions") |
| `OPENAI_API_KEY` | No | API key for authentication |
| `WEBSOCKET_PORT` | No | WebSocket port (default: 8888) |
| `HTTP_MODE` | No | Run HTTP server instead of WebSocket |

### Telegram Service
| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token |
| `AGENT_API_URL` | Yes | Agent service URL |
| `WEBHOOK_URL` | No | Public webhook URL |
| `WEBHOOK_SECRET` | No | Webhook secret |

See `.env.example` for reference.

## File Structure

```
pi-agent-container/
├── agent-service/
│   ├── src/
│   │   ├── agent.ts              # Main agent implementation
│   │   ├── websocket-server.ts   # WebSocket server
│   │   └── http-server.ts        # HTTP REST API
│   ├── dist/                     # Compiled output
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── telegram-service/
│   ├── src/
│   │   ├── index.ts              # Telegram bot entry point
│   │   └── http-client.ts        # Agent API client
│   ├── dist/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── frontend-service/
│   ├── index.html
│   ├── nginx.conf
│   └── Dockerfile
├── docker-compose.yml
├── Caddyfile
└── .env.example
```

## Development Workflow

1. Make changes in the appropriate service's `src/` directory
2. Run `npm run dev` in that service's directory to test changes
3. Run `npm run build` before deploying
4. Test with Docker Compose: `docker compose up --build`

## WebSocket Server Protocol

When running in WebSocket mode, clients send messages:
```typescript
// Client message format
{ type: "prompt", content: "your prompt here" }
{ type: "disconnect" }

// Server sends AgentEvent objects as JSON
```

## HTTP API

When running in HTTP mode:
```bash
POST /api/sessions              # Create session
POST /api/sessions/:id/prompt   # Send prompt
GET /api/sessions/:id           # Get session info
DELETE /api/sessions/:id        # Delete session
```

## Notes

- Each service has its own `package.json` and `tsconfig.json`
- No linting or formatting tools configured - manually ensure consistency
- Agent uses `createCodingTools` from pi-coding-agent for file system access
- Session management supports creating new sessions and continuing recent ones
