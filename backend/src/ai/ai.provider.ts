import { Inject, Injectable } from '@nestjs/common';
import { readFile, writeFile } from 'fs/promises';
import { FETCH } from '../common/fetch.token';
import { config } from '../config';
import { durationSeconds, synthesizeTone } from '../media/ffmpeg';
import { Segment } from '../media/vtt';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

export interface AiProvider {
  /** Speech to text with timings. */
  transcribe(wavPath: string, lang: string): Promise<Segment[]>;
  /** Translates subtitle segments, keeping timings. */
  translate(segments: Segment[], from: string, to: string): Promise<Segment[]>;
  /** Text to speech; writes an audio file (wav/mp3) and returns its path. */
  synthesize(text: string, lang: string, outPathNoExt: string): Promise<string>;
}

/** Development provider: fake transcripts, "[xx]"-prefixed translations and tone "voices". */
@Injectable()
export class SandboxAiProvider implements AiProvider {
  async transcribe(wavPath: string, lang: string): Promise<Segment[]> {
    const total = await durationSeconds(wavPath);
    const segs: Segment[] = [];
    for (let t = 0; t < Math.max(total, 1); t += 4) {
      segs.push({ start: t, end: Math.min(t + 3.5, Math.max(total, 1)), text: `Sandbox ${lang} line ${segs.length + 1}` });
    }
    return segs;
  }

  async translate(segments: Segment[], _from: string, to: string): Promise<Segment[]> {
    return segments.map((s) => ({ ...s, text: `[${to}] ${s.text}` }));
  }

  async synthesize(text: string, _lang: string, outPathNoExt: string): Promise<string> {
    const out = `${outPathNoExt}.wav`;
    await synthesizeTone(Math.min(Math.max(text.length / 15, 0.5), 10), out, 180 + (text.length % 7) * 20);
    return out;
  }
}

/**
 * Any OpenAI-compatible API: /audio/transcriptions (Whisper), /chat/completions, /audio/speech.
 * Swap the base URL for Azure OpenAI, Groq, a self-hosted whisper server, etc.
 */
@Injectable()
export class OpenAiProvider implements AiProvider {
  constructor(@Inject(FETCH) private readonly fetchImpl: typeof fetch = fetch) {}

  private headers(json = true): Record<string, string> {
    return { Authorization: `Bearer ${config.ai.apiKey}`, ...(json && { 'content-type': 'application/json' }) };
  }

  private async check(res: Response, what: string) {
    if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  async transcribe(wavPath: string, lang: string): Promise<Segment[]> {
    const form = new FormData();
    form.append('file', new Blob([await readFile(wavPath)], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', config.ai.transcribeModel);
    form.append('language', lang);
    form.append('response_format', 'verbose_json');
    const res = await this.fetchImpl(`${config.ai.baseUrl}/audio/transcriptions`, { method: 'POST', headers: this.headers(false), body: form });
    await this.check(res, 'Transcription');
    const body = (await res.json()) as { segments?: { start: number; end: number; text: string }[] };
    return (body.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })).filter((s) => s.text);
  }

  async translate(segments: Segment[], from: string, to: string): Promise<Segment[]> {
    if (segments.length === 0) return [];
    const res = await this.fetchImpl(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: config.ai.chatModel,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              `You translate subtitles of a short romantic drama from ${from} to ${to}. ` +
              'Keep the tone natural and dramatic, keep each line short enough to read in its time slot, keep names. ' +
              'Reply with JSON: {"lines": ["...", ...]} with exactly one translated line per input line, same order.',
          },
          { role: 'user', content: JSON.stringify({ lines: segments.map((s) => s.text) }) },
        ],
      }),
    });
    await this.check(res, 'Translation');
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    const parsed = JSON.parse(body.choices[0].message.content) as { lines: string[] };
    if (!Array.isArray(parsed.lines) || parsed.lines.length !== segments.length) {
      throw new Error(`Translation returned ${parsed.lines?.length} lines for ${segments.length} inputs`);
    }
    return segments.map((s, i) => ({ ...s, text: String(parsed.lines[i]) }));
  }

  async synthesize(text: string, _lang: string, outPathNoExt: string): Promise<string> {
    const res = await this.fetchImpl(`${config.ai.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: config.ai.ttsModel, voice: config.ai.ttsVoice, input: text, response_format: 'mp3' }),
    });
    await this.check(res, 'Speech synthesis');
    const out = `${outPathNoExt}.mp3`;
    await writeFile(out, Buffer.from(await res.arrayBuffer()));
    return out;
  }
}
