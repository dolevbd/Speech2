import express from 'express';
import cors from 'cors';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

// ─── Middleware ───

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (curl, server-to-server)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.some((o) => origin.startsWith(o.trim()))) return cb(null, true);
      cb(new Error(`Origin ${origin} not allowed`));
    },
    credentials: true,
  })
);
app.use(express.json());

// ─── Health Check ───

app.get('/api/agent', (_req, res) => {
  res.json({
    ok: !!ANTHROPIC_API_KEY,
    provider: ANTHROPIC_API_KEY ? 'claude-agent-sdk' : 'mock',
  });
});

// ─── Agent Endpoint (SSE) ───

app.post('/api/agent', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { message, systemPrompt, repoContext, sessionId } = req.body as {
    message: string;
    systemPrompt?: string;
    repoContext?: { owner: string; repo: string; branch?: string };
    sessionId?: string;
  };

  if (!message || message.length > 10000) {
    return res.status(400).json({ error: 'Message is required and must be under 10000 characters' });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const emit = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    let system =
      systemPrompt ||
      'You are Claude Code, an AI coding agent. This is a voice interface — the user is speaking to you and your response will be read aloud. Always start with a brief spoken summary of what you did or are explaining, then put any code in fenced code blocks after the summary. Keep the spoken parts concise and natural.';
    if (repoContext) {
      system += `\n\nRepository context: ${repoContext.owner}/${repoContext.repo}`;
      if (repoContext.branch) system += ` (branch: ${repoContext.branch})`;
    }

    emit({ type: 'thinking', content: '', timestamp: Date.now() });

    const result = query({
      prompt: message,
      options: {
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: system,
        },
        allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
        permissionMode: 'acceptEdits',
        maxTurns: 15,
        maxBudgetUsd: 1.0,
        includePartialMessages: false,
        persistSession: true,
        ...(sessionId ? { resume: sessionId } : {}),
        env: {
          ...(process.env as Record<string, string>),
          ANTHROPIC_API_KEY: ANTHROPIC_API_KEY!,
        },
      },
    });

    let finalText = '';

    for await (const msg of result) {
      switch (msg.type) {
        case 'system': {
          if (msg.subtype === 'init') {
            emit({
              type: 'system_init',
              content: `Session: ${msg.session_id}`,
              sessionId: msg.session_id,
              model: msg.model,
              tools: msg.tools,
              timestamp: Date.now(),
            });
          }
          break;
        }

        case 'assistant': {
          const betaMessage = msg.message;
          if (betaMessage?.content) {
            for (const block of betaMessage.content) {
              if (block.type === 'text') {
                finalText = block.text;
                emit({ type: 'text', content: block.text, timestamp: Date.now() });
              } else if (block.type === 'tool_use') {
                emit({
                  type: 'tool_use',
                  content: `Using ${block.name}`,
                  toolName: block.name,
                  toolInput: block.input,
                  timestamp: Date.now(),
                });
              }
            }
          }
          break;
        }

        case 'tool_progress': {
          emit({
            type: 'tool_progress',
            content: `${msg.tool_name} running...`,
            toolName: msg.tool_name,
            elapsed: msg.elapsed_time_seconds,
            timestamp: Date.now(),
          });
          break;
        }

        case 'tool_use_summary': {
          emit({
            type: 'tool_summary',
            content: msg.summary,
            timestamp: Date.now(),
          });
          break;
        }

        case 'result': {
          if (msg.subtype === 'success') {
            emit({
              type: 'result',
              content: msg.result || finalText,
              costUsd: msg.total_cost_usd,
              numTurns: msg.num_turns,
              sessionId: msg.session_id,
              timestamp: Date.now(),
            });
          } else {
            emit({
              type: 'error',
              content: `Agent error (${msg.subtype}): ${msg.errors?.join(', ') || 'unknown'}`,
              timestamp: Date.now(),
            });
          }
          break;
        }
      }
    }

    emit({ type: 'done', content: '', timestamp: Date.now() });
    res.write('data: [DONE]\n\n');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    emit({ type: 'error', content: errMsg, timestamp: Date.now() });
    res.write('data: [DONE]\n\n');
  } finally {
    res.end();
  }
});

// ─── Start ───

app.listen(PORT, () => {
  console.log(`Agent backend listening on port ${PORT}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`Agent SDK: ${ANTHROPIC_API_KEY ? 'configured' : 'NOT configured'}`);
});
