import type {
  ClaudeCodeAgentProvider,
  AgentAuth,
  AgentEvent,
  RepoContext,
} from '../voice/types';
import { AGENT_SYSTEM_PROMPT } from './types';

/**
 * Real Claude Code agent client — Phase 3 implementation.
 *
 * Uses the Anthropic Messages API with streaming and tool-use capabilities.
 * Server-side route /api/agent handles the actual API calls to keep keys safe.
 */
export class ClaudeCodeClient implements ClaudeCodeAgentProvider {
  readonly name = 'ClaudeCode';
  private _connected = false;
  private eventCb: ((event: AgentEvent) => void) | null = null;
  private abortController: AbortController | null = null;

  async connect(_auth: AgentAuth): Promise<void> {
    // Verify the server-side agent route is accessible
    const res = await fetch('/api/agent', { method: 'GET' });
    if (!res.ok) throw new Error('Cannot connect to agent backend');
    this._connected = true;
  }

  async sendUserMessage(
    text: string,
    opts: { repoContext?: RepoContext; sessionId?: string }
  ): Promise<void> {
    if (!this._connected) throw new Error('Agent not connected');

    this.abortController = new AbortController();

    this.emit({ type: 'thinking', content: '', timestamp: Date.now() });

    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        systemPrompt: AGENT_SYSTEM_PROMPT,
        repoContext: opts.repoContext,
        sessionId: opts.sessionId,
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

    // Read SSE stream
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
          const event = JSON.parse(data) as AgentEvent;
          this.emit(event);
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

  private emit(event: AgentEvent): void {
    this.eventCb?.(event);
  }
}
