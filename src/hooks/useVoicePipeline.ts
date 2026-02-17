'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  SpeechToTextProvider,
  TextToSpeechProvider,
  ClaudeCodeAgentProvider,
  AgentEvent,
  RepoContext,
  ConversationEntry,
} from '@/lib/voice/types';
import type { Settings } from './useSettings';

// Lazy provider factories — avoid importing browser APIs at module level
function createSTT(name: string): SpeechToTextProvider {
  if (name === 'OpenAI') {
    const { OpenAISTT } = require('@/lib/voice/stt/openai-stt');
    return new OpenAISTT();
  }
  const { WebSpeechSTT } = require('@/lib/voice/stt/web-speech-stt');
  return new WebSpeechSTT();
}

function createTTS(name: string): TextToSpeechProvider {
  if (name === 'OpenAI') {
    const { OpenAITTS } = require('@/lib/voice/tts/openai-tts');
    return new OpenAITTS();
  }
  const { WebSpeechTTS } = require('@/lib/voice/tts/web-speech-tts');
  return new WebSpeechTTS();
}

async function createAgent(): Promise<ClaudeCodeAgentProvider> {
  // Try to connect to real agent backend first; fall back to mock
  try {
    const { ClaudeCodeClient } = require('@/lib/agent/claude-code-client');
    const client = new ClaudeCodeClient();
    await client.connect({});
    return client;
  } catch {
    // Backend not configured or unreachable — use mock
    const { MockClaudeCodeClient } = require('@/lib/agent/mock-client');
    const mock = new MockClaudeCodeClient();
    await mock.connect({});
    return mock;
  }
}

export interface TranscriptEntry {
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
}

export interface PipelineState {
  listening: boolean;
  thinking: boolean;
  speaking: boolean;
  partialText: string;
  transcript: TranscriptEntry[];
  agentEvents: AgentEvent[];
  agentConnected: boolean;
  agentProvider: string;
  error: string | null;
}

export function useVoicePipeline(settings: Settings) {
  const [state, setState] = useState<PipelineState>({
    listening: false,
    thinking: false,
    speaking: false,
    partialText: '',
    transcript: [],
    agentEvents: [],
    agentConnected: false,
    agentProvider: 'initializing',
    error: null,
  });

  const sttRef = useRef<SpeechToTextProvider | null>(null);
  const ttsRef = useRef<TextToSpeechProvider | null>(null);
  const agentRef = useRef<ClaudeCodeAgentProvider | null>(null);
  const repoCtxRef = useRef<RepoContext | undefined>(undefined);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Initialize STT/TTS providers when settings change
  useEffect(() => {
    sttRef.current = createSTT(settings.sttProvider);
    ttsRef.current = createTTS(settings.ttsProvider);
  }, [settings.sttProvider, settings.ttsProvider]);

  // Initialize agent — tries real backend, falls back to mock
  useEffect(() => {
    let cancelled = false;

    const setupAgentHandler = (agent: ClaudeCodeAgentProvider) => {
      agent.onAgentEvent((event: AgentEvent) => {
        if (cancelled) return;

        setState((s) => ({ ...s, agentEvents: [...s.agentEvents, event] }));

        if (event.type === 'text') {
          setState((s) => {
            const last = s.transcript[s.transcript.length - 1];
            // Update existing agent message instead of adding a new one each stream chunk
            if (last && last.role === 'agent') {
              const updated = [...s.transcript];
              updated[updated.length - 1] = { ...last, text: event.content };
              return { ...s, transcript: updated };
            }
            // First text chunk — add a new agent entry
            return {
              ...s,
              transcript: [
                ...s.transcript,
                { role: 'agent', text: event.content, timestamp: event.timestamp },
              ],
            };
          });
        }

        if (event.type === 'done') {
          setState((s) => ({ ...s, thinking: false }));
          handleAgentDone();
        }

        if (event.type === 'error') {
          setState((s) => ({ ...s, error: event.content, thinking: false }));
        }
      });
    };

    createAgent().then((agent) => {
      if (cancelled) return;
      setupAgentHandler(agent);
      agentRef.current = agent;
      setState((s) => ({
        ...s,
        agentConnected: agent.isConnected(),
        agentProvider: agent.name,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAgentDone = useCallback(() => {
    const s = settingsRef.current;
    if (!s.speakResponse || !ttsRef.current) {
      if (s.handsFree) startListening();
      return;
    }

    setState((prev) => {
      const lastAgent = [...prev.transcript].reverse().find((e) => e.role === 'agent');
      // Strip fenced code blocks and inline code so TTS only reads the summary
      const textToSpeak = lastAgent?.text
        ?.replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]+`/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (textToSpeak && ttsRef.current) {
        setState((ss) => ({ ...ss, speaking: true }));
        ttsRef.current
          .speak(textToSpeak, { lang: s.voiceLang, rate: s.voiceSpeed })
          .then(() => {
            setState((ss) => ({ ...ss, speaking: false }));
            if (settingsRef.current.handsFree) startListening();
          })
          .catch(() => {
            setState((ss) => ({ ...ss, speaking: false }));
            if (settingsRef.current.handsFree) startListening();
          });
      } else {
        if (s.handsFree) startListening();
      }
      return prev;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startListening = useCallback(() => {
    const stt = sttRef.current;
    if (!stt) return;

    setState((s) => ({ ...s, listening: true, partialText: '', error: null }));

    stt.start(settingsRef.current.voiceLang, {
      onPartial: (text) => {
        setState((s) => ({ ...s, partialText: text }));
      },
      onFinal: (text) => {
        // Capture conversation history from current state before updating
        let history: ConversationEntry[] = [];
        setState((s) => {
          // Build history: map transcript + current user message
          history = [
            ...s.transcript.map((e) => ({
              role: (e.role === 'agent' ? 'assistant' : 'user') as ConversationEntry['role'],
              content: e.text,
            })),
            { role: 'user' as const, content: text },
          ];
          return {
            ...s,
            listening: false,
            partialText: '',
            thinking: true,
            transcript: [
              ...s.transcript,
              { role: 'user', text, timestamp: Date.now() },
            ],
          };
        });
        stt.stop();
        agentRef.current?.sendUserMessage(text, {
          repoContext: repoCtxRef.current,
          history,
        });
      },
      onError: (err) => {
        setState((s) => ({ ...s, listening: false, error: err.message }));
      },
    }, { silenceTimeout: settingsRef.current.silenceTimeout });
  }, []);

  const stopListening = useCallback(() => {
    sttRef.current?.stop();
    setState((s) => ({ ...s, listening: false }));
  }, []);

  const stopSpeaking = useCallback(() => {
    ttsRef.current?.stop();
    setState((s) => ({ ...s, speaking: false }));
  }, []);

  const cancelAgent = useCallback(() => {
    agentRef.current?.cancel();
    setState((s) => ({ ...s, thinking: false }));
  }, []);

  const setRepoContext = useCallback((ctx: RepoContext | undefined) => {
    repoCtxRef.current = ctx;
  }, []);

  const clearTranscript = useCallback(() => {
    setState((s) => ({ ...s, transcript: [], agentEvents: [] }));
  }, []);

  return {
    ...state,
    startListening,
    stopListening,
    stopSpeaking,
    cancelAgent,
    setRepoContext,
    clearTranscript,
  };
}
