#!/usr/bin/env python3
"""
Extract practical tips from the YouTube VTT transcript and merge into structured_facts.json.

Usage:
    python3 scripts/extract_video_tips.py
"""

import json
import os
import re
import sys
from pathlib import Path

import anthropic
from dotenv import load_dotenv

load_dotenv()

VTT_GLOB = "scripts/*.vtt"
FACTS_PATH = Path("scripts/structured_facts.json")
ROOT = Path(__file__).parent.parent


def parse_vtt(path: Path) -> str:
    """Strip VTT timing/markup and return clean deduplicated transcript text."""
    raw = path.read_text(encoding="utf-8")
    lines = raw.splitlines()

    seen = set()
    clean = []

    for line in lines:
        # Skip header, blank lines, timestamp lines
        if not line.strip():
            continue
        if line.startswith("WEBVTT") or line.startswith("Kind:") or line.startswith("Language:"):
            continue
        if re.match(r"^\d{2}:\d{2}:\d{2}", line):
            continue

        # Strip word-level timestamp tags: <00:00:01.234> and <c>...</c>
        clean_line = re.sub(r"<[^>]+>", "", line).strip()
        if not clean_line:
            continue

        # Deduplicate — VTT repeats accumulating lines
        if clean_line not in seen:
            seen.add(clean_line)
            clean.append(clean_line)

    return " ".join(clean)


def extract_tips(transcript: str, client: anthropic.Anthropic) -> list[dict]:
    """Ask Claude Haiku to pull structured tips out of the transcript."""
    prompt = f"""You are analyzing a YouTube video transcript of an experienced welder demonstrating the Vulcan OmniPro 220 multiprocess welder.

Extract every practical tip, trick, warning, recommended setting, and piece of real-world advice from this transcript. Focus on:
- Specific settings (wire speed, voltage, amperage) recommended for materials/thicknesses
- Setup tips (drive roller tension, gas flow rates, polarity reminders)
- Common mistakes and how to avoid them
- Quality indicators (what good vs bad welds look/sound like)
- Machine-specific quirks or gotchas
- Beginner advice from someone experienced

Return a JSON array of objects. Each object:
{{
  "tip": "concise actionable tip in one sentence",
  "category": one of "settings" | "setup" | "technique" | "troubleshooting" | "safety",
  "process": welding process this applies to, e.g. "MIG" | "flux-cored" | "TIG" | "stick" | "general",
  "detail": "optional extra detail if needed, else null"
}}

Return ONLY valid JSON — no markdown, no explanation.

TRANSCRIPT:
{transcript}"""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text.strip()
    # Strip markdown fences if present
    text = re.sub(r"^```json\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    return json.loads(text)


def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    # Find VTT file
    vtt_files = list(ROOT.glob(VTT_GLOB))
    if not vtt_files:
        print("No .vtt files found in project root. Run yt-dlp first.")
        sys.exit(1)
    vtt_path = vtt_files[0]
    print(f"Parsing: {vtt_path.name}")

    transcript = parse_vtt(vtt_path)
    word_count = len(transcript.split())
    print(f"Transcript: {word_count} words after deduplication")

    client = anthropic.Anthropic(api_key=api_key)
    print("Extracting tips with Claude Haiku...")
    tips = extract_tips(transcript, client)
    print(f"Extracted {len(tips)} tips")

    # Load existing structured_facts.json and merge
    if FACTS_PATH.exists():
        facts = json.loads(FACTS_PATH.read_text())
    else:
        facts = {}

    facts["video_tips"] = tips
    FACTS_PATH.write_text(json.dumps(facts, indent=2))
    print(f"Saved to {FACTS_PATH}")

    # Print summary by category
    by_cat: dict[str, int] = {}
    for t in tips:
        by_cat[t.get("category", "?")] = by_cat.get(t.get("category", "?"), 0) + 1
    for cat, count in sorted(by_cat.items()):
        print(f"  {cat}: {count}")


if __name__ == "__main__":
    main()
