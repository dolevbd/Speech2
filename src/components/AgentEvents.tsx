'use client';

import { t } from '@/lib/i18n/translations';
import type { UILang } from '@/lib/i18n/translations';
import type { AgentEvent } from '@/lib/voice/types';

interface AgentEventsProps {
  events: AgentEvent[];
  lang: UILang;
}

export function AgentEvents({ events, lang }: AgentEventsProps) {
  // Only show tool_use and file_change events
  const relevant = events.filter((e) => e.type === 'tool_use' || e.type === 'file_change');

  if (relevant.length === 0) return null;

  return (
    <div className="px-4 py-2 space-y-1">
      {relevant.map((event, i) => (
        <div
          key={i}
          className="flex items-center gap-2 text-xs text-gray-400 bg-surface-light/50 rounded px-2 py-1"
        >
          {event.type === 'tool_use' && (
            <>
              <span className="text-yellow-400">&#9881;</span>
              <span>{t(lang, 'toolUse')}: {event.toolName}</span>
            </>
          )}
          {event.type === 'file_change' && (
            <>
              <span className="text-green-400">&#9998;</span>
              <span>{t(lang, 'fileChange')}: {event.filePath}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
