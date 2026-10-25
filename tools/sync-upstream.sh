#!/usr/bin/env bash
# Merge ChatGPT's latest published source into the current branch.
#
# Each upstream archive is recorded as an "upstream snapshot" commit whose tree is
# exactly the archive's contents, parented on the previous snapshot. That gives
# upstream its own line of history, so `git merge` does a real 3-way merge of
# ChatGPT's changes with ours rather than overwriting either side.
set -euo pipefail
URL=${UPSTREAM_ZIP_URL:-https://babylon-workbench-starter.gardengrass19.chatgpt.site/app-source.zip}
cd "$(git rev-parse --show-toplevel)"
[ -z "$(git status --porcelain)" ] || { echo "Working tree not clean; commit or stash first." >&2; exit 1; }

# Snapshot commits must be reachable to find the merge base; deepen shallow clones.
if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
  git fetch -q --depth=1000 origin "$(git branch --show-current)"
fi

TMP=$(mktemp -d)
trap 'git worktree remove --force "$TMP/wt" 2>/dev/null || true; rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/src.zip" "$URL"
mkdir "$TMP/unz" && unzip -q "$TMP/src.zip" -d "$TMP/unz"
# The archive wraps the project in a single top-level folder.
SRC="$TMP/unz"
if [ "$(ls -A "$SRC" | wc -l)" = 1 ] && [ -d "$SRC/$(ls -A "$SRC")" ]; then SRC="$SRC/$(ls -A "$SRC")"; fi
SUM=$(sha256sum "$TMP/src.zip" | cut -c1-12)

PREV=$(git log --format=%H -1 --grep='^upstream snapshot')
[ -n "$PREV" ] || { echo "No upstream snapshot commit found in history." >&2; exit 1; }
if git log -1 --format=%B "$PREV" | grep -q "zip-sha256: $SUM"; then
  echo "Upstream unchanged since $(git log -1 --format='%h %s' "$PREV")."
else
  git worktree add -q --detach "$TMP/wt" "$PREV"
  find "$TMP/wt" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  cp -a "$SRC/." "$TMP/wt/"
  git -C "$TMP/wt" add -A
  if git -C "$TMP/wt" diff --cached --quiet; then
    echo "Upstream archive changed but its contents did not."
  else
    git -C "$TMP/wt" commit -q -m "upstream snapshot $(date -u +%Y-%m-%dT%H:%MZ)" -m "Source: $URL
zip-sha256: $SUM"
    SNAP=$(git -C "$TMP/wt" rev-parse HEAD)
    echo "New upstream snapshot $(git rev-parse --short "$SNAP"):"
    git diff --stat "$PREV" "$SNAP" | tail -1
    git merge --no-ff --no-edit -m "Merge upstream snapshot $SUM" "$SNAP"
  fi
fi
