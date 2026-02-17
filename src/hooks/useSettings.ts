'use client';

import { useState, useCallback, useEffect } from 'react';
import type { UILang } from '@/lib/i18n/translations';

export type STTProviderName = 'WebSpeech' | 'OpenAI';
export type TTSProviderName = 'WebSpeech' | 'OpenAI';

export interface Settings {
  uiLang: UILang;
  sttProvider: STTProviderName;
  ttsProvider: TTSProviderName;
  voiceLang: 'he-IL' | 'en-US';
  voiceSpeed: number;
  handsFree: boolean;
  speakResponse: boolean;
  streaming: boolean;
}

const STORAGE_KEY = 'voice-agent-settings';

const defaults: Settings = {
  uiLang: 'he',
  sttProvider: 'WebSpeech',
  ttsProvider: 'WebSpeech',
  voiceLang: 'he-IL',
  voiceSpeed: 1.0,
  handsFree: false,
  speakResponse: true,
  streaming: true,
};

export function useSettings() {
  const [settings, setSettingsState] = useState<Settings>(defaults);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSettingsState({ ...defaults, ...JSON.parse(stored) });
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // quota exceeded etc.
      }
      return next;
    });
  }, []);

  return { settings, setSettings };
}
