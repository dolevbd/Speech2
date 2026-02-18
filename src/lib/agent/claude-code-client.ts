import type {
  ClaudeCodeAgentProvider,
  AgentAuth,
  AgentEvent,
  RepoContext,
  ConversationEntry,
} from '../voice/types';
import { AGENT_SYSTEM_PROMPT } from './types';

interface AgentHealthResponse {
  ok: boolean;
  provider: string;
}

/**
 * Real Claude Code agent client.
 *
 * Communicates with the server-side /api/agent route which can use either:
 * - Claude Agent SDK (full code agent with file edit, bash, etc.)
 * - Anthropic Messages API fallback (chat only)
 *
 * All API keys stay server-side. The client only processes SSE events.
 */
export class ClaudeCodeClient implements ClaudeCodeAgentProvider {
  readonly name = 'ClaudeCode';
  private _connected = false;
  private _provider = 'unknown';
  private _sessionId: string | undefined;
  private eventCb: ((event: AgentEvent) => void) | null = null;
  private abortController: AbortController | null = null;

  /**
   * Base URL for the agent API.
   * Always uses the local /api/agent route which proxies to the external backend
   * when AGENT_BACKEND_URL is set server-side — no CORS issues.
   */
  private baseUrl = '';

  get provider() {
    return this._provider;
  }

  get sessionId() {
    return this._sessionId;
  }

  async connect(_auth: AgentAuth): Promise<void> {
    const url = `${this.baseUrl}/api/agent`;
    console.log('[ClaudeCodeClient] Connecting to:', url);
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Cannot connect to agent backend (HTTP ${res.status}): ${text}`);
    }
    const data = (await res.json()) as AgentHealthResponse & { debug?: Record<string, unknown> };
    console.log('[ClaudeCodeClient] Health check response:', JSON.stringify(data));
    if (!data.ok) throw new Error(`Agent backend not configured: ${JSON.stringify(data.debug || {})}`);
    this._provider = data.provider;
    this._connected = true;
  }

  async sendUserMessage(
    text: string,
    opts: { repoContext?: RepoContext; sessionId?: string; history?: ConversationEntry[] }
  ): Promise<void> {
    if (!this._connected) throw new Error('Agent not connected');

    this.abortController = new AbortController();

    this.emit({ type: 'thinking', content: '', timestamp: Date.now() });

    const res = await fetch(`${this.baseUrl}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        systemPrompt: AGENT_SYSTEM_PROMPT,
        repoContext: opts.repoContext,
        sessionId: opts.sessionId ?? this._sessionId,
        githubToken: opts.repoContext?.githubToken,
        history: opts.history,
      }),
      signal: this.abortController.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      this.emit({ type: 'error', content: errText, timestamp: Date.now() });
      return;
    }

    if (!res.body) {
      this.emit({ type: 'error', content: 'No response body', timestamp: Date.now() });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          this.emit({ type: 'done', content: '', timestamp: Date.now() });
          return;
        }
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          this.processServerEvent(parsed);
        } catch {
          // skip malformed lines
        }
      }
    }

    this.emit({ type: 'done', content: '', timestamp: Date.now() });
  }

  onAgentEvent(cb: (event: AgentEvent) => void): void {
    this.eventCb = cb;
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  isConnected(): boolean {
    return this._connected;
  }

  /**
   * Map server SSE events (from both SDK and Messages API modes) to our AgentEvent type.
   */
  private processServerEvent(ev: Record<string, unknown>): void {
    const type = ev.type as string;
    const ts = (ev.timestamp as number) ?? Date.now();
    const content = (ev.content as string) ?? '';

    switch (type) {
      case 'thinking':
        this.emit({ type: 'thinking', content, timestamp: ts });
        break;

      case 'text':
        this.emit({ type: 'text', content, timestamp: ts });
        break;

      case 'tool_use':
        this.emit({
          type: 'tool_use',
          content,
          toolName: ev.toolName as string,
          timestamp: ts,
        });
        break;

      case 'tool_progress':
        this.emit({
          type: 'tool_use',
          content,
          toolName: ev.toolName as string,
          timestamp: ts,
        });
        break;

      case 'tool_summary':
        this.emit({ type: 'text', content, timestamp: ts });
        break;

      case 'file_change':
        this.emit({
          type: 'file_change',
          content,
          filePath: ev.filePath as string,
          diff: ev.diff as string,
          timestamp: ts,
        });
        break;

      case 'system_init':
        // Capture session ID for multi-turn conversations
        if (ev.sessionId) {
          this._sessionId = ev.sessionId as string;
        }
        this.emit({ type: 'thinking', content: `Agent ready (${ev.model})`, timestamp: ts });
        break;

      case 'result':
        if (ev.sessionId) {
          this._sessionId = ev.sessionId as string;
        }
        this.emit({ type: 'text', content, timestamp: ts });
        break;

      case 'error':
        this.emit({ type: 'error', content, timestamp: ts });
        break;

      case 'done':
        this.emit({ type: 'done', content: '', timestamp: ts });
        break;

      default:
        // Forward unknown events as text
        if (content) {
          this.emit({ type: 'text', content, timestamp: ts });
        }
    }
  }

  private emit(event: AgentEvent): void {
    this.eventCb?.(event);
  }
}
