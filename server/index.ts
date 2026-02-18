import express from 'express';
import cors from 'cors';
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

// ─── Repo Cache ───

const REPOS_DIR = path.join(process.env.HOME || '/tmp', '.voice-agent-repos');

/**
 * Ensure a GitHub repo is cloned locally, pull latest if already cached.
 * Returns the absolute path to the repo working directory.
 */
function ensureRepo(
  owner: string,
  repo: string,
  branch?: string,
  githubToken?: string
): string {
  if (!existsSync(REPOS_DIR)) {
    mkdirSync(REPOS_DIR, { recursive: true });
  }

  const key = `${owner}--${repo}`;
  const repoDir = path.join(REPOS_DIR, key);
  const token = githubToken || GITHUB_TOKEN;

  // Build clone URL — use token if available (needed for private repos)
  const cloneUrl = token
    ? `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
    : `https://github.com/${owner}/${repo}.git`;

  if (existsSync(path.join(repoDir, '.git'))) {
    // Already cloned — fetch + checkout
    try {
      execSync('git fetch --all --prune', { cwd: repoDir, stdio: 'pipe', timeout: 30_000 });
      if (branch) {
        execSync(`git checkout ${branch}`, { cwd: repoDir, stdio: 'pipe', timeout: 10_000 });
        execSync(`git pull origin ${branch} --ff-only`, {
          cwd: repoDir,
          stdio: 'pipe',
          timeout: 30_000,
        });
      }
    } catch (e) {
      console.warn(`Repo update failed for ${key}, using cached version:`, e);
    }
  } else {
    // Fresh clone — try with specified branch first, fall back to default branch
    if (branch) {
      try {
        execSync(`git clone --depth 50 --branch ${branch} ${cloneUrl} ${repoDir}`, {
          stdio: 'pipe',
          timeout: 60_000,
        });
      } catch {
        // Branch not found — clone with default branch instead
        console.warn(`Branch '${branch}' not found for ${owner}/${repo}, cloning default branch`);
        execSync(`git clone --depth 50 ${cloneUrl} ${repoDir}`, {
          stdio: 'pipe',
          timeout: 60_000,
        });
      }
    } else {
      execSync(`git clone --depth 50 ${cloneUrl} ${repoDir}`, {
        stdio: 'pipe',
        timeout: 60_000,
      });
    }
  }

  return repoDir;
}

// ─── Middleware ───

app.use(
  cors({
    origin: (origin, cb) => {
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
    githubConfigured: !!GITHUB_TOKEN,
  });
});

// ─── Agent Endpoint (SSE) ───

app.post('/api/agent', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { message, systemPrompt, repoContext, sessionId, githubToken } = req.body as {
    message: string;
    systemPrompt?: string;
    repoContext?: { owner: string; repo: string; branch?: string };
    sessionId?: string;
    githubToken?: string;
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

  // ─── Clone / update repo if context provided ───
  let repoCwd: string | undefined;

  if (repoContext?.owner && repoContext?.repo) {
    try {
      emit({
        type: 'thinking',
        content: `Cloning ${repoContext.owner}/${repoContext.repo}...`,
        timestamp: Date.now(),
      });
      repoCwd = ensureRepo(repoContext.owner, repoContext.repo, repoContext.branch, githubToken);
      emit({
        type: 'thinking',
        content: `Repository ready: ${repoContext.owner}/${repoContext.repo}`,
        timestamp: Date.now(),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      emit({
        type: 'error',
        content: `Failed to clone repo: ${errMsg}. Check the repo URL and access token.`,
        timestamp: Date.now(),
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
  }

  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    let system =
      systemPrompt ||
      'You are Claude Code, an AI coding agent. This is a voice interface — the user is speaking to you and your response will be read aloud. Always start with a brief spoken summary of what you did or are explaining, then put any code in fenced code blocks after the summary. Keep the spoken parts concise and natural.';
    if (repoContext) {
      system += `\n\nRepository context: ${repoContext.owner}/${repoContext.repo}`;
      if (repoContext.branch) system += ` (branch: ${repoContext.branch})`;
      system += `\nYou have full access to the cloned repository files. Use Read, Grep, Glob to explore the code and Edit/Write to make changes.`;
    }

    emit({ type: 'thinking', content: '', timestamp: Date.now() });

    const result = query({
      prompt: message,
      options: {
        ...(repoCwd ? { cwd: repoCwd } : {}),
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
          ...(githubToken || GITHUB_TOKEN
            ? { GITHUB_TOKEN: githubToken || GITHUB_TOKEN! }
            : {}),
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
  console.log(`GitHub token: ${GITHUB_TOKEN ? 'configured' : 'NOT configured (public repos only)'}`);
});
