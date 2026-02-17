import type { TextToSpeechProvider, TTSOptions } from '../types';

/**
 * Browser SpeechSynthesis TTS — zero-cost fallback.
 * Selects the best available Hebrew voice.
 */
export class WebSpeechTTS implements TextToSpeechProvider {
  readonly name = 'WebSpeech';
  private _speaking = false;
  private endCb: (() => void) | null = null;

  speak(text: string, opts: TTSOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!window.speechSynthesis) {
        reject(new Error('SpeechSynthesis not supported'));
        return;
      }

      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = opts.lang;
      utt.rate = opts.rate ?? 1.0;

      // Try to find a good voice for the requested language
      const voices = window.speechSynthesis.getVoices();
      const langPrefix = opts.lang.split('-')[0]; // "he" or "en"
      const match =
        voices.find((v) => v.lang === opts.lang) ??
        voices.find((v) => v.lang.startsWith(langPrefix));
      if (match) utt.voice = match;

      utt.onend = () => {
        this._speaking = false;
        this.endCb?.();
        resolve();
      };
      utt.onerror = (e) => {
        this._speaking = false;
        reject(new Error(`TTS error: ${e.error}`));
      };

      this._speaking = true;
      window.speechSynthesis.speak(utt);
    });
  }

  stop(): void {
    window.speechSynthesis?.cancel();
    this._speaking = false;
  }

  isSpeaking(): boolean {
    return this._speaking;
  }

  onEnd(cb: () => void): void {
    this.endCb = cb;
  }

  supportsLanguage(langCode: string): boolean {
    if (!window.speechSynthesis) return false;
    const voices = window.speechSynthesis.getVoices();
    const prefix = langCode.split('-')[0];
    return voices.some((v) => v.lang === langCode || v.lang.startsWith(prefix));
  }
}
