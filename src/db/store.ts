import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class JsonStore<T> {
  constructor(private readonly filePath: string) {}

  async read(fallback: T): Promise<T> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return JSON.parse(content) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return fallback;
      }
      throw error;
    }
  }

  async write(value: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}
