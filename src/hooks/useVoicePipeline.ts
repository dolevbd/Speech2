'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  SpeechToTextProvider,
  TextToSpeechProvider,
  ClaudeCodeAgentProvider,
  AgentEvent,
  RepoContext,
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

function createAgent(mock: boolean): ClaudeCodeAgentProvider {
  if (mock) {
    const { MockClaudeCodeClient } = require('@/lib/agent/mock-client');
    return new MockClaudeCodeClient();
  }
  const { ClaudeCodeClient } = require('@/lib/agent/claude-code-client');
  return new ClaudeCodeClient();
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
    error: null,
  });

  const sttRef = useRef<SpeechToTextProvider | null>(null);
  const ttsRef = useRef<TextToSpeechProvider | null>(null);
  const agentRef = useRef<ClaudeCodeAgentProvider | null>(null);
  const repoCtxRef = useRef<RepoContext | undefined>(undefined);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Initialize providers when settings change
  useEffect(() => {
    sttRef.current = createSTT(settings.sttProvider);
    ttsRef.current = createTTS(settings.ttsProvider);
  }, [settings.sttProvider, settings.ttsProvider]);

  // Initialize agent (mock for now)
  useEffect(() => {
    const useMock = true; // Phase 1: always mock
    const agent = createAgent(useMock);
    agent.connect({});
    agent.onAgentEvent((event: AgentEvent) => {
      setState((s) => ({ ...s, agentEvents: [...s.agentEvents, event] }));

      if (event.type === 'text') {
        setState((s) => ({
          ...s,
          transcript: [
            ...s.transcript,
            { role: 'agent', text: event.content, timestamp: event.timestamp },
          ],
        }));
      }

      if (event.type === 'done') {
        setState((s) => ({ ...s, thinking: false }));

        // Read the last agent text aloud if speakResponse is on
        const lastText = event.content || '';
        handleAgentDone(lastText);
      }

      if (event.type === 'error') {
        setState((s) => ({ ...s, error: event.content, thinking: false }));
      }
    });

    agentRef.current = agent;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAgentDone = useCallback(async (directText?: string) => {
    const s = settingsRef.current;
    if (!s.speakResponse || !ttsRef.current) {
      // If hands-free, restart listening
      if (s.handsFree) startListening();
      return;
    }

    // Find last agent message
    setState((prev) => {
      const lastAgent = [...prev.transcript].reverse().find((e) => e.role === 'agent');
      const textToSpeak = directText || lastAgent?.text;
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
        setState((s) => ({
          ...s,
          listening: false,
          partialText: '',
          thinking: true,
          transcript: [
            ...s.transcript,
            { role: 'user', text, timestamp: Date.now() },
          ],
        }));
        stt.stop();
        // Send to agent
        agentRef.current?.sendUserMessage(text, {
          repoContext: repoCtxRef.current,
        });
      },
      onError: (err) => {
        setState((s) => ({ ...s, listening: false, error: err.message }));
      },
    });
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
