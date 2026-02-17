'use client';

import { useEffect, useRef } from 'react';
import { t } from '@/lib/i18n/translations';
import type { UILang } from '@/lib/i18n/translations';
import type { TranscriptEntry } from '@/hooks/useVoicePipeline';

interface TranscriptProps {
  entries: TranscriptEntry[];
  partialText: string;
  lang: UILang;
}

export function Transcript({ entries, partialText, lang }: TranscriptProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length, partialText]);

  if (entries.length === 0 && !partialText) return null;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 max-h-[50vh]">
      {entries.map((entry, i) => (
        <div key={i} className="transcript-entry">
          <span
            className={`text-xs font-semibold ${
              entry.role === 'user' ? 'text-accent' : 'text-primary'
            }`}
          >
            {entry.role === 'user' ? t(lang, 'userLabel') : t(lang, 'agentLabel')}
          </span>
          <p className="text-base leading-relaxed mt-0.5 whitespace-pre-wrap">
            {entry.text}
          </p>
        </div>
      ))}

      {partialText && (
        <div className="transcript-entry opacity-60">
          <span className="text-xs font-semibold text-accent">
            {t(lang, 'userLabel')}
          </span>
          <p className="text-base leading-relaxed mt-0.5 italic">{partialText}</p>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
