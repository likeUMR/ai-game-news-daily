import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface TTSRequest {
  id: string;
  text: string;
  outputPath: string;
  voice?: string;
}

export interface TTSResult {
  audioPath: string;
  durationMs: number;
}

export interface TTSProvider {
  synthesize(request: TTSRequest): Promise<TTSResult>;
}

export class MockTTSProvider implements TTSProvider {
  constructor(private readonly options: { baseMs?: number; msPerCharacter?: number; minMs?: number; maxMs?: number } = {}) {}

  async synthesize(request: TTSRequest): Promise<TTSResult> {
    const durationMs = this.calculateDurationMs(request.text);
    await mkdir(dirname(request.outputPath), { recursive: true });
    await writeFile(request.outputPath, createSilentWav(durationMs));
    return {
      audioPath: request.outputPath,
      durationMs
    };
  }

  calculateDurationMs(text: string): number {
    const baseMs = this.options.baseMs ?? 500;
    const msPerCharacter = this.options.msPerCharacter ?? 80;
    const minMs = this.options.minMs ?? 900;
    const maxMs = this.options.maxMs ?? 12_000;
    const spokenCharacters = [...text.replace(/\s+/gu, "")].length;
    return Math.min(maxMs, Math.max(minMs, baseMs + spokenCharacters * msPerCharacter));
  }
}

export class HttpTTSProvider implements TTSProvider {
  constructor(
    private readonly endpoint: string,
    private readonly options: { apiKey?: string; voice?: string } = {}
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): HttpTTSProvider | null {
    const endpoint = env.TTS_HTTP_ENDPOINT?.trim();
    if (!endpoint) {
      return null;
    }
    return new HttpTTSProvider(endpoint, {
      apiKey: env.TTS_HTTP_API_KEY,
      voice: env.TTS_HTTP_VOICE
    });
  }

  async synthesize(request: TTSRequest): Promise<TTSResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {})
      },
      body: JSON.stringify({
        text: request.text,
        voice: request.voice ?? this.options.voice
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP TTS request failed with ${response.status} ${response.statusText}.`);
    }

    const durationHeader = response.headers.get("x-audio-duration-ms");
    const durationMs = durationHeader ? Number.parseInt(durationHeader, 10) : new MockTTSProvider().calculateDurationMs(request.text);
    await mkdir(dirname(request.outputPath), { recursive: true });
    await writeFile(request.outputPath, Buffer.from(await response.arrayBuffer()));

    return {
      audioPath: request.outputPath,
      durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : new MockTTSProvider().calculateDurationMs(request.text)
    };
  }
}

export function createTTSProvider(
  providerName: string,
  env: NodeJS.ProcessEnv = process.env
): TTSProvider {
  if (providerName === "mock") {
    return new MockTTSProvider();
  }

  const provider = HttpTTSProvider.fromEnv(env);
  if (!provider) {
    throw new Error(`TTS_PROVIDER=${providerName} requires TTS_HTTP_ENDPOINT to enable the HTTP TTS provider.`);
  }
  return provider;
}

function createSilentWav(durationMs: number): Buffer {
  const sampleRate = 16_000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = Math.ceil(sampleRate * durationMs / 1000);
  const dataSize = sampleCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}
