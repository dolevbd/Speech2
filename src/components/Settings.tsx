'use client';

import { t } from '@/lib/i18n/translations';
import type { UILang } from '@/lib/i18n/translations';
import type { Settings as SettingsType, STTProviderName, TTSProviderName } from '@/hooks/useSettings';

interface SettingsProps {
  open: boolean;
  onClose: () => void;
  settings: SettingsType;
  onUpdate: (patch: Partial<SettingsType>) => void;
}

export function Settings({ open, onClose, settings, onUpdate }: SettingsProps) {
  if (!open) return null;

  const lang: UILang = settings.uiLang;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center">
      <div className="bg-surface w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{t(lang, 'settings')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">
            &times;
          </button>
        </div>

        {/* UI Language */}
        <Field label={t(lang, 'language')}>
          <select
            value={settings.uiLang}
            onChange={(e) => {
              const uiLang = e.target.value as UILang;
              const voiceLang = uiLang === 'he' ? 'he-IL' : 'en-US';
              onUpdate({ uiLang, voiceLang } as Partial<SettingsType>);
            }}
            className="select-field"
          >
            <option value="he">עברית</option>
            <option value="en">English</option>
          </select>
        </Field>

        {/* STT Provider */}
        <Field label={t(lang, 'sttProvider')}>
          <select
            value={settings.sttProvider}
            onChange={(e) => onUpdate({ sttProvider: e.target.value as STTProviderName })}
            className="select-field"
          >
            <option value="WebSpeech">Web Speech API</option>
            <option value="OpenAI">OpenAI (gpt-4o-transcribe)</option>
          </select>
        </Field>

        {/* TTS Provider */}
        <Field label={t(lang, 'ttsProvider')}>
          <select
            value={settings.ttsProvider}
            onChange={(e) => onUpdate({ ttsProvider: e.target.value as TTSProviderName })}
            className="select-field"
          >
            <option value="WebSpeech">SpeechSynthesis</option>
            <option value="OpenAI">OpenAI TTS</option>
          </select>
        </Field>

        {/* Voice Speed */}
        <Field label={`${t(lang, 'voiceSpeed')}: ${settings.voiceSpeed.toFixed(1)}x`}>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={settings.voiceSpeed}
            onChange={(e) => onUpdate({ voiceSpeed: parseFloat(e.target.value) })}
            className="w-full accent-primary"
          />
        </Field>

        {/* Hands-free */}
        <Toggle
          label={t(lang, 'handsFree')}
          checked={settings.handsFree}
          onChange={(v) => onUpdate({ handsFree: v })}
        />

        {/* Speak response */}
        <Toggle
          label={t(lang, 'speakResponse')}
          checked={settings.speakResponse}
          onChange={(v) => onUpdate({ speakResponse: v })}
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <span className="text-sm">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`w-12 h-6 rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-gray-600'
        } relative`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
