import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import type { TimelineEvent } from "../pipeline/types.js";
import type { VideoFrame } from "./frameRenderer.js";

export interface VideoCompositionInput {
  generatedAt: string;
  outputRoot: string;
  frames: VideoFrame[];
  timeline: TimelineEvent[];
  subtitleSrt: string;
  subtitlePath: string;
}

export interface VideoCompositionResult {
  mode: "ffmpeg" | "mock";
  videoPath: string;
  subtitlePath: string;
  auditPath: string;
  frameListPath?: string;
  audioListPath?: string;
  command?: string[];
  note?: string;
  missingFrames?: string[];
}

export interface VideoComposer {
  compose(input: VideoCompositionInput): Promise<VideoCompositionResult>;
}

export interface CommandExecutor {
  run(command: string, args: string[]): Promise<void>;
}

const defaultExecutor: CommandExecutor = {
  run: runCommand
};

export async function createVideoComposer(options: {
  ffmpegPath?: string;
  executor?: CommandExecutor;
  force?: "auto" | "ffmpeg" | "mock";
} = {}): Promise<VideoComposer> {
  const ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const envMode = process.env.VIDEO_COMPOSER_MODE;
  const force = options.force ?? (envMode === "ffmpeg" || envMode === "mock" ? envMode : "auto");

  if (force === "mock") {
    return new MockVideoComposer("ffmpeg disabled by composer selection");
  }

  const ffmpegComposer = new FfmpegVideoComposer(ffmpegPath, options.executor ?? defaultExecutor);
  if (force === "ffmpeg") {
    return ffmpegComposer;
  }

  if (await isFfmpegAvailable(ffmpegPath)) {
    return new AutoFallbackVideoComposer(ffmpegComposer);
  }

  return new MockVideoComposer("ffmpeg executable was not found; wrote deterministic mock video artifact instead");
}

