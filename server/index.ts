import express from 'express';
import cors from 'cors';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import path from 'path';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

// ─── Repo Cache ───

const REPOS_DIR = path.join(process.env.HOME || '/tmp', '.voice-agent-repos');

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

  const cloneUrl = token
    ? `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
    : `https://github.com/${owner}/${repo}.git`;

  if (existsSync(path.join(repoDir, '.git'))) {
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
    if (branch) {
      try {
        execSync(`git clone --depth 50 --branch ${branch} ${cloneUrl} ${repoDir}`, {
          stdio: 'pipe',
          timeout: 60_000,
        });
      } catch {
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

/**
 * Build a repo summary: list of files + key file contents.
 */
function getRepoSummary(repoDir: string): string {
  let summary = '';
  try {
    const tree = execSync('find . -type f -not -path "./.git/*" | head -200', {
      cwd: repoDir,
      stdio: 'pipe',
      timeout: 5_000,
    }).toString();
    summary += `\n\nRepository file tree:\n${tree}\n`;
  } catch { /* ignore */ }

  // Read key files for context
  const keyFiles = ['package.json', 'README.md', 'src/app/page.tsx', 'src/index.ts', 'index.ts', 'main.py', 'app.py'];
  for (const f of keyFiles) {
    const fp = path.join(repoDir, f);
    if (existsSync(fp)) {
      try {
        const content = readFileSync(fp, 'utf-8').slice(0, 3000);
        summary += `\n--- ${f} ---\n${content}\n`;
      } catch { /* ignore */ }
    }
  }
  return summary;
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
    provider: ANTHROPIC_API_KEY ? 'anthropic-messages' : 'mock',
    githubConfigured: !!GITHUB_TOKEN,
  });
});

// ─── Agent Endpoint (SSE) — Anthropic Messages API with streaming ───

app.post('/api/agent', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { message, systemPrompt, repoContext, sessionId, githubToken, history } = req.body as {
    message: string;
    systemPrompt?: string;
    repoContext?: { owner: string; repo: string; branch?: string };
    sessionId?: string;
    githubToken?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
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

  // ─── Build system prompt with repo context ───
  let system =
    systemPrompt ||
    'You are Claude Code, an AI coding agent. This is a voice interface — the user is speaking to you and your response will be read aloud. Always start with a brief spoken summary of what you did or are explaining, then put any code in fenced code blocks after the summary. Keep the spoken parts concise and natural.';

  // Clone repo and add context to system prompt
  if (repoContext?.owner && repoContext?.repo) {
    try {
      emit({ type: 'thinking', content: `Cloning ${repoContext.owner}/${repoContext.repo}...`, timestamp: Date.now() });
      const repoDir = ensureRepo(repoContext.owner, repoContext.repo, repoContext.branch, githubToken);
      emit({ type: 'thinking', content: `Repository ready`, timestamp: Date.now() });

      system += `\n\nRepository context: ${repoContext.owner}/${repoContext.repo}`;
      if (repoContext.branch) system += ` (branch: ${repoContext.branch})`;
      system += getRepoSummary(repoDir);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', content: `Failed to clone repo: ${errMsg}`, timestamp: Date.now() });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
  }

  // ─── Build messages array ───
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (history && history.length > 0) {
    const recent = history.slice(-20);
    for (const entry of recent) {
      messages.push({ role: entry.role, content: entry.content });
    }
  } else {
    messages.push({ role: 'user', content: message });
  }

  emit({ type: 'thinking', content: '', timestamp: Date.now() });

  try {
    // ─── Stream from Anthropic Messages API ───
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system,
        messages,
        stream: true,
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      emit({ type: 'error', content: `Anthropic API error (${apiRes.status}): ${errText}`, timestamp: Date.now() });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Parse SSE stream from Anthropic
    const reader = apiRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

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
            emit({ type: 'text', content: fullText, timestamp: Date.now() });
          }

          if (event.type === 'message_stop') {
            emit({ type: 'result', content: fullText, timestamp: Date.now() });
          }
        } catch {
          // skip malformed JSON
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
  console.log(`Mode: Anthropic Messages API (streaming)`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`Anthropic API key: ${ANTHROPIC_API_KEY ? 'configured' : 'NOT configured'}`);
  console.log(`GitHub token: ${GITHUB_TOKEN ? 'configured' : 'NOT configured (public repos only)'}`);
});
