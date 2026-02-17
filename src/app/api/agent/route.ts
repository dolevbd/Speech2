import { NextRequest, NextResponse } from 'next/server';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * GET /api/agent — health check for agent connectivity
 */
export async function GET() {
  const configured = !!ANTHROPIC_API_KEY;
  return NextResponse.json({ ok: configured, provider: configured ? 'anthropic' : 'mock' });
}

/**
 * POST /api/agent — send a message to Claude and stream agent events back via SSE.
 *
 * Uses the Anthropic Messages API with streaming. The response is formatted as
 * Server-Sent Events so the client can process events incrementally.
 */
export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  try {
    const { message, systemPrompt, repoContext } = (await req.json()) as {
      message: string;
      systemPrompt?: string;
      repoContext?: { owner: string; repo: string; branch?: string };
      sessionId?: string;
    };

    if (!message || message.length > 10000) {
      return NextResponse.json(
        { error: 'Message is required and must be under 10000 characters' },
        { status: 400 }
      );
    }

    // Build system prompt with repo context
    let system = systemPrompt || 'You are Claude Code, an AI coding agent.';
    if (repoContext) {
      system += `\n\nRepository context: ${repoContext.owner}/${repoContext.repo}`;
      if (repoContext.branch) system += ` (branch: ${repoContext.branch})`;
    }

    // Call Anthropic Messages API with streaming
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system,
        messages: [{ role: 'user', content: message }],
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

    // Transform Anthropic SSE stream into our AgentEvent SSE stream
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = res.body!.getReader();
        let buffer = '';
        let fullText = '';

        // Send initial thinking event
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

              // Extract text deltas from content_block_delta events
              if (
                event.type === 'content_block_delta' &&
                event.delta?.type === 'text_delta'
              ) {
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

        // Ensure we always send a DONE
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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
