import type { SpeechToTextProvider, STTCallbacks } from '../types';

/**
 * Browser Web Speech API STT — zero-cost fallback.
 * Works in Chrome (desktop & mobile) with he-IL support.
 */
export class WebSpeechSTT implements SpeechToTextProvider {
  readonly name = 'WebSpeech';
  private recognition: SpeechRecognition | null = null;
  private _listening = false;

  start(lang: string, callbacks: STTCallbacks): void {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      callbacks.onError?.(new Error('Web Speech API not supported in this browser'));
      return;
    }

    this.stop();

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
          callbacks.onFinal?.(transcript.trim());
        } else {
          interim += transcript;
        }
      }
      if (interim) callbacks.onPartial?.(interim);
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
}
