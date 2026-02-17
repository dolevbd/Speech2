import type { SpeechToTextProvider, STTCallbacks } from '../types';

/**
 * OpenAI STT using gpt-4o-transcribe via server-side /api/stt route.
 * Records audio in the browser, sends it to the server for transcription.
 */
export class OpenAISTT implements SpeechToTextProvider {
  readonly name = 'OpenAI';
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private _listening = false;
  private callbacks: STTCallbacks = {};
  private lang = 'he';

  start(lang: string, callbacks: STTCallbacks): void {
    this.callbacks = callbacks;
    this.lang = lang;
    this._listening = true;
    this.beginRecording();
  }

  private async beginRecording(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];

      // Prefer webm/opus; fall back to whatever the browser supports
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      this.mediaRecorder.onstop = async () => {
        if (chunks.length === 0) return;
        const blob = new Blob(chunks, { type: mimeType });
        await this.transcribe(blob);
      };

      // Collect data every 100ms for potential partial feedback
      this.mediaRecorder.start(100);
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      this._listening = false;
    }
  }

  private async transcribe(blob: Blob): Promise<void> {
    try {
      const form = new FormData();
      form.append('audio', blob, 'recording.webm');
      form.append('lang', this.lang);

      const res = await fetch('/api/stt', { method: 'POST', body: form });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`STT API error ${res.status}: ${errText}`);
      }

      const { text } = (await res.json()) as { text: string };
      if (text) this.callbacks.onFinal?.(text.trim());
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  stop(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this._listening = false;
  }

  isListening(): boolean {
    return this._listening;
  }

  supportsLanguage(): boolean {
    return true; // OpenAI Whisper / gpt-4o-transcribe supports Hebrew and English
  }
}
