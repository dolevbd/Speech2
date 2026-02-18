import { NextResponse } from 'next/server';

const AGENT_BACKEND_URL = process.env.AGENT_BACKEND_URL;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * GET /api/health — full diagnostic endpoint for debugging deployment issues.
 */
export async function GET() {
  const checks: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    mode: AGENT_BACKEND_URL ? 'proxy' : 'local',
    env: {
      AGENT_BACKEND_URL: AGENT_BACKEND_URL ? `${AGENT_BACKEND_URL.slice(0, 30)}...` : 'not set',
      ANTHROPIC_API_KEY: ANTHROPIC_API_KEY ? `${ANTHROPIC_API_KEY.slice(0, 7)}...` : 'not set',
      OPENAI_API_KEY: OPENAI_API_KEY ? `${OPENAI_API_KEY.slice(0, 7)}...` : 'not set',
      USE_AGENT_SDK: process.env.USE_AGENT_SDK ?? 'not set (defaults to true)',
    },
  };

  // If proxy mode, test connectivity to backend
  if (AGENT_BACKEND_URL) {
    try {
      const start = Date.now();
      const res = await fetch(`${AGENT_BACKEND_URL}/api/agent`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      const elapsed = Date.now() - start;
      const body = await res.text();

      checks.backend = {
        url: AGENT_BACKEND_URL,
        status: res.status,
        ok: res.ok,
        latencyMs: elapsed,
        response: body.slice(0, 500),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.backend = {
        url: AGENT_BACKEND_URL,
        ok: false,
        error: msg,
      };
    }
  }

  const allOk = AGENT_BACKEND_URL
    ? (checks.backend as Record<string, unknown>)?.ok === true
    : !!ANTHROPIC_API_KEY;

  return NextResponse.json({ ok: allOk, ...checks });
}
