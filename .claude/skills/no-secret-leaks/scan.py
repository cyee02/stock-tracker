#!/usr/bin/env python3
"""Flag code that could print a secret to a terminal, log or CI output.

    python3 scan.py [PATH ...]        # default: the git repo you're in

Scans tracked files (or everything under PATH) for:
  - printing a secret-named variable (echo/printf/print/logger/console.log)
  - dumping the whole environment (env, printenv, os.environ, process.env)
  - shell tracing (set -x, bash -x), which echoes every expanded command
  - commands that print resolved secrets (docker compose config, docker inspect)
  - secrets interpolated straight into GitHub Actions `run:` steps
  - secrets baked into a Docker image (ARG/ENV)
  - tokens in URLs (?token=, ?t=$KEY) that end up in logs and shell history
  - hard-coded credentials with well-known prefixes

Each hit is a lead, not a verdict: read the line and decide. A reviewed line can
be marked with a `secret-ok` comment (with the reason) to silence it.

Matched lines are printed with anything that looks like a credential masked, so
the scanner itself never leaks one. Exit status: 0 clean, 1 findings, 2 error.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

# Names that hold secrets. Deliberately not bare "key"/"auth", which match
# cache_key, sort_key, author, etc.
SECRET_NAME = (
    r"(?:[A-Za-z0-9_]*(?:api_?key|access_?key|admin_?key|auth_?key|private_?key|secret_?key"
    r"|secret|token|passwd|password|passphrase|credential|cookie|session_?id|oauth|bearer"
    r"|dsn|conn(?:ection)?_?str(?:ing)?)[A-Za-z0-9_]*)"
)
# Secret-looking names that aren't secrets.
NOT_SECRET = re.compile(r"^(?:max_?tokens?|tokens?_?(?:count|used|limit|usage)|.*_?token_?(?:url|type|ttl|expir\w*)|csrf_?token_?name)$", re.I)

SHELL_VAR = rf"\$\{{?(?P<var>{SECRET_NAME})\b"

RULES: list[tuple[str, re.Pattern[str], set[str] | None]] = [
    # (message, pattern, file kinds it applies to; None = all)
    ("prints a secret variable",
     re.compile(rf"\b(?:echo|printf|print|tee|logger)\b[^#\n]*{SHELL_VAR}", re.I), {"sh", "yml", "docker", "make"}),
    ("prints a secret variable",
     re.compile(rf"\b(?:print|pprint|logging\.\w+|log(?:ger)?\.\w+|warnings\.warn|click\.echo|typer\.echo|sys\.std(?:out|err)\.write)\s*\([^#\n]*\b(?P<var>{SECRET_NAME})\b", re.I), {"py"}),
    ("puts a secret in an exception message",
     re.compile(rf"\braise\s+\w+\([^#\n]*\{{[^}}]*\b(?P<var>{SECRET_NAME})\b[^}}]*\}}", re.I), {"py"}),
    ("prints a secret variable",
     re.compile(rf"\b(?:console\.\w+|logger\.\w+|log\.\w+|process\.std(?:out|err)\.write)\s*\([^\n]*\b(?P<var>{SECRET_NAME})\b", re.I), {"js"}),
    ("prints a secret variable",
     re.compile(rf"\b(?:fmt\.Print\w*|log\.\w+|println!|eprintln!|print!|System\.out\.\w+|puts|p)\s*[\(\s][^\n]*\b(?P<var>{SECRET_NAME})\b", re.I), {"go", "rs", "java", "rb"}),
    ("dumps the whole environment",
     re.compile(r"(?:^|[;&|`(]\s*|\brun:\s*)(?:env|printenv|export\s+-p|set|declare\s+-p|declare\s+-x)\s*(?:$|[|>;&)#])"), {"sh", "yml", "docker", "make"}),
    ("dumps the whole environment",
     re.compile(r"\b(?:print|pprint|logging\.\w+|log(?:ger)?\.\w+|json\.dumps)\s*\([^#\n]*\b(?:os\.environ|dict\(os\.environ\))\s*[,)]"), {"py"}),
    ("dumps the whole environment",
     re.compile(r"\b(?:console\.\w+|JSON\.stringify)\s*\(\s*process\.env\s*[,)]"), {"js"}),
    ("traces commands (prints expanded secrets)",
     re.compile(r"(?:^|[;&|]\s*)(?:set\s+-[a-wyz]*x|set\s+-o\s+xtrace|(?:ba|z)?sh\s+-[a-z]*x\b)"), {"sh", "yml", "docker", "make"}),
    ("prints resolved secrets",
     re.compile(r"\bdocker[- ]compose\b[^#\n]*\bconfig\b|\bdocker\s+(?:container\s+)?inspect\b(?![^#\n]*(?:-f|--format))"), {"sh", "yml", "make"}),
    ("verbose HTTP client prints auth headers",
     re.compile(r"\bcurl\b[^#\n]*(?:\s-v\b|--verbose|--trace)[^#\n]*(?:Authorization|-u\s|--user)", re.I), {"sh", "yml", "make"}),
    ("interpolates a secret directly into a run step (use env: instead)",
     re.compile(r"\b(?:echo|printf|cat|tee)\b[^#\n]*\$\{\{\s*secrets\."), {"yml"}),
    ("dumps all secrets",
     re.compile(r"toJSON\(\s*secrets\s*\)"), {"yml"}),
    ("enables Actions debug logging",
     re.compile(r"\bACTIONS_(?:STEP|RUNNER)_DEBUG\s*[:=]\s*['\"]?true", re.I), {"yml"}),
    ("bakes a secret into the image (visible in docker history)",
     re.compile(rf"^\s*(?:ARG|ENV)\s+(?P<var>{SECRET_NAME})\b", re.I), {"docker"}),
    ("puts a secret in a URL (logged by servers, proxies and shell history)",
     re.compile(rf"[?&](?:t|token|key|api_?key|access_token|secret)=(?:\$\{{?|\{{\{{?\s*)(?P<var>{SECRET_NAME}|\w+)", re.I), None),
    ("cats a secrets file",
     re.compile(r"\b(?:cat|less|more|head|tail|bat)\s+[^#\n|;]*(?:\.env\b|\.zshrc|\.bashrc|\.bash_profile|\.npmrc|\.pypirc|\.netrc|credentials|id_rsa|id_ed25519|\.pem\b)"), {"sh", "yml", "make"}),
]

# Well-known credential formats. Values are never printed, only where they are.
HARDCODED = re.compile(
    r"(?P<v>sk-ant-[A-Za-z0-9_\-]{20,}|sk-(?:proj-)?[A-Za-z0-9]{32,}|tskey-[A-Za-z0-9\-]{16,}"
    r"|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_\-]{35}"
    r"|xox[baprs]-[A-Za-z0-9\-]{10,}|glpat-[A-Za-z0-9_\-]{20}|-----BEGIN [A-Z ]*PRIVATE KEY-----)"
)
# Masks anything credential-shaped in the output lines.
MASK = re.compile(HARDCODED.pattern + r"|(?P<long>\b[A-Za-z0-9_\-+/]{32,}={0,2})")

SUPPRESS = re.compile(r"secret-ok", re.I)

# Line-comment prefixes per file kind; comments are only checked for hard-coded keys.
COMMENT = {
    "js": ("//", "/*", "*"), "go": ("//", "/*", "*"), "rs": ("//", "/*", "*"),
    "java": ("//", "/*", "*"), "py": ("#",), "rb": ("#",), "sh": ("#",),
    "yml": ("#",), "docker": ("#",), "make": ("#",),
}

EXT_KIND = {
    ".sh": "sh", ".bash": "sh", ".zsh": "sh", ".command": "sh", ".py": "py",
    ".js": "js", ".jsx": "js", ".ts": "js", ".tsx": "js", ".mjs": "js", ".cjs": "js",
    ".yml": "yml", ".yaml": "yml", ".go": "go", ".rs": "rs", ".java": "java", ".kt": "java",
    ".rb": "rb", ".env": "env", ".toml": "cfg", ".ini": "cfg", ".cfg": "cfg", ".json": "cfg",
}
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".tox", ".mypy_cache", ".pytest_cache"}
MAX_BYTES = 1_000_000


def kind_of(path: Path, first_line: str) -> str | None:
    name = path.name
    if name == "Dockerfile" or name.startswith("Dockerfile.") or name.endswith(".dockerfile"):
        return "docker"
    if name in {"Makefile", "makefile", "justfile"}:
        return "make"
    if path.suffix in EXT_KIND:
        return EXT_KIND[path.suffix]
    if first_line.startswith("#!") and re.search(r"\b(?:ba|z|da|k)?sh\b", first_line):
        return "sh"
    if first_line.startswith("#!") and "python" in first_line:
        return "py"
    return None


def list_files(targets: list[str]) -> list[Path]:
    files: list[Path] = []
    for t in targets:
        p = Path(t)
        if p.is_file():
            files.append(p)
            continue
        try:
            out = subprocess.run(["git", "-C", str(p), "ls-files", "-co", "--exclude-standard", "-z"],
                                 capture_output=True, check=True).stdout
            root = Path(subprocess.run(["git", "-C", str(p), "rev-parse", "--show-toplevel"],
                                       capture_output=True, check=True, text=True).stdout.strip())
            prefix = Path(os.path.relpath(p.resolve(), root))
            for rel in out.decode().split("\0"):
                if rel:
                    files.append(p / os.path.relpath(rel, prefix) if str(prefix) != "." else p / rel)
        except (subprocess.CalledProcessError, FileNotFoundError):
            for dirpath, dirnames, filenames in os.walk(p):
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                files.extend(Path(dirpath) / f for f in filenames)
    return files


def mask(line: str) -> str:
    def sub(m: re.Match[str]) -> str:
        s = m.group(0)
        return s[:4] + "…[masked]" if len(s) > 8 else "[masked]"
    return MASK.sub(sub, line.strip())[:200]


def scan(path: Path) -> list[tuple[int, str, str]]:
    try:
        if path.stat().st_size > MAX_BYTES:
            return []
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    lines = text.splitlines()
    kind = kind_of(path, lines[0] if lines else "")
    hits: list[tuple[int, str, str]] = []
    for i, line in enumerate(lines, 1):
        if SUPPRESS.search(line):
            continue
        if HARDCODED.search(line) and not re.search(r"(?:REPLACE|EXAMPLE|xxxx|\.\.\.|…)", line, re.I):
            hits.append((i, "hard-coded credential", mask(line)))
            continue
        if kind is None or kind in {"env", "cfg"}:
            continue
        stripped = line.lstrip()
        if stripped.startswith(COMMENT.get(kind, ("#",))):
            continue
        for msg, pat, kinds in RULES:
            if kinds is not None and kind not in kinds:
                continue
            m = pat.search(line)
            if not m:
                continue
            var = m.groupdict().get("var")
            if var and NOT_SECRET.match(var):
                continue
            hits.append((i, msg + (f" ({var})" if var else ""), mask(line)))
            break
    return hits


def main(argv: list[str]) -> int:
    targets = argv or ["."]
    me = Path(__file__).resolve()
    total = 0
    for path in sorted(set(list_files(targets))):
        if path.resolve() == me:
            continue
        for lineno, msg, snippet in scan(path):
            total += 1
            print(f"{path}:{lineno}: {msg}\n    {snippet}")
    if total:
        print(f"\n{total} possible leak(s). Fix them, or add a `secret-ok: <reason>` comment to a line you've checked.")
        return 1
    print("No secret leaks found.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(2)
