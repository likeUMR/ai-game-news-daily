import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, rmSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, URL} from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const repo = "git@github.com:likeUMR/ai-game-news-daily.git";
const mirror = join(project, "logs", "publication.git");
const remoteRef = "refs/heads/online";

function git(args, {input, env, allowMissing} = {}) {
  const result = spawnSync("git", args, {
    cwd: project, encoding: "utf8", input, maxBuffer: 8_000_000, timeout: 90_000,
    env: {...process.env, GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=15", ...env}
  });
  if (result.error) throw result.error;
  if (allowMissing && result.status === 1) return null;
  if (result.status !== 0) throw new Error(result.stderr.trim() || "GitHub 版本读取失败");
  return result.stdout;
}

export function hasArticles(html) {
  return /<h3\b[^>]*>\s*[^<\s]/i.test(html || "") && /href=["']https?:\/\/[^"']+["']/i.test(html);
}

function readRemote(path) {
  mkdirSync(dirname(mirror), {recursive: true});
  if (!existsSync(join(mirror, "HEAD"))) git(["init", "--bare", mirror]);
  git(["--git-dir", mirror, "fetch", "--quiet", "--depth=1", "--no-tags", repo, `+refs/heads/main:${remoteRef}`]);
  const sha = git(["--git-dir", mirror, "rev-parse", remoteRef]).trim();
  const blob = git(["--git-dir", mirror, "rev-parse", "--verify", "--quiet", `${sha}:${path}`], {allowMissing: true});
  return {sha, html: blob ? git(["--git-dir", mirror, "cat-file", "blob", blob.trim()]) : ""};
}

function writeRemote(path, html, sha, date) {
  const temporaryIndex = join(mirror, `${randomUUID()}.index`);
  const env = {GIT_INDEX_FILE: temporaryIndex};
  const store = (args, input) => git(["--git-dir", mirror, ...args], {env, input}).trim();
  try {
    store(["read-tree", sha]);
    const blob = store(["hash-object", "-w", "--stdin"], html);
    store(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`]);
    const tree = store(["write-tree"]);
    const commit = store(["commit-tree", tree, "-p", sha, "-m", `发布已核实的新闻 ${date}`]);
    store(["push", repo, `${commit}:refs/heads/main`]);
  } finally {
    rmSync(temporaryIndex, {force: true});
  }
}

export async function repairReport({path, date, inspect, generate, publish}) {
  if (hasArticles((await inspect(path)).html)) return "线上已有正文";
  const html = await generate();
  if (!hasArticles(html)) throw new Error("本次结果缺少正文或来源，保持线上版本");
  const current = await inspect(path);
  if (hasArticles(current.html)) return "已有并行任务发布正文";
  await publish(path, html, current.sha, date);
  return "已补发正文";
}

export function isoWeek(date) {
  const thursday = new Date(`${date}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const first = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const number = Math.ceil(((thursday.getTime() - first) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(number).padStart(2, "0")}`;
}

async function run() {
  const date = new Intl.DateTimeFormat("sv-SE", {timeZone: "Asia/Shanghai"}).format(new Date());
  const reports = [["run-daily", `output/${date}/wechat.html`]];
  if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) {
    reports.push(["run-weekly", `output/weekly/${isoWeek(date)}/weekly.html`]);
  }
  for (const [command, path] of reports) {
    const result = await repairReport({
      path, date, inspect: readRemote, publish: writeRemote,
      generate() {
        const child = spawnSync(process.execPath, ["--import", "tsx", "src/cli/index.ts", command, "--date", date], {
          cwd: project, stdio: "inherit", env: {...process.env, MOCK_MODE: "false", OUTPUT_DIR: "output"}
        });
        if (child.error) throw child.error;
        if (child.status !== 0) throw new Error(`${command} 运行失败`);
        if (command === "run-daily") {
          const run = JSON.parse(readFileSync(join(project, "output", date, "pipeline-run.json"), "utf8"));
          if (!run.selectedItems?.length || !run.selectedItems.every(item => item.isMock === false && /^https?:\/\//i.test(item.sourceUrl))) {
            throw new Error("日报缺少真实采集记录");
          }
        }
        return readFileSync(join(project, path), "utf8");
      }
    });
    console.log(`${date} ${command} ${result}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
