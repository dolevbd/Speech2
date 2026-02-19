'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n/translations';
import type { UILang } from '@/lib/i18n/translations';
import type { AgentEvent } from '@/lib/voice/types';

interface AgentEventsProps {
  events: AgentEvent[];
  lang: UILang;
}

export function AgentEvents({ events, lang }: AgentEventsProps) {
  const [expanded, setExpanded] = useState(false);

  const relevant = events.filter((e) => e.type === 'tool_use' || e.type === 'file_change');
  if (relevant.length === 0) return null;

  const latest = relevant[relevant.length - 1];
  const latestLabel =
    latest.type === 'tool_use'
      ? `${latest.toolName}`
      : latest.filePath ?? '';

  return (
    <div className="mx-4 mb-1">
      {/* Compact single-line summary */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-xs text-gray-500 hover:text-gray-300 transition-colors py-1"
      >
        <span className="text-yellow-400/70 text-[10px]">&#9881;</span>
        <span className="truncate">
          {relevant.length === 1
            ? latestLabel
            : `${latestLabel} +${relevant.length - 1}`}
        </span>
        <span className="ml-auto text-[10px] text-gray-600">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded list */}
      {expanded && (
        <div className="max-h-32 overflow-y-auto space-y-0.5 pb-1">
          {relevant.map((event, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 text-[11px] text-gray-500 pl-4"
            >
              {event.type === 'tool_use' && (
                <>
                  <span className="text-yellow-400/60">&#9881;</span>
                  <span className="truncate">{event.toolName}</span>
                </>
              )}
              {event.type === 'file_change' && (
                <>
                  <span className="text-green-400/60">&#9998;</span>
                  <span className="truncate">{event.filePath}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
