import express from 'express';
import cors from 'cors';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
const MAX_AGENT_TURNS = 15;

// ─── Types ───

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

type Message = {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
};

// ─── Tool Definitions for Anthropic API ───

const TOOLS = [
  {
    name: 'Read',
    description: 'Read the contents of a file. Returns file content with line numbers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path to the file (relative to repo root)' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'Write',
    description: 'Write content to a file. Creates the file if it doesn\'t exist, overwrites if it does.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path to the file (relative to repo root)' },
        content: { type: 'string', description: 'The full content to write to the file' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'Edit',
    description: 'Replace a specific string in a file. The old_string must match exactly.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path to the file (relative to repo root)' },
        old_string: { type: 'string', description: 'The exact string to find and replace' },
        new_string: { type: 'string', description: 'The replacement string' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'Bash',
    description: 'Execute a bash command in the repository directory. Use for git, npm, running tests, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The bash command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'Grep',
    description: 'Search file contents using regex. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Directory or file to search in (relative to repo root). Defaults to repo root.' },
        include: { type: 'string', description: 'Glob pattern to filter files (e.g. "*.ts", "*.py")' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'Glob',
    description: 'Find files matching a glob pattern. Returns a list of matching file paths.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.tsx", "src/**/*.py")' },
      },
      required: ['pattern'],
    },
  },
];

// ─── Tool Execution ───

function resolveSafe(repoDir: string, filePath: string): string {
  const resolved = path.resolve(repoDir, filePath);
  if (!resolved.startsWith(repoDir)) {
    throw new Error(`Path escapes repository: ${filePath}`);
  }
  return resolved;
}

