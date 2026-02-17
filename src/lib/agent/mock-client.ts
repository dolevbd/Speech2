import type {
  ClaudeCodeAgentProvider,
  AgentAuth,
  AgentEvent,
  RepoContext,
  ConversationEntry,
} from '../voice/types';

/**
 * Mock agent client for Phase 1 — simulates Claude Code responses
 * so the voice pipeline can be developed end-to-end.
 */
export class MockClaudeCodeClient implements ClaudeCodeAgentProvider {
  readonly name = 'MockAgent';
  private _connected = false;
  private eventCb: ((event: AgentEvent) => void) | null = null;
  private abortController: AbortController | null = null;

  async connect(_auth: AgentAuth): Promise<void> {
    this._connected = true;
  }

  async sendUserMessage(
    text: string,
    opts: { repoContext?: RepoContext; sessionId?: string; history?: ConversationEntry[] }
  ): Promise<void> {
    if (!this._connected) throw new Error('Agent not connected');

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Simulate thinking
    this.emit({ type: 'thinking', content: 'מעבד את הבקשה...', timestamp: Date.now() });
    await this.delay(800, signal);

    if (signal.aborted) return;

    // Simulate tool use if the message mentions a file or code
    const codeRelated = /קוד|code|file|קובץ|function|פונקציה|bug|באג|fix|תקן/i.test(text);
    if (codeRelated) {
      this.emit({
        type: 'tool_use',
        content: 'קורא קבצים מהמאגר...',
        toolName: 'read_file',
        timestamp: Date.now(),
      });
      await this.delay(600, signal);
      if (signal.aborted) return;

      this.emit({
        type: 'file_change',
        content: 'עדכנתי את הקובץ',
        filePath: opts.repoContext
          ? `${opts.repoContext.repo}/src/example.ts`
          : 'src/example.ts',
        diff: '+  // Added fix\n-  // Old code',
        timestamp: Date.now(),
      });
      await this.delay(400, signal);
      if (signal.aborted) return;
    }

    // Simulate final answer
    const isHebrew = /[\u0590-\u05FF]/.test(text);
    const response = isHebrew
      ? `קיבלתי את ההוראה: "${text}". ${codeRelated ? 'ביצעתי את השינויים בקוד בהצלחה.' : 'אני מוכן לעזור עם כל משימת תכנות.'}`
      : `Got it: "${text}". ${codeRelated ? 'I\'ve made the code changes successfully.' : 'I\'m ready to help with any coding task.'}`;

    this.emit({ type: 'text', content: response, timestamp: Date.now() });
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

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
