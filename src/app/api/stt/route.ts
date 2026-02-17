import { NextRequest, NextResponse } from 'next/server';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function POST(req: NextRequest) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  }

  try {
    const formData = await req.formData();
    const audio = formData.get('audio') as Blob | null;
    const lang = (formData.get('lang') as string) || 'he';

    if (!audio) {
      return NextResponse.json({ error: 'No audio provided' }, { status: 400 });
    }

    // Forward to OpenAI transcription API
    const body = new FormData();
    body.append('file', audio, 'recording.webm');
    body.append('model', 'gpt-4o-transcribe');
    body.append('language', lang.split('-')[0]); // "he" or "en"

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body,
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `OpenAI STT error: ${errText}` },
        { status: res.status }
      );
    }

    const data = (await res.json()) as { text: string };
    return NextResponse.json({ text: data.text });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