function executeTool(
  name: string,
  input: Record<string, unknown>,
  repoDir: string
): { result: string; isError: boolean } {
  try {
    switch (name) {
      case 'Read': {
        const fp = resolveSafe(repoDir, input.file_path as string);
        if (!existsSync(fp)) return { result: `File not found: ${input.file_path}`, isError: true };
        const content = readFileSync(fp, 'utf-8');
        const lines = content.split('\n').map((l, i) => `${i + 1}\t${l}`).join('\n');
        return { result: lines.slice(0, 50000), isError: false };
      }

      case 'Write': {
        const fp = resolveSafe(repoDir, input.file_path as string);
        const dir = path.dirname(fp);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(fp, input.content as string, 'utf-8');
        return { result: `File written: ${input.file_path}`, isError: false };
      }

      case 'Edit': {
        const fp = resolveSafe(repoDir, input.file_path as string);
        if (!existsSync(fp)) return { result: `File not found: ${input.file_path}`, isError: true };
        const content = readFileSync(fp, 'utf-8');
        const oldStr = input.old_string as string;
        const newStr = input.new_string as string;
        if (!content.includes(oldStr)) {
          return { result: `old_string not found in file. Make sure it matches exactly.`, isError: true };
        }
        const updated = content.replace(oldStr, newStr);
        writeFileSync(fp, updated, 'utf-8');
        return { result: `File edited: ${input.file_path}`, isError: false };
      }

      case 'Bash': {
        const cmd = input.command as string;
        // Block dangerous commands
        if (/rm\s+-rf\s+[\/~]|rm\s+-rf\s+\.\s*$/i.test(cmd)) {
          return { result: 'Dangerous command blocked', isError: true };
        }
        const output = execSync(cmd, {
          cwd: repoDir,
          stdio: 'pipe',
          timeout: 60_000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        return { result: output.toString().slice(0, 50000) || '(no output)', isError: false };
      }

      case 'Grep': {
        const searchPath = input.path
          ? resolveSafe(repoDir, input.path as string)
          : repoDir;
        let cmd = `grep -rn "${(input.pattern as string).replace(/"/g, '\\"')}" "${searchPath}"`;
        if (input.include) cmd += ` --include="${input.include}"`;
        cmd += ' | head -100';
        try {
          const output = execSync(cmd, { cwd: repoDir, stdio: 'pipe', timeout: 15_000 });
          const result = output.toString().slice(0, 30000);
          return { result: result || 'No matches found', isError: false };
        } catch {
          return { result: 'No matches found', isError: false };
        }
      }

      case 'Glob': {
        const cmd = `find . -path "./.git" -prune -o -path "${input.pattern}" -print | head -200`;
        try {
          const output = execSync(cmd, { cwd: repoDir, stdio: 'pipe', timeout: 10_000 });
          return { result: output.toString().slice(0, 20000) || 'No files found', isError: false };
        } catch {
          // Fallback: use a simpler glob approach
          const cmd2 = `find . -path "./.git" -prune -o -name "${input.pattern}" -print | head -200`;
          try {
            const output = execSync(cmd2, { cwd: repoDir, stdio: 'pipe', timeout: 10_000 });
            return { result: output.toString().slice(0, 20000) || 'No files found', isError: false };
          } catch {
            return { result: 'No files found', isError: false };
          }
        }
      }

      default:
        return { result: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { result: errMsg.slice(0, 5000), isError: true };
  }
}

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
      // Always update remote URL with current token so push works
      execSync(`git remote set-url origin "${cloneUrl}"`, { cwd: repoDir, stdio: 'pipe', timeout: 5_000 });
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

  // Configure git identity for commits
  try {
    execSync('git config user.email "voice-agent@claude.ai"', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.name "Voice Agent"', { cwd: repoDir, stdio: 'pipe' });
  } catch { /* ignore */ }

  return repoDir;
}

// ─── Streaming helpers ───

interface StreamedResponse {
  contentBlocks: ContentBlock[];
  stopReason: string | null;
}

async function streamAnthropicTurn(
  system: string,
  messages: Message[],
  hasTools: boolean,
  emit: (data: Record<string, unknown>) => void
): Promise<StreamedResponse> {
  const body: Record<string, unknown> = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system,
    messages,
    stream: true,
  };
  if (hasTools) {
    body.tools = TOOLS;
  }

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    throw new Error(`Anthropic API error (${apiRes.status}): ${errText}`);
  }

  const reader = apiRes.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let stopReason: string | null = null;

  // Track content blocks as they're built
  const contentBlocks: ContentBlock[] = [];
  let currentBlockIndex = -1;
  let currentText = '';
  let currentToolUse: { id: string; name: string; inputJson: string } | null = null;

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

        switch (event.type) {
          case 'content_block_start': {
            currentBlockIndex = event.index;
            if (event.content_block?.type === 'text') {
              currentText = event.content_block.text || '';
            } else if (event.content_block?.type === 'tool_use') {
              currentToolUse = {
                id: event.content_block.id,
                name: event.content_block.name,
                inputJson: '',
              };
              emit({
                type: 'tool_use',
                content: `Using ${event.content_block.name}...`,
                toolName: event.content_block.name,
                timestamp: Date.now(),
              });
            }
            break;
          }

          case 'content_block_delta': {
            if (event.delta?.type === 'text_delta') {
              currentText += event.delta.text;
              emit({ type: 'text', content: currentText, timestamp: Date.now() });
            } else if (event.delta?.type === 'input_json_delta' && currentToolUse) {
              currentToolUse.inputJson += event.delta.partial_json;
            }
            break;
          }

          case 'content_block_stop': {
            if (currentToolUse) {
              let input: Record<string, unknown> = {};
              try { input = JSON.parse(currentToolUse.inputJson); } catch { /* empty */ }
              contentBlocks.push({
                type: 'tool_use',
                id: currentToolUse.id,
                name: currentToolUse.name,
                input,
              });
              currentToolUse = null;
            } else if (currentText) {
              contentBlocks.push({ type: 'text', text: currentText });
              currentText = '';
            }
            break;
          }

          case 'message_delta': {
            if (event.delta?.stop_reason) {
              stopReason = event.delta.stop_reason;
            }
            break;
          }
        }
      } catch {
        // skip malformed JSON
      }
    }
  }

  return { contentBlocks, stopReason };
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
    provider: ANTHROPIC_API_KEY ? 'anthropic-messages-agentic' : 'mock',
    githubConfigured: !!GITHUB_TOKEN,
    tools: TOOLS.map((t) => t.name),
  });
});

