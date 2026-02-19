import { NextRequest, NextResponse } from 'next/server';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Server-side URL of an external agent backend (e.g. Render).
// When set, this route proxies requests to the external backend — no CORS issues.
const AGENT_BACKEND_URL = process.env.AGENT_BACKEND_URL;

// Whether to use the Claude Agent SDK (full code agent) vs Messages API (chat only).
// Only relevant when AGENT_BACKEND_URL is NOT set (local mode).
const USE_AGENT_SDK = process.env.USE_AGENT_SDK !== 'false';

/**
 * GET /api/agent — health check for agent connectivity
 */
export async function GET() {
  // ─── Proxy mode: forward health check to external backend ───
  if (AGENT_BACKEND_URL) {
    try {
      const upstream = await fetch(`${AGENT_BACKEND_URL}/api/agent`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const data = await upstream.json();
      return NextResponse.json({
        ...data,
        proxy: true,
        backend: AGENT_BACKEND_URL,
      });
    } catch (err) {
      // Backend unreachable — fall back to local if API key is available
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[agent/GET] Backend unreachable (${msg}), checking local fallback`);
      if (ANTHROPIC_API_KEY) {
        return NextResponse.json({
          ok: true,
          provider: 'anthropic-messages (fallback)',
          proxy: false,
          backendDown: true,
        });
      }
      return NextResponse.json({
        ok: false,
        proxy: true,
        backend: AGENT_BACKEND_URL,
        error: `Backend unreachable: ${msg}`,
      }, { status: 502 });
    }
  }

  // ─── Local mode ───
  const configured = !!ANTHROPIC_API_KEY;
  return NextResponse.json({
    ok: configured,
    provider: configured ? (USE_AGENT_SDK ? 'claude-agent-sdk' : 'anthropic-messages') : 'mock',
    debug: {
      hasApiKey: configured,
      useAgentSdk: USE_AGENT_SDK,
      keyPrefix: configured ? ANTHROPIC_API_KEY!.slice(0, 7) + '...' : null,
    },
  });
}

/**
 * POST /api/agent — send a message to Claude and stream agent events back via SSE.
 *
 * Three modes (in priority order):
 * 1. Proxy mode: if AGENT_BACKEND_URL is set, proxy to external backend (e.g. Render)
 * 2. Claude Agent SDK: Full code agent with file read/edit, bash, etc.
 * 3. Anthropic Messages API fallback: Chat-only, no tool use.
 */
export async function POST(req: NextRequest) {
  // Parse body once — we may need it for both proxy and fallback
  const bodyText = await req.text();
  let parsed: {
    message: string;
    systemPrompt?: string;
    repoContext?: { owner: string; repo: string; branch?: string };
    sessionId?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  };
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { message, systemPrompt, repoContext, sessionId, history } = parsed;

  if (!message || message.length > 10000) {
    return NextResponse.json(
      { error: 'Message is required and must be under 10000 characters' },
      { status: 400 }
    );
  }

  // ─── Proxy mode: forward to external backend, fall back to local on failure ───
  if (AGENT_BACKEND_URL) {
    const proxyResult = await proxyToBackend(bodyText);
    if (proxyResult !== null) return proxyResult;
    // proxyResult === null means backend is down — fall through to local mode
    console.warn('[agent/POST] Backend down, falling back to local Messages API');
  }

  // ─── Local mode ───
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  try {
    if (USE_AGENT_SDK) {
      try {
        return await handleWithAgentSDK(message, systemPrompt, repoContext, sessionId, history);
      } catch (sdkErr) {
        console.warn('Agent SDK failed, falling back to Messages API:', sdkErr);
        return handleWithMessagesAPI(message, systemPrompt, repoContext, history);
      }
    }
    return handleWithMessagesAPI(message, systemPrompt, repoContext, history);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─── Proxy to External Backend ───
// Returns null if the backend is unreachable (caller should fall back to local mode)

async function proxyToBackend(body: string): Promise<NextResponse | null> {
  try {
    const upstream = await fetch(`${AGENT_BACKEND_URL}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      // 502/503 = backend down → return null to trigger fallback
      if (upstream.status === 502 || upstream.status === 503) {
        return ANTHROPIC_API_KEY ? null : NextResponse.json(
          { error: 'Agent backend is temporarily unavailable' },
          { status: 502 }
        );
      }
      const errText = await upstream.text().catch(() => '');
      // Strip HTML from error responses
      const cleanErr = errText.replace(/<[^>]+>/g, '').trim().slice(0, 200);
      return NextResponse.json(
        { error: `Backend error (${upstream.status}): ${cleanErr || 'Unknown error'}` },
        { status: upstream.status }
      );
    }

    // Stream the SSE response from the backend back to the client
    if (!upstream.body) {
      return ANTHROPIC_API_KEY ? null : NextResponse.json(
        { error: 'No response body from backend' },
        { status: 502 }
      );
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', content: `Stream error: ${errMsg}`, timestamp: Date.now() })}\n\n`)
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    // Network error / timeout → fall back to local if possible
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[proxy] Backend unreachable: ${msg}`);
    return ANTHROPIC_API_KEY ? null : NextResponse.json(
      { error: `Agent backend unreachable` },
      { status: 502 }
    );
  }
}

// ─── Claude Agent SDK Mode ───

async function handleWithAgentSDK(
  message: string,
  systemPrompt?: string,
  repoContext?: { owner: string; repo: string; branch?: string },
  sessionId?: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  // Build system prompt
  let system = systemPrompt || 'You are Claude Code, an AI coding agent. Keep responses concise.';
  if (repoContext) {
    system += `\n\nRepository context: ${repoContext.owner}/${repoContext.repo}`;
    if (repoContext.branch) system += ` (branch: ${repoContext.branch})`;
  }

  // Include conversation history as context backup (in case session resume fails)
  if (!sessionId && history && history.length > 1) {
    const recent = history.slice(-10); // Last 10 turns to avoid bloating the prompt
    system += '\n\nPrevious conversation (for context):\n';
    for (const entry of recent.slice(0, -1)) { // Exclude current message
      const role = entry.role === 'user' ? 'User' : 'Assistant';
      system += `${role}: ${entry.content.slice(0, 500)}\n`;
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        emit({ type: 'thinking', content: '', timestamp: Date.now() });

        const result = query({
          prompt: message,
          options: {
            systemPrompt: {
              type: 'preset',
              preset: 'claude_code',
              append: system,
            },
            // Full code agent tools
            allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            maxTurns: 15,
            maxBudgetUsd: 1.0,
            includePartialMessages: false,
            persistSession: true,
            ...(sessionId ? { resume: sessionId } : {}),
            env: {
              ...process.env as Record<string, string>,
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
              CLAUDECODE: '', // Unset to allow spawning inside containers
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
              // Extract text from the assistant message's content blocks
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
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', content: errMsg, timestamp: Date.now() });
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// ─── Anthropic Messages API Fallback ───

async function handleWithMessagesAPI(
  message: string,
  systemPrompt?: string,
  repoContext?: { owner: string; repo: string; branch?: string },
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
) {
  let system =
    systemPrompt ||
    'You are Claude Code, an AI coding agent. This is a voice interface — the user is speaking to you and your response will be read aloud. Always start with a brief spoken summary of what you did or are explaining, then put any code in fenced code blocks after the summary. Keep the spoken parts concise and natural.';
  if (repoContext) {
    system += `\n\nRepository context: ${repoContext.owner}/${repoContext.repo}`;
    if (repoContext.branch) system += ` (branch: ${repoContext.branch})`;
  }

  // Build messages array from conversation history
  // Merge consecutive same-role messages to maintain alternating user/assistant turns
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (history && history.length > 0) {
    let lastRole: string | null = null;
    for (const entry of history.slice(-40)) {
      if (entry.role === lastRole) {
        const prev = messages[messages.length - 1];
        if (prev) prev.content = prev.content + '\n\n' + entry.content;
      } else {
        messages.push({ role: entry.role, content: entry.content });
        lastRole = entry.role;
      }
    }
    // Anthropic API requires first message from 'user'
    if (messages.length > 0 && messages[0].role !== 'user') {
      messages.shift();
    }
  } else {
    messages.push({ role: 'user', content: message });
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system,
      messages,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return NextResponse.json(
      { error: `Anthropic API error: ${errText}` },
      { status: res.status }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = res.body!.getReader();
      let buffer = '';
      let fullText = '';

      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: 'thinking', content: '', timestamp: Date.now() })}\n\n`
        )
      );

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);

            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              fullText += event.delta.text;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'text',
                    content: fullText,
                    timestamp: Date.now(),
                  })}\n\n`
                )
              );
            }

            if (event.type === 'message_stop') {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            }
          } catch {
            // skip malformed JSON
          }
        }
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
