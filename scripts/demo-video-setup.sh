#!/usr/bin/env bash
# Idempotent setup for shot-scraper demo recordings (see .claude/skills/demo-video).
#
# 1. Installs shot-scraper (+ Python Playwright) via pip if missing.
# 2. Ensures the chromium build Python Playwright expects is present:
#    - normal envs: `shot-scraper install` downloads it
#    - egress-blocked envs (Claude Code web harness): the download host is blocked
#      but /opt/pw-browsers already carries a chromium — symlink-shim the expected
#      build dirs onto the pre-installed binaries instead.
# 3. Probes a real launch + the screencast API so failures surface here, not
#    mid-recording.
#
# Usage: bash scripts/demo-video-setup.sh
set -euo pipefail

if ! command -v shot-scraper >/dev/null 2>&1; then
  echo "Installing shot-scraper…" >&2
  pip install --quiet shot-scraper
fi

python3 - <<'PY'
import os
import pathlib
import subprocess
import sys

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    expected = pathlib.Path(p.chromium.executable_path)


def newest_build(root: pathlib.Path, prefix: str) -> pathlib.Path | None:
    builds = [d for d in root.glob(f"{prefix}-*") if d.is_dir()]
    return max(builds, key=lambda d: d.name) if builds else None


def find_binary(build_dir: pathlib.Path, names: list[str]) -> pathlib.Path | None:
    for name in names:
        for hit in build_dir.rglob(name):
            if hit.is_file() and os.access(hit, os.X_OK):
                return hit
    return None


def shim(target: pathlib.Path, source: pathlib.Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink() or target.exists():
        target.unlink()
    target.symlink_to(source)
    print(f"shimmed {target} -> {source}", file=sys.stderr)


if not expected.exists():
    # Normal route first — works wherever the Playwright download host is reachable.
    if subprocess.run(["shot-scraper", "install"], capture_output=True).returncode != 0:
        # Egress-blocked: shim the expected build dirs onto whatever build is installed.
        root = expected.parents[2]  # <browsers root>/chromium-<rev>/<platform>/chrome
        rev = expected.parents[1].name.rsplit("-", 1)[-1]
        wanted = [
            (expected, "chromium", ["chrome", "Chromium"]),
            (
                root
                / f"chromium_headless_shell-{rev}"
                / "chrome-headless-shell-linux64"
                / "chrome-headless-shell",
                "chromium_headless_shell",
                ["chrome-headless-shell", "headless_shell"],
            ),
        ]
        for target, prefix, names in wanted:
            build = newest_build(root, prefix)
            source = find_binary(build, names) if build else None
            if source is None:
                sys.exit(
                    f"No pre-installed {prefix} found under {root} and the download "
                    "host is unreachable — cannot set up shot-scraper here."
                )
            shim(target, source)

# Probe: launch + screencast (the API `shot-scraper video` records with).
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("about:blank")
    if not hasattr(page, "screencast"):
        sys.exit("Playwright is too old for `shot-scraper video` (needs >=1.61).")
    browser.close()

print(f"demo-video setup OK — chromium: {expected}")
PY

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "note: no system ffmpeg — WebM output works, but --mp4 conversion won't." >&2
  echo "      (Playwright's bundled ffmpeg lacks libx264, so it can't substitute.)" >&2
fi
