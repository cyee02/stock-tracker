#!/usr/bin/env bash
# PreToolUse/Bash guard: block `gh pr create` until README.md has been brought
# up to date on the branch (see .claude/skills/pr-readme/SKILL.md).
#
# Escape hatch: prefix the command with PR_README_OK=1 when the branch
# genuinely needs no README change.
set -uo pipefail

payload="$(cat)"
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null)"
[ -z "$cmd" ] && exit 0

# Only care about `gh pr create` (allow flags/whitespace between words).
printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)' || exit 0

# Explicit override.
printf '%s' "$cmd" | grep -q 'PR_README_OK=1' && exit 0

cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0

# symbolic-ref, not rev-parse: rev-parse echoes "origin/HEAD" back when unset.
base="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
case "$base" in ""|HEAD) base=master ;; esac

# Prefer the pushed base; fall back to the local branch. If neither exists there
# is nothing to diff against, so stay out of the way.
baseref=""
for candidate in "origin/$base" "$base"; do
  if git rev-parse --verify -q "$candidate" >/dev/null 2>&1; then baseref="$candidate"; break; fi
done
[ -z "$baseref" ] && exit 0

# README touched on the branch, or staged/unstaged right now? Then let it through.
changed="$(git diff --name-only "$baseref...HEAD" 2>/dev/null; git status --porcelain 2>/dev/null | awk '{print $NF}')"
printf '%s\n' "$changed" | grep -qx 'README.md' && exit 0

reason='This branch has no README.md change. Run the pr-readme skill (.claude/skills/pr-readme/SKILL.md) to bring README.md in line with what the branch changed, then create the PR. If the branch genuinely needs no README change, re-run the command with a PR_README_OK=1 prefix.'
jq -n --arg r "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