export async function isFfmpegAvailable(ffmpegPath = "ffmpeg"): Promise<boolean> {
  try {
    await runCommand(ffmpegPath, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

export class FfmpegVideoComposer implements VideoComposer {
  constructor(
    private readonly ffmpegPath = "ffmpeg",
    private readonly executor: CommandExecutor = defaultExecutor
  ) {}

  async compose(input: VideoCompositionInput): Promise<VideoCompositionResult> {
    const paths = compositionPaths(input.generatedAt, input.outputRoot);
    await mkdir(paths.workDir, { recursive: true });
    await validateFrameFiles(input.frames);

    const frameListPath = join(paths.workDir, "frames.concat.txt");
    const audioListPath = join(paths.workDir, "audio.concat.txt");
    await writeFile(frameListPath, renderFrameConcat(input.frames, totalDurationMs(input.timeline)), "utf8");
    await writeFile(audioListPath, renderAudioConcat(input.timeline), "utf8");

    const command = buildFfmpegCommand({
      ffmpegPath: this.ffmpegPath,
      frameListPath,
      audioListPath,
      subtitlePath: input.subtitlePath,
      outputPath: paths.videoPath
    });

    await this.executor.run(command[0]!, command.slice(1));

    const audit = {
      mode: "ffmpeg",
      videoPath: paths.videoPath,
      subtitlePath: input.subtitlePath,
      frameCount: input.frames.length,
      audioSegments: audioPaths(input.timeline).length,
      command,
      note: "Composed video with ffmpeg and burned subtitles into the video."
    };
    await writeFile(paths.auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

    return {
      mode: "ffmpeg",
      videoPath: paths.videoPath,
      subtitlePath: input.subtitlePath,
      auditPath: paths.auditPath,
      frameListPath,
      audioListPath,
      command
    };
  }
}

export class MockVideoComposer implements VideoComposer {
  constructor(private readonly note = "mock video composer selected") {}

  async compose(input: VideoCompositionInput): Promise<VideoCompositionResult> {
    const paths = compositionPaths(input.generatedAt, input.outputRoot);
    await mkdir(paths.workDir, { recursive: true });
    const missingFrames = await findMissingFrames(input.frames);
    const payload = {
      artifact: "mock-daily-video",
      mode: "mock",
      generatedAt: input.generatedAt,
      note: this.note,
      videoPath: paths.videoPath,
      subtitlePath: input.subtitlePath,
      frameCount: input.frames.length,
      missingFrames,
      timeline: input.timeline.map((event) => ({
        itemId: event.itemId,
        ttsSegmentId: event.ttsSegmentId,
        startMs: event.startMs,
        endMs: event.endMs,
        title: event.title,
        audioPath: event.audioPath
      }))
    };

    await writeFile(paths.videoPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await writeFile(input.subtitlePath, input.subtitleSrt, "utf8");
    await writeFile(paths.auditPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    return {
      mode: "mock",
      videoPath: paths.videoPath,
      subtitlePath: input.subtitlePath,
      auditPath: paths.auditPath,
      note: this.note,
      missingFrames
    };
  }
}

export class AutoFallbackVideoComposer implements VideoComposer {
  constructor(private readonly primary: VideoComposer) {}

  async compose(input: VideoCompositionInput): Promise<VideoCompositionResult> {
    try {
      return await this.primary.compose(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new MockVideoComposer(`ffmpeg composition failed: ${message}; wrote deterministic fallback video artifact instead`).compose(input);
    }
  }
}

export function buildFfmpegCommand(input: {
  ffmpegPath?: string;
  frameListPath: string;
  audioListPath: string;
  subtitlePath: string;
  outputPath: string;
}): string[] {
  return [
    input.ffmpegPath ?? "ffmpeg",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    input.frameListPath,
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    input.audioListPath,
    "-vf",
    `subtitles=${escapeSubtitleFilterPath(input.subtitlePath)}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    input.outputPath
  ];
}

function compositionPaths(generatedAt: string, outputRoot: string): { workDir: string; videoPath: string; auditPath: string } {
  const workDir = join(outputRoot, generatedAt.slice(0, 10));
  return {
    workDir,
    videoPath: join(workDir, "daily.mp4"),
    auditPath: join(workDir, "video-composition-audit.json")
  };
}

async function validateFrameFiles(frames: VideoFrame[]): Promise<void> {
  const missingFrames = await findMissingFrames(frames);
  if (missingFrames.length > 0) {
    throw new Error(`Cannot compose video because ${missingFrames.length} frame file(s) are missing: ${missingFrames.join(", ")}`);
  }
}

async function findMissingFrames(frames: VideoFrame[]): Promise<string[]> {
  const missing: string[] = [];
  for (const frame of frames) {
    if (!frame.pngPath) {
      missing.push(frame.id);
      continue;
    }

    try {
      await access(frame.pngPath, constants.R_OK);
    } catch {
      missing.push(frame.pngPath);
    }
  }
  return missing;
}

function renderFrameConcat(frames: VideoFrame[], durationMs: number): string {
  const durationSeconds = Math.max(0.1, durationMs / Math.max(frames.length, 1) / 1000);
  const lines: string[] = [];
  for (const frame of frames) {
    if (!frame.pngPath) {
      continue;
    }
    lines.push(`file '${escapeConcatPath(frame.pngPath)}'`);
    lines.push(`duration ${durationSeconds.toFixed(3)}`);
  }
  const lastFrame = frames.at(-1)?.pngPath;
  if (lastFrame) {
    lines.push(`file '${escapeConcatPath(lastFrame)}'`);
  }
  return `${lines.join("\n")}\n`;
}

function renderAudioConcat(timeline: TimelineEvent[]): string {
  const lines = audioPaths(timeline).map((audioPath) => `file '${escapeConcatPath(audioPath)}'`);
  return `${lines.join("\n")}\n`;
}

function audioPaths(timeline: TimelineEvent[]): string[] {
  return [...new Set(timeline.map((event) => event.audioPath).filter((value): value is string => Boolean(value)))];
}

function totalDurationMs(timeline: TimelineEvent[]): number {
  return Math.max(1, timeline.at(-1)?.endMs ?? 1);
}

function escapeConcatPath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/'/gu, "'\\''");
}

function escapeSubtitleFilterPath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/:/gu, "\\:").replace(/'/gu, "\\'");
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await mkdir(dirname(args.at(-1) ?? "."), { recursive: true }).catch(() => undefined);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
      }
    });
  });
}
