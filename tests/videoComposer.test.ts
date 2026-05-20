import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { TimelineEvent } from "../src/pipeline/types.js";
import type { VideoFrame } from "../src/video/frameRenderer.js";
import {
  AutoFallbackVideoComposer,
  buildFfmpegCommand,
  createVideoComposer,
  FfmpegVideoComposer,
  MockVideoComposer
} from "../src/video/videoComposer.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("VideoComposer", () => {
  test("selects ffmpeg when forced and mock when ffmpeg is unavailable", async () => {
    const ffmpeg = await createVideoComposer({ force: "ffmpeg", ffmpegPath: "ffmpeg-test" });
    const mock = await createVideoComposer({ force: "mock" });
    const automatic = await createVideoComposer({ ffmpegPath: "definitely-missing-ffmpeg-for-test" });

    expect(ffmpeg).toBeInstanceOf(FfmpegVideoComposer);
    expect(mock).toBeInstanceOf(MockVideoComposer);
    expect(automatic).toBeInstanceOf(MockVideoComposer);
  });

  test("constructs an ffmpeg command that joins frames, audio, and burns subtitles", () => {
    const command = buildFfmpegCommand({
      ffmpegPath: "ffmpeg-bin",
      frameListPath: "work/frames.concat.txt",
      audioListPath: "work/audio.concat.txt",
      subtitlePath: "C:/news output/subtitles.srt",
      outputPath: "output/2026-05-19/daily.mp4"
    });

    expect(command).toEqual([
      "ffmpeg-bin",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "work/frames.concat.txt",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "work/audio.concat.txt",
      "-vf",
      "subtitles=C\\:/news output/subtitles.srt",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      "output/2026-05-19/daily.mp4"
    ]);
  });

  test("writes deterministic mock video artifact, sidecar subtitles, and audit note", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "news-video-mock-"));
    const input = await createCompositionInput(tempDir);
    const result = await new MockVideoComposer("ffmpeg unavailable in test").compose(input);

    expect(result.mode).toBe("mock");
    expect(result.videoPath).toBe(join(tempDir, "2026-05-19", "daily.mp4"));
    expect(existsSync(result.videoPath)).toBe(true);
    expect(existsSync(result.subtitlePath)).toBe(true);
    expect(existsSync(result.auditPath)).toBe(true);

    const artifact = JSON.parse(await readFile(result.videoPath, "utf8")) as { note: string; frameCount: number; missingFrames: string[] };
    const subtitles = await readFile(result.subtitlePath, "utf8");
    const audit = await readFile(result.auditPath, "utf8");

    expect(artifact.note).toBe("ffmpeg unavailable in test");
    expect(artifact.frameCount).toBe(2);
    expect(artifact.missingFrames).toEqual([]);
    expect(subtitles).toContain("00:00:00,000 --> 00:00:01,000");
    expect(audit).toContain("ffmpeg unavailable in test");
  });

  test("falls back to a deterministic artifact when automatic ffmpeg composition fails", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "news-video-auto-fallback-"));
    const input = await createCompositionInput(tempDir);
    const composer = new AutoFallbackVideoComposer({
      async compose() {
        throw new Error("ffmpeg exited with code 4294967274");
      }
    });

    const result = await composer.compose(input);

    expect(result.mode).toBe("mock");
    expect(result.note).toContain("ffmpeg composition failed");
    expect(existsSync(result.videoPath)).toBe(true);
  });

  test("fails ffmpeg composition with a clear missing-frame error", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "news-video-missing-frame-"));
    const input = await createCompositionInput(tempDir);
    input.frames[0]!.pngPath = join(tempDir, "missing.png");
    const composer = new FfmpegVideoComposer("ffmpeg-test", {
      async run() {
        throw new Error("executor should not run with missing frames");
      }
    });

    await expect(composer.compose(input)).rejects.toThrow(/frame file\(s\) are missing/);
  });

  test("writes concat manifests and invokes ffmpeg executor", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "news-video-ffmpeg-"));
    const input = await createCompositionInput(tempDir);
    const calls: Array<{ command: string; args: string[] }> = [];
    const composer = new FfmpegVideoComposer("ffmpeg-test", {
      async run(command, args) {
        calls.push({ command, args });
      }
    });

    const result = await composer.compose(input);

    expect(result.mode).toBe("ffmpeg");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("ffmpeg-test");
    expect(calls[0]?.args).toContain("-vf");
    expect(result.frameListPath && existsSync(result.frameListPath)).toBe(true);
    expect(result.audioListPath && existsSync(result.audioListPath)).toBe(true);
    expect(await readFile(result.frameListPath!, "utf8")).toContain("duration 1.000");
    expect(await readFile(result.audioListPath!, "utf8")).toContain("audio-1.wav");
  });
});

async function createCompositionInput(root: string) {
  const dateDir = join(root, "2026-05-19");
  const frameDir = join(dateDir, "frames", "png");
  const audioDir = join(dateDir, "audio");
  const subtitlePath = join(dateDir, "subtitles.srt");
  await mkdir(frameDir, { recursive: true });
  await mkdir(audioDir, { recursive: true });

  const frameOne = join(frameDir, "0001-title.png");
  const frameTwo = join(frameDir, "0002-news.png");
  const audioOne = join(audioDir, "audio-1.wav");
  const audioTwo = join(audioDir, "audio-2.wav");
  await writeFile(frameOne, "frame-one", "utf8");
  await writeFile(frameTwo, "frame-two", "utf8");
  await writeFile(audioOne, "audio-one", "utf8");
  await writeFile(audioTwo, "audio-two", "utf8");

  const frames: VideoFrame[] = [
    { id: "0001-title", kind: "title", title: "Title", html: "", pngPath: frameOne, metadata: {} },
    { id: "0002-news", kind: "news", title: "News", html: "", pngPath: frameTwo, metadata: {} }
  ];
  const timeline: TimelineEvent[] = [
    { itemId: "show", ttsSegmentId: "tts-001", startMs: 0, endMs: 1000, title: "Intro", audioPath: audioOne, text: "Intro" },
    { itemId: "item-1", ttsSegmentId: "tts-002", startMs: 1000, endMs: 2000, title: "News", audioPath: audioTwo, text: "News" }
  ];

  return {
    generatedAt: "2026-05-19T08:00:00.000Z",
    outputRoot: root,
    frames,
    timeline,
    subtitleSrt: "1\n00:00:00,000 --> 00:00:01,000\nIntro\n",
    subtitlePath
  };
}
