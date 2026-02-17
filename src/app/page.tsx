'use client';

import { useState, useEffect } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { useVoicePipeline } from '@/hooks/useVoicePipeline';
import { MicButton } from '@/components/MicButton';
import { Transcript } from '@/components/Transcript';
import { AgentEvents } from '@/components/AgentEvents';
import { Settings } from '@/components/Settings';
import { StatusBar } from '@/components/StatusBar';
import { RepoConnect } from '@/components/RepoConnect';
import { t } from '@/lib/i18n/translations';
import type { RepoContext } from '@/lib/voice/types';

export default function Home() {
  const { settings, setSettings } = useSettings();
  const pipeline = useVoicePipeline(settings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [repoOpen, setRepoOpen] = useState(false);
  const [repoCtx, setRepoCtx] = useState<RepoContext | undefined>();

  const lang = settings.uiLang;

  // Register PWA service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  const handleRepoConnect = (ctx: RepoContext) => {
    setRepoCtx(ctx);
    pipeline.setRepoContext(ctx);
  };

  const handleMicPress = () => {
    if (pipeline.speaking) {
      pipeline.stopSpeaking();
    }
    pipeline.startListening();
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-[var(--color-bg)]">
      {/* Status bar */}
      <StatusBar
        lang={lang}
        agentConnected={pipeline.agentConnected}
        repoConnected={!!repoCtx}
        repoName={repoCtx ? `${repoCtx.owner}/${repoCtx.repo}` : undefined}
        onSettingsClick={() => setSettingsOpen(true)}
      />

      {/* Top toolbar */}
      <div className="flex items-center justify-between px-4 py-2">
        <h1 className="text-sm font-semibold text-gray-300">{t(lang, 'appTitle')}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRepoOpen(true)}
            className="text-xs px-2 py-1 rounded bg-surface-light text-gray-300 hover:text-white transition-colors"
          >
            {t(lang, 'connectRepo')}
          </button>
          {pipeline.transcript.length > 0 && (
            <button
              onClick={pipeline.clearTranscript}
              className="text-xs px-2 py-1 rounded bg-surface-light text-gray-400 hover:text-white"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Transcript area */}
      <Transcript
        entries={pipeline.transcript}
        partialText={pipeline.partialText}
        lang={lang}
      />

      {/* Agent events strip */}
      <AgentEvents events={pipeline.agentEvents} lang={lang} />

      {/* Error display */}
      {pipeline.error && (
        <div className="mx-4 mb-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
          {pipeline.error}
        </div>
      )}

      {/* Bottom area: toggles + mic */}
      <div className="mt-auto px-4 pb-6 pt-4 space-y-4">
        {/* Quick toggles */}
        <div className="flex items-center justify-center gap-4">
          <ToggleChip
            label={t(lang, 'handsFree')}
            active={settings.handsFree}
            onClick={() => setSettings({ handsFree: !settings.handsFree })}
          />
          <ToggleChip
            label={t(lang, 'speakResponse')}
            active={settings.speakResponse}
            onClick={() => setSettings({ speakResponse: !settings.speakResponse })}
          />
        </div>

        {/* Mic button */}
        <MicButton
          listening={pipeline.listening}
          thinking={pipeline.thinking}
          speaking={pipeline.speaking}
          onPress={handleMicPress}
          onStop={pipeline.stopListening}
          lang={lang}
        />
      </div>

      {/* Modals */}
      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdate={setSettings}
      />
      <RepoConnect
        open={repoOpen}
        onClose={() => setRepoOpen(false)}
        onConnect={handleRepoConnect}
        lang={lang}
      />
    </div>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active
          ? 'bg-primary/20 text-primary border border-primary/40'
          : 'bg-surface-light text-gray-400 border border-transparent'
      }`}
    >
      {label}
    </button>
  );
}
