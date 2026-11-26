import { randomUUID } from "node:crypto";
import { writeFile, rename, rm } from "node:fs/promises";

export interface PublicationWindow {
  start: string;
  end: string;
}

export function editionDay(instant: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(instant));
}

export function editionTime(date?: string, now = new Date()): string {
  if (!date) return now.toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const end = new Date(`${date}T23:59:59.999+08:00`);
    if (!Number.isFinite(end.getTime()) || editionDay(end) !== date || date > editionDay(now)) {
      throw new Error(`Invalid or future edition date: ${date}`);
    }
    return new Date(Math.min(end.getTime(), now.getTime())).toISOString();
  }
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime()) || parsed > now) throw new Error(`Invalid or future --date value: ${date}`);
  return parsed.toISOString();
}

export function publicationWindow(asOf: string, hours: number): PublicationWindow {
  return { start: new Date(Date.parse(asOf) - hours * 3_600_000).toISOString(), end: new Date(asOf).toISOString() };
}

export function requireEditionItems(count: number, edition: string): void {
  if (!count) throw new Error(`No verified items for ${edition}. Publication withheld; previous edition retained.`);
}

export async function writeEditionFile(path: string, contents: string): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
