'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n/translations';
import type { UILang } from '@/lib/i18n/translations';
import type { RepoContext } from '@/lib/voice/types';

interface RepoConnectProps {
  open: boolean;
  onClose: () => void;
  onConnect: (ctx: RepoContext) => void;
  lang: UILang;
}

export function RepoConnect({ open, onClose, onConnect, lang }: RepoConnectProps) {
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');

  if (!open) return null;

  const handleSubmit = () => {
    if (!owner.trim() || !repo.trim()) return;
    onConnect({ owner: owner.trim(), repo: repo.trim(), branch: branch.trim() || undefined });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center">
      <div className="bg-surface w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{t(lang, 'connectRepo')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">
            &times;
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t(lang, 'owner')}</label>
            <input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="dolevbd"
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t(lang, 'repo')}</label>
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="Speech2"
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t(lang, 'branch')}</label>
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="input-field"
            />
          </div>

          <button
            onClick={handleSubmit}
            className="w-full py-2.5 bg-primary hover:bg-primary-dark rounded-lg text-white font-medium transition-colors"
          >
            {t(lang, 'connect')}
          </button>
        </div>
      </div>
    </div>
  );
}
