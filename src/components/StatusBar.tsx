'use client';

import { t } from '@/lib/i18n/translations';
import type { UILang } from '@/lib/i18n/translations';

interface StatusBarProps {
  lang: UILang;
  agentConnected: boolean;
  repoConnected: boolean;
  repoName?: string;
  onSettingsClick: () => void;
}

export function StatusBar({
  lang,
  agentConnected,
  repoConnected,
  repoName,
  onSettingsClick,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-surface border-b border-white/5">
      <div className="flex items-center gap-3 text-xs">
        {/* Agent status */}
        <span className="flex items-center gap-1">
          <span
            className={`w-2 h-2 rounded-full ${
              agentConnected ? 'bg-green-400' : 'bg-red-400'
            }`}
          />
          <span className="text-gray-400">
            {agentConnected ? t(lang, 'connected') : t(lang, 'disconnected')}
          </span>
        </span>

        {/* Repo */}
        <span className="text-gray-500">
          {repoConnected ? repoName : t(lang, 'noRepo')}
        </span>
      </div>

      {/* Settings gear */}
      <button
        onClick={onSettingsClick}
        aria-label={t(lang, 'settings')}
        className="text-gray-400 hover:text-white p-1"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path
            fillRule="evenodd"
            d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}
