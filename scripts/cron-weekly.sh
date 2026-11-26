#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
NODE_VERSION="v24.12.0"
NODE_BIN_DIR="${NODE_BIN_DIR:-${HOME}/.config/nvm/versions/node/${NODE_VERSION}/bin}"
NODE_BIN="${NODE_BIN_DIR}/node"
NPM_BIN="${NODE_BIN_DIR}/npm"
export PATH="${NODE_BIN_DIR}:/usr/bin:/bin"

cd "$PROJECT_DIR"

RUN_DATE="${RUN_DATE:-$(TZ=Asia/Shanghai date +%F)}"
ISO_WEEK="$(date -d "$RUN_DATE" +%G-W%V)"
AUTO_GIT="${AUTO_GIT:-true}"

export MOCK_MODE=false

if [[ ! -x "$NODE_BIN" || ! -x "$NPM_BIN" ]]; then
  echo "Node ${NODE_VERSION} runtime not found under ${NODE_BIN_DIR}." >&2
  exit 1
fi

if ! "$NODE_BIN" -e 'require("better-sqlite3")(":memory:").close()' >/dev/null 2>&1; then
  echo "[$(date '+%F %T %Z')] Rebuilding better-sqlite3 for ${NODE_VERSION}"
  "$NPM_BIN" rebuild better-sqlite3
fi

OUTPUT_ROOT="$("$NODE_BIN" --import tsx src/cli/index.ts output-dir)"
TARGET_FILE="${OUTPUT_ROOT}/weekly/${ISO_WEEK}/weekly.html"
echo "[$(date '+%F %T %Z')] Starting weekly pipeline for ${RUN_DATE} (${ISO_WEEK})"
"$NPM_BIN" run run-weekly -- --date "$RUN_DATE"

if [[ ! -s "$TARGET_FILE" ]]; then
  echo "Expected output not found: $TARGET_FILE" >&2
  exit 1
fi

if [[ "$AUTO_GIT" != "true" ]]; then
  echo "AUTO_GIT=${AUTO_GIT}; skipping git commit and push."
  exit 0
fi

if ! git diff --cached --quiet; then
  echo "Refusing to auto-commit because staged changes already exist." >&2
  exit 1
fi

git add -- "$TARGET_FILE"

if git diff --cached --quiet -- "$TARGET_FILE"; then
  echo "No tracked output changes to commit for ${ISO_WEEK}."
  exit 0
fi

git commit -m "chore: update weekly wechat output for ${ISO_WEEK}"
git push origin HEAD

echo "[$(date '+%F %T %Z')] Finished weekly pipeline for ${RUN_DATE} (${ISO_WEEK})"
