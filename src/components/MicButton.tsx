'use client';

import { t } from '@/lib/i18n/translations';
import type { UILang } from '@/lib/i18n/translations';

interface MicButtonProps {
  listening: boolean;
  thinking: boolean;
  speaking: boolean;
  onPress: () => void;
  onStop: () => void;
  onStopSpeaking: () => void;
  lang: UILang;
}

export function MicButton({ listening, thinking, speaking, onPress, onStop, onStopSpeaking, lang }: MicButtonProps) {
  const active = listening;

  const handleClick = () => {
    if (speaking) {
      // Interrupt: stop speaking and immediately start listening
      onPress();
    } else if (active) {
      onStop();
    } else if (!thinking) {
      onPress();
    }
  };

  const label = speaking
    ? t(lang, 'stopSpeaking')
    : active
      ? t(lang, 'micStop')
      : thinking
        ? t(lang, 'thinking')
        : t(lang, 'micStart');

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={handleClick}
        disabled={thinking}
        aria-label={label}
        className={`
          relative w-28 h-28 rounded-full flex items-center justify-center
          transition-all duration-200 active:scale-95
          ${active
            ? 'bg-red-500 shadow-[0_0_30px_rgba(239,68,68,0.5)]'
            : speaking
              ? 'bg-amber-500 hover:bg-amber-600 shadow-[0_0_20px_rgba(245,158,11,0.4)] cursor-pointer'
              : thinking
                ? 'bg-surface-light cursor-not-allowed opacity-60'
                : 'bg-primary hover:bg-primary-dark shadow-[0_0_20px_rgba(99,102,241,0.3)]'
          }
        `}
      >
        {/* Pulse ring when listening */}
        {active && (
          <span className="absolute inset-0 rounded-full bg-red-500/30 animate-pulse-ring" />
        )}

        {/* Mic icon */}
        {!thinking && !speaking && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-12 h-12 text-white"
          >
            <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3z" />
            <path d="M19 11a1 1 0 10-2 0 5 5 0 01-10 0 1 1 0 10-2 0 7 7 0 006 6.93V20H8a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07A7 7 0 0019 11z" />
          </svg>
        )}

        {/* Thinking spinner */}
        {thinking && (
          <svg className="w-10 h-10 text-white animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path
              d="M4 12a8 8 0 018-8"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              className="opacity-75"
            />
          </svg>
        )}

        {/* Speaking wave — tap to stop */}
        {speaking && (
          <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="10" width="2" height="4" rx="1" className="animate-bounce" style={{ animationDelay: '0ms' }} />
            <rect x="7" y="7" width="2" height="10" rx="1" className="animate-bounce" style={{ animationDelay: '100ms' }} />
            <rect x="11" y="5" width="2" height="14" rx="1" className="animate-bounce" style={{ animationDelay: '200ms' }} />
            <rect x="15" y="7" width="2" height="10" rx="1" className="animate-bounce" style={{ animationDelay: '100ms' }} />
            <rect x="19" y="10" width="2" height="4" rx="1" className="animate-bounce" style={{ animationDelay: '0ms' }} />
          </svg>
        )}
      </button>

      <span className="text-sm text-gray-400">{label}</span>
    </div>
  );
}
