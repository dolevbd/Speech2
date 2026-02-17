# Voice Agent — Claude Code

Hebrew-first voice interface for Claude Code. Speak in Hebrew (or English) to control a real coding agent that can read files, edit code, run commands, and work with your GitHub repositories.

Built as a mobile-first PWA optimized for driving / hands-free use.

## Architecture

```
Mic → STT (Hebrew) → Claude Code Agent → Display transcript → TTS (Hebrew) → Play audio
                                ↑                                    ↓
                         Hands-free mode: auto resume listening after TTS ends
```

### Provider Abstraction

Three swappable provider interfaces:

| Layer | Providers | Notes |
|-------|-----------|-------|
| **STT** | Web Speech API (free), OpenAI gpt-4o-transcribe | Hebrew + English |
| **TTS** | SpeechSynthesis (free), OpenAI gpt-4o-mini-tts | Hebrew + English |
| **Agent** | Claude Agent SDK (full code agent), Anthropic Messages API (chat), Mock (offline) | Auto-selects best available |

### Claude Code Integration

The agent backend supports two modes:

1. **Claude Agent SDK** (default) — Full code agent with autonomous file read/edit, bash commands, grep, glob, and multi-turn sessions. Uses `@anthropic-ai/claude-agent-sdk`.
2. **Anthropic Messages API** (fallback) — Chat-only mode, no tool use. Set `USE_AGENT_SDK=false`.

The app auto-connects: tries the real backend first, falls back to mock if no API key is configured.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and add your API keys

# 3. Run development server
npm run dev

# 4. Open in Chrome mobile (or desktop)
# http://localhost:3000
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | For agent | Anthropic API key for Claude Code agent |
| `OPENAI_API_KEY` | For voice | OpenAI API key for STT/TTS |
| `USE_AGENT_SDK` | No | `true` (default) = full code agent, `false` = Messages API chat |
| `RATE_LIMIT_RPM` | No | Rate limit per IP (default: 30) |

**Without API keys:** The app still works using browser-native Web Speech API for STT/TTS and a mock agent for testing the pipeline.

## Features

- **Hebrew-first** — RTL layout, Hebrew UI, Hebrew voice I/O
- **English support** — Switch language in settings
- **Hands-free mode** — Auto-resumes listening after TTS playback
- **Speak response** — Agent responses read aloud automatically
- **PWA** — Installable, works offline (with mock agent)
- **Mobile-first** — Big mic button, high contrast, minimal interaction
- **Repo connect** — Link a GitHub repo for context-aware coding tasks
- **Agent events** — See tool use, file changes, progress in real-time
- **Session persistence** — Multi-turn conversations with context

## Deployment

### Vercel (Recommended for chat mode)

Vercel serverless functions cannot spawn child processes, so the full Claude Agent SDK is not available. The app automatically uses the **Anthropic Messages API** fallback — you still get Claude conversations in Hebrew/English, just without file editing and bash tools.

1. Push your repo to GitHub
2. Import the project in [vercel.com](https://vercel.com)
3. Set environment variables in the Vercel dashboard:
   - `ANTHROPIC_API_KEY` — your Anthropic API key
   - `OPENAI_API_KEY` — your OpenAI API key (for STT/TTS)
   - `USE_AGENT_SDK` — set to `false`
4. Deploy

Or via CLI:

```bash
npx vercel --prod
```

### Container (Full agent mode)

For the full Claude Agent SDK with file read/edit, bash, grep, and multi-turn coding sessions, deploy to a platform that supports long-running Node.js processes:

- **Railway** / **Fly.io** / **Render** — set `USE_AGENT_SDK=true`
- Requires Node.js 18+ and ability to spawn child processes

## Hebrew Voice Notes

- **STT:** OpenAI gpt-4o-transcribe provides the best Hebrew accuracy. Web Speech API (Chrome) works but is less reliable for fast/colloquial Hebrew.
- **TTS:** OpenAI TTS produces natural Hebrew speech. Browser SpeechSynthesis varies by device — some Android Chrome versions have decent Hebrew voices.
- **Tip:** For driving, use OpenAI providers for both STT and TTS, enable hands-free mode, and set voice speed to 1.0–1.2x.

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # Main UI
│   ├── layout.tsx            # Root layout (RTL, PWA)
│   ├── globals.css           # Tailwind + custom styles
│   └── api/
│       ├── agent/route.ts    # Claude Code agent (SDK + Messages API)
│       ├── stt/route.ts      # OpenAI STT proxy
│       └── tts/route.ts      # OpenAI TTS proxy
├── components/
│   ├── MicButton.tsx         # Big mic button with states
│   ├── Transcript.tsx        # Chat transcript
│   ├── AgentEvents.tsx       # Tool use / file change events
│   ├── Settings.tsx          # Settings modal
│   ├── StatusBar.tsx         # Connection status
│   └── RepoConnect.tsx       # GitHub repo connection dialog
├── hooks/
│   ├── useSettings.ts        # Persisted settings
│   └── useVoicePipeline.ts   # Core voice pipeline orchestration
├── lib/
│   ├── agent/
│   │   ├── claude-code-client.ts  # Real agent client (SSE)
│   │   ├── mock-client.ts         # Mock agent for offline use
│   │   └── types.ts               # Agent system prompt
│   ├── voice/
│   │   ├── types.ts               # Provider interfaces
│   │   ├── stt/
│   │   │   ├── web-speech-stt.ts  # Browser STT
│   │   │   └── openai-stt.ts      # OpenAI STT
│   │   └── tts/
│   │       ├── web-speech-tts.ts  # Browser TTS
│   │       └── openai-tts.ts      # OpenAI TTS
│   └── i18n/
│       └── translations.ts        # Hebrew + English strings
└── types/
    └── speech.d.ts                # Web Speech API types
```

## Roadmap

- [ ] Multi-turn conversation memory on client side
- [ ] Wake word detection (optional, for true hands-free)
- [ ] Voice activity detection (auto-stop on silence)
- [ ] Diff viewer component for file changes
- [ ] GitHub OAuth flow for repo connection
- [ ] Session history / resume from settings
- [ ] Cost tracking display
- [ ] Audio streaming TTS (play while generating)
- [ ] Offline agent with local LLM fallback