// ─── Agent Endpoint (SSE) — Anthropic Messages API with tool use loop ───

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

  // ─── Build system prompt ───
  let system =
    systemPrompt ||
    'You are Claude Code, an AI coding agent. This is a voice interface — the user is speaking to you and your response will be read aloud. Always start with a brief spoken summary of what you did or are explaining, then put any code in fenced code blocks after the summary. Keep the spoken parts concise and natural.';

  // ─── Clone repo ───
  let repoDir: string | undefined;

  if (repoContext?.owner && repoContext?.repo) {
    try {
      emit({ type: 'thinking', content: `Cloning ${repoContext.owner}/${repoContext.repo}...`, timestamp: Date.now() });
      repoDir = ensureRepo(repoContext.owner, repoContext.repo, repoContext.branch, githubToken);
      emit({ type: 'thinking', content: `Repository ready`, timestamp: Date.now() });

      system += `\n\nRepository context: ${repoContext.owner}/${repoContext.repo}`;
      if (repoContext.branch) system += ` (branch: ${repoContext.branch})`;
      system += `\nYou have tools to read, write, edit files and run commands in the repository.`;
      system += `\nAll file paths should be relative to the repo root.`;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', content: `Failed to clone repo: ${errMsg}`, timestamp: Date.now() });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
  }

  // Default working directory
  const workDir = repoDir || process.cwd();

  // ─── Build initial messages ───
  const messages: Message[] = [];
  if (history && history.length > 0) {
    // Keep generous window; merge consecutive same-role messages so
    // the Anthropic API always sees alternating user/assistant turns.
    let lastRole: string | null = null;
    for (const entry of history.slice(-40)) {
      if (entry.role === lastRole) {
        // Merge into previous message to maintain alternating roles
        const prev = messages[messages.length - 1];
        if (prev && typeof prev.content === 'string') {
          prev.content = prev.content + '\n\n' + entry.content;
        }
      } else {
        messages.push({ role: entry.role, content: entry.content });
        lastRole = entry.role;
      }
    }
    // Anthropic API requires first message to be from 'user'
    if (messages.length > 0 && messages[0].role !== 'user') {
      messages.shift();
    }
  } else {
    messages.push({ role: 'user', content: message });
  }

  emit({ type: 'thinking', content: '', timestamp: Date.now() });

  try {
    // ─── Agentic loop ───
    let turn = 0;
    let finalText = '';
    const hasTools = !!repoDir; // Only provide tools if we have a repo

    while (turn < MAX_AGENT_TURNS) {
      turn++;

      // Wrap emit so streamed text includes all previous turns' text,
      // keeping the client transcript complete across the agentic loop.
      const textPrefix = finalText;
      const turnEmit = (data: Record<string, unknown>) => {
        if (data.type === 'text' && textPrefix) {
          emit({ ...data, content: textPrefix + '\n\n' + (data.content as string) });
        } else {
          emit(data);
        }
      };

      const response = await streamAnthropicTurn(system, messages, hasTools, turnEmit);

      // Collect text from this turn — accumulate across all turns
      const textBlocks = response.contentBlocks.filter(
        (b): b is { type: 'text'; text: string } => b.type === 'text'
      );
      if (textBlocks.length > 0) {
        const turnText = textBlocks.map((b) => b.text).join('\n');
        finalText = finalText ? finalText + '\n\n' + turnText : turnText;
      }

      // Check if we need to execute tools
      const toolUseBlocks = response.contentBlocks.filter(
        (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
          b.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0 || response.stopReason === 'end_turn') {
        // No tool calls or done — we're finished
        break;
      }

      // Add assistant message with all content blocks
      messages.push({ role: 'assistant', content: response.contentBlocks });

      // Execute each tool and build tool results
      const toolResults: ContentBlock[] = [];
      for (const toolCall of toolUseBlocks) {
        emit({
          type: 'tool_use',
          content: `Running ${toolCall.name}...`,
          toolName: toolCall.name,
          toolInput: toolCall.input,
          timestamp: Date.now(),
        });

        const { result, isError } = executeTool(toolCall.name, toolCall.input, workDir);

        emit({
          type: 'tool_summary',
          content: isError ? `${toolCall.name} failed: ${result.slice(0, 200)}` : `${toolCall.name} done`,
          toolName: toolCall.name,
          timestamp: Date.now(),
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: result,
          is_error: isError,
        });
      }

      // Add tool results as user message
      messages.push({ role: 'user', content: toolResults });
    }

    emit({ type: 'result', content: finalText, timestamp: Date.now() });
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
  console.log(`Mode: Anthropic Messages API (agentic with tool use)`);
  console.log(`Tools: ${TOOLS.map((t) => t.name).join(', ')}`);
  console.log(`Max turns: ${MAX_AGENT_TURNS}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`Anthropic API key: ${ANTHROPIC_API_KEY ? 'configured' : 'NOT configured'}`);
  console.log(`GitHub token: ${GITHUB_TOKEN ? 'configured' : 'NOT configured (public repos only)'}`);
});
