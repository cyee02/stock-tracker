---
name: no-secret-leaks
description: Make sure code and commands never print secrets (API keys, tokens, passwords, auth keys) to the terminal, logs, CI output, error messages or HTTP responses. Use whenever writing or reviewing code that reads credentials or environment variables, adds print/echo/logging, writes shell scripts, GitHub Actions workflows, Dockerfiles or compose files; before committing or opening a PR; and whenever the user asks to check for leaked keys. Also governs Claude's own terminal commands when secrets are in the environment (e.g. exported from ~/.zshrc).
---

# No secret leaks

Secrets live in the environment (for example exported from `~/.zshrc`) or a
secret store. Their **values** must never appear in a terminal, a log file, CI
output, an exception, an HTTP response, a URL, or an image layer. Only their
**names** and whether they are set may be shown.

## 1. Your own commands come first

When you run commands in this session, you are a log too: tool output is
stored in the transcript.

- Never `echo $SOME_TOKEN`, `printenv`, `env`, `env | grep KEY`, `set`,
  `export -p`, `cat .env`, `cat ~/.zshrc`, `docker compose config`,
  `docker inspect <container>` (prints its env) or `ps eww`.
- To check a secret is set, print only presence or length:

  ```bash
  for v in TS_AUTHKEY CLAUDE_CODE_OAUTH_TOKEN; do
    if [ -n "${!v:-}" ]; then echo "$v: set"; else echo "$v: MISSING"; fi
  done
  ```

  In zsh, use `${(P)v}` instead of `${!v}`.
- To see which variables a file defines, list names only:
  `grep -oE '^(export )?[A-Z_][A-Z0-9_]*=' ~/.zshrc | sed 's/^export //; s/=$//'`.
- If a secret does get printed, say so to the user straight away and suggest
  rotating it. Don't hide it.

## 2. Run the scanner

```bash
python3 .claude/skills/no-secret-leaks/scan.py            # whole repo (git-tracked + untracked, not ignored)
python3 .claude/skills/no-secret-leaks/scan.py deploy/ x.sh   # specific paths
```

If this skill is installed in `~/.claude/skills/` rather than the project, use
`python3 ~/.claude/skills/no-secret-leaks/scan.py`.

It exits 1 when it finds something and prints `file:line`, the rule, and the
line with anything credential-shaped masked. Treat each hit as a lead: read
the code, then either fix it or, if it is genuinely safe, add a comment with
`secret-ok: <why>` on that line. Never add `secret-ok` just to quieten the
scanner.

The scanner catches patterns, not intent. Always do the manual review below as
well, focusing on the diff (`git diff`, `git diff --staged`).

## 3. Manual review checklist

**Printing and logging**
- No print/echo/log/console call includes a secret's value, including in an
  f-string, `%s`, string concatenation, or a `repr()` of a config object.
- Config objects holding secrets don't log themselves. Python dataclasses use
  `field(repr=False)`. Pydantic uses `SecretStr`. Elsewhere, a custom
  `__repr__`/`toString` masks them.
- Error and validation messages name the variable, not its value:
  `"ADMIN_KEY must be at least 16 characters"`, never `f"bad key {key}"`.
- Exceptions from HTTP clients can contain request headers or URLs with
  tokens. Don't log `exc.request` or full URLs with credentials.
- Startup banners show `TOKEN: set`, not the token.
- No debug endpoints or error pages return settings or the environment.

**Shell scripts**
- No `set -x` / `bash -x` in scripts that handle secrets. It echoes every
  expanded command.
- Secrets go to programs through the environment or stdin, not command-line
  arguments (`ps` shows arguments, and many tools log their argv).
- `curl -v` / `--trace` prints the `Authorization` header. Don't combine them.
- When showing a third-party tool's logs (e.g. `docker compose logs`),
  consider piping them through a redaction filter if that tool might log
  credentials.
- Captured output stays captured: `val=$(cmd)` is fine, and printing `$val`
  is not.

**URLs**
- Tokens in query strings (`?t=…`, `?token=…`) land in server access logs,
  proxy logs, browser history and shell history. Prefer a header. If a
  one-time `?t=` login link is unavoidable, move it out of the URL on first
  use, and don't print it in shared logs.

**CI (GitHub Actions)**
- Pass secrets through `env:`, then reference `"$NAME"` in the script. Never
  put `${{ secrets.X }}` inside an `echo`.
- GitHub masks only values registered as secrets. A value that came from
  elsewhere (a file or shell on a self-hosted runner) needs
  `echo "::add-mask::$value"` before anything could print it. That line is
  the one allowed echo, and the runner hides it; mark it `secret-ok`.
- No `toJSON(secrets)`, no `ACTIONS_STEP_DEBUG`, no `env`/`printenv` steps.

**Containers**
- No secrets in `ARG`/`ENV` in a Dockerfile: they're stored in the image
  history. Inject them at run time (compose `environment:` from the host env,
  or Docker secrets).
- `.env`, `*.env`, key files and `.git` are in `.dockerignore`, so they never
  enter the build context.
- `docker compose config` and `docker inspect` print resolved environment
  values. Don't run them in CI or scripts whose output is kept.

**Files and git**
- `.env`, `*.pem`, `*.key`, credential JSON and local DBs are in `.gitignore`.
- No credentials hard-coded in source, tests, docs or examples. Use obvious
  placeholders such as `tskey-auth-REPLACE_ME`.
- Dotfiles that hold secrets (`~/.zshrc`) should be `chmod 600`. Never commit
  them to a dotfiles repo.

## 4. Report

Tell the user what you checked and what you changed, with `file:line` links.
Name the variables involved, never their values. If you found a secret that
was already printed or committed, say so plainly and recommend rotating it.
