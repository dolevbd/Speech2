import type { SpeechToTextProvider, STTCallbacks, STTOptions } from '../types';

/**
 * Browser Web Speech API STT — zero-cost fallback.
 * Works in Chrome (desktop & mobile) with he-IL support.
 *
 * Accumulates multiple isFinal segments and waits for a silence timeout
 * before emitting the final transcript, so mid-sentence pauses don't
 * cut the user off.
 */
export class WebSpeechSTT implements SpeechToTextProvider {
  readonly name = 'WebSpeech';
  private recognition: SpeechRecognition | null = null;
  private _listening = false;
  private callbacks: STTCallbacks = {};
  private accumulatedText = '';
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;

  start(lang: string, callbacks: STTCallbacks, options?: STTOptions): void {
    const silenceTimeout = options?.silenceTimeout ?? 2000;

    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      callbacks.onError?.(new Error('Web Speech API not supported in this browser'));
      return;
    }

    this.stop();

    this.callbacks = callbacks;
    this.accumulatedText = '';

    const rec = new SpeechRecognition();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          // Accumulate final segments instead of firing immediately
          this.accumulatedText += (this.accumulatedText ? ' ' : '') + transcript.trim();

          // Reset silence timer — wait for more speech
          if (this.silenceTimer) clearTimeout(this.silenceTimer);
          this.silenceTimer = setTimeout(() => {
            this.flush();
          }, silenceTimeout);

          // Show accumulated text as partial so the user sees progress
          callbacks.onPartial?.(this.accumulatedText);
        } else {
          interim += transcript;
        }
      }
      if (interim) {
        // Show accumulated + interim for live feedback
        const preview = this.accumulatedText
          ? this.accumulatedText + ' ' + interim
          : interim;
        callbacks.onPartial?.(preview);
      }
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      callbacks.onError?.(new Error(`WebSpeech error: ${e.error}`));
    };

    rec.onend = () => {
      this._listening = false;
    };

    rec.start();
    this.recognition = rec;
    this._listening = true;
  }

  stop(): void {
    // Flush any accumulated text before stopping
    this.flush();

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.recognition) {
      this.recognition.abort();
      this.recognition = null;
    }
    this._listening = false;
  }

  isListening(): boolean {
    return this._listening;
  }

  supportsLanguage(langCode: string): boolean {
    // Chrome supports he-IL and en-US; can't query programmatically
    return ['he-IL', 'en-US', 'he', 'en'].includes(langCode);
  }

  /** Emit accumulated text as a final result, then reset. */
  private flush(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.accumulatedText) {
      const text = this.accumulatedText;
      this.accumulatedText = '';
      this.callbacks.onFinal?.(text);
    }
  }
}
