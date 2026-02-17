import type { TextToSpeechProvider, TTSOptions } from '../types';

/**
 * OpenAI TTS using gpt-4o-mini-tts via server-side /api/tts route.
 * Streams audio from the server and plays it using Web Audio.
 */
export class OpenAITTS implements TextToSpeechProvider {
  readonly name = 'OpenAI';
  private _speaking = false;
  private endCb: (() => void) | null = null;
  private currentAudio: HTMLAudioElement | null = null;

  async speak(text: string, opts: TTSOptions): Promise<void> {
    this.stop();
    this._speaking = true;

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          lang: opts.lang,
          speed: opts.rate ?? 1.0,
          voice: opts.voice ?? 'coral',
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`TTS API error ${res.status}: ${errText}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.currentAudio = audio;

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(url);
          this._speaking = false;
          this.endCb?.();
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          this._speaking = false;
          reject(new Error('Audio playback error'));
        };
        audio.play().catch(reject);
      });
    } catch (err) {
      this._speaking = false;
      throw err;
    }
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this._speaking = false;
  }

  isSpeaking(): boolean {
    return this._speaking;
  }

  onEnd(cb: () => void): void {
    this.endCb = cb;
  }

  supportsLanguage(): boolean {
    return true; // OpenAI TTS supports Hebrew
  }
}
