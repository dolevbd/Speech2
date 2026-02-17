// ─── Speech-to-Text Provider Interface ───

export interface STTCallbacks {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (error: Error) => void;
}

export interface STTOptions {
  /** Milliseconds of silence before finalizing speech. Default 2000. */
  silenceTimeout?: number;
}

export interface SpeechToTextProvider {
  readonly name: string;
  start(lang: string, callbacks: STTCallbacks, options?: STTOptions): void;
  stop(): void;
  isListening(): boolean;
  supportsLanguage(langCode: string): boolean;
}

// ─── Text-to-Speech Provider Interface ───

export interface TTSOptions {
  lang: string;
  rate?: number;   // 0.5–2.0, default 1.0
  voice?: string;  // provider-specific voice ID
}

export interface TextToSpeechProvider {
  readonly name: string;
  speak(text: string, opts: TTSOptions): Promise<void>;
  stop(): void;
  isSpeaking(): boolean;
  onEnd(cb: () => void): void;
  supportsLanguage(langCode: string): boolean;
}

// ─── Claude Code Agent Provider Interface ───

export type AgentEventType =
  | 'thinking'
  | 'tool_use'
  | 'file_change'
  | 'text'
  | 'error'
  | 'done';

export interface AgentEvent {
  type: AgentEventType;
  content: string;
  /** For tool_use events */
  toolName?: string;
  /** For file_change events */
  filePath?: string;
  diff?: string;
  timestamp: number;
}

export interface AgentAuth {
  apiKey?: string;
  githubToken?: string;
}

export interface RepoContext {
  owner: string;
  repo: string;
  branch?: string;
  githubToken?: string;
}

export interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeCodeAgentProvider {
  readonly name: string;
  connect(auth: AgentAuth): Promise<void>;
  sendUserMessage(
    text: string,
    opts: { repoContext?: RepoContext; sessionId?: string; history?: ConversationEntry[] }
  ): Promise<void>;
  onAgentEvent(cb: (event: AgentEvent) => void): void;
  cancel(sessionId?: string): void;
  isConnected(): boolean;
}

// ─── Shared ───

export type SupportedLang = 'he-IL' | 'en-US';
