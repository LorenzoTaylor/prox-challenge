"""
extract_knowledge.py — Structured Knowledge Extraction
=======================================================
Processes PDFs page-by-page using Claude vision to extract structured facts:
  - Duty cycles
  - Polarity setups
  - Troubleshooting entries
  - Page catalog (for image/surface artifact routing)

Outputs:
  - scripts/knowledge.db       (SQLite — for inspection and querying)
  - scripts/structured_facts.json  (loaded by Rust server at startup)

Uses PyMuPDF (fitz) for rasterization — no poppler required.

Usage:
  pip install pymupdf anthropic python-dotenv tqdm
  python3 scripts/extract_knowledge.py
  python3 scripts/extract_knowledge.py --docs files/owner-manual.pdf
  python3 scripts/extract_knowledge.py --skip-pages  (skip page catalog entries)
"""

import os
import sys
import json
import sqlite3
import base64
import argparse
import time
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

import fitz  # pymupdf
import anthropic
from tqdm import tqdm

# ─── Config ───────────────────────────────────────────────────────────────────

DOCS_DIR       = Path(__file__).parent.parent / "files"
SCRIPTS_DIR    = Path(__file__).parent
DB_PATH        = SCRIPTS_DIR / "knowledge.db"
FACTS_PATH     = SCRIPTS_DIR / "structured_facts.json"

RASTER_DPI     = 150   # lower than process_pdfs — extraction only, not vision context
EXTRACT_MODEL  = "claude-haiku-4-5-20251001"

DEFAULT_DOCS = [
    "owner-manual.pdf",
    "quick-start-guide.pdf",
    "selection-chart.pdf",
]

# ─── Database ──────────────────────────────────────────────────────────────────

def init_db(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS duty_cycle (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            process         TEXT NOT NULL,
            voltage         INTEGER NOT NULL,
            rated_pct       INTEGER,
            rated_amps      INTEGER,
            continuous_pct  INTEGER,
            continuous_amps INTEGER,
            source_page     INTEGER,
            source_doc      TEXT,
            UNIQUE(process, voltage)
        );

        CREATE TABLE IF NOT EXISTS polarity_setup (
            process             TEXT PRIMARY KEY,
            ground_socket       TEXT,
            torch_socket        TEXT,
            wire_feed_socket    TEXT,
            gas_type            TEXT,
            polarity_type       TEXT,
            source_page         INTEGER,
            source_doc          TEXT
        );

        CREATE TABLE IF NOT EXISTS troubleshooting (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            symptom     TEXT NOT NULL,
            process     TEXT,
            causes_json TEXT,
            solutions_json TEXT,
            source_page INTEGER,
            source_doc  TEXT
        );

        CREATE TABLE IF NOT EXISTS pages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_name    TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            page_type   TEXT,
            summary     TEXT,
            tags_json   TEXT,
            UNIQUE(doc_name, page_number)
        );
    """)
    conn.commit()
    return conn


# ─── Extraction prompt ─────────────────────────────────────────────────────────

EXTRACT_PROMPT = """Analyze this page from the Vulcan OmniPro 220 welder manual. Return ONLY a JSON object, no other text.

{
  "page_type": "<cover|safety|specifications|controls|setup|operation|welding_tips|troubleshooting|maintenance|parts_diagram|other>",
  "summary": "<one sentence describing what this page contains>",
  "tags": ["<keyword>"],
  "duty_cycles": [
    {"process": "<MIG|TIG|Stick|Flux-Cored>", "voltage": <120|240>, "rated_pct": <int>, "rated_amps": <int>, "continuous_pct": <int>, "continuous_amps": <int>}
  ],
  "polarity_setups": [
    {"process": "<MIG|TIG|Stick|Flux-Cored>", "ground_socket": "<positive(+)|negative(-)>", "torch_socket": "<positive(+)|negative(-)>", "wire_feed_socket": "<positive(+)|negative(-)|N/A>", "gas_type": "<75/25 Argon/CO2|100% CO2|100% Argon|N/A>", "polarity_type": "<DCEP|DCEN|AC>"}
  ],
  "troubleshooting_entries": [
    {"symptom": "<text>", "process": "<process or empty>", "causes": ["<cause>"], "solutions": ["<solution>"]}
  ]
}

Rules:
- Only include duty_cycles if numeric values are clearly visible on this page
- Only include polarity_setups if this page explicitly shows cable connections
- Only include troubleshooting_entries if this page has a troubleshooting table or list
- Use [] for empty arrays
- Be precise on polarity: positive(+) or negative(-) exactly"""


# ─── Rasterize one page ────────────────────────────────────────────────────────

def rasterize_page(pdf_path: Path, page_index: int, dpi: int = RASTER_DPI) -> bytes:
    doc = fitz.open(pdf_path)
    page = doc[page_index]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    png_bytes = pix.tobytes("png")
    doc.close()
    return png_bytes


# ─── Extract one page ──────────────────────────────────────────────────────────

def extract_page(client: anthropic.Anthropic, png_bytes: bytes, doc_name: str, page_num: int) -> dict:
    b64 = base64.standard_b64encode(png_bytes).decode("utf-8")

    for attempt in range(3):
        try:
            response = client.messages.create(
                model=EXTRACT_MODEL,
                max_tokens=2048,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                        {"type": "text", "text": EXTRACT_PROMPT},
                    ],
                }],
            )
            raw = response.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
                raw = raw.strip().rstrip("```").strip()
            return json.loads(raw)
        except json.JSONDecodeError as e:
            print(f"    [WARN] JSON parse error on {doc_name} p{page_num} attempt {attempt+1}: {e}")
            if attempt == 2:
                return {"page_type": "other", "summary": f"Parse error p{page_num}", "tags": [],
                        "duty_cycles": [], "polarity_setups": [], "troubleshooting_entries": []}
        except Exception as e:
            print(f"    [WARN] API error on {doc_name} p{page_num} attempt {attempt+1}: {e}")
            time.sleep(2 ** attempt)

    return {"page_type": "other", "summary": "", "tags": [],
            "duty_cycles": [], "polarity_setups": [], "troubleshooting_entries": []}


# ─── Write to DB ───────────────────────────────────────────────────────────────

def write_to_db(conn: sqlite3.Connection, doc_name: str, page_num: int, result: dict):
    conn.execute("""
        INSERT OR REPLACE INTO pages (doc_name, page_number, page_type, summary, tags_json)
        VALUES (?, ?, ?, ?, ?)
    """, (doc_name, page_num, result.get("page_type", "other"),
          result.get("summary", ""), json.dumps(result.get("tags", []))))

    for dc in result.get("duty_cycles", []):
        if dc.get("process") and dc.get("voltage"):
            conn.execute("""
                INSERT OR REPLACE INTO duty_cycle
                (process, voltage, rated_pct, rated_amps, continuous_pct, continuous_amps, source_page, source_doc)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (dc["process"], dc["voltage"], dc.get("rated_pct"), dc.get("rated_amps"),
                  dc.get("continuous_pct"), dc.get("continuous_amps"), page_num, doc_name))

    for ps in result.get("polarity_setups", []):
        if ps.get("process"):
            conn.execute("""
                INSERT OR REPLACE INTO polarity_setup
                (process, ground_socket, torch_socket, wire_feed_socket, gas_type, polarity_type, source_page, source_doc)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (ps["process"], ps.get("ground_socket"), ps.get("torch_socket"),
                  ps.get("wire_feed_socket"), ps.get("gas_type"), ps.get("polarity_type"),
                  page_num, doc_name))

    for te in result.get("troubleshooting_entries", []):
        if te.get("symptom"):
            conn.execute("""
                INSERT INTO troubleshooting (symptom, process, causes_json, solutions_json, source_page, source_doc)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (te["symptom"], te.get("process", ""),
                  json.dumps(te.get("causes", [])), json.dumps(te.get("solutions", [])),
                  page_num, doc_name))

    conn.commit()


# ─── Export structured_facts.json ─────────────────────────────────────────────

def export_facts(conn: sqlite3.Connection, output_path: Path):
    duty_cycles = [dict(row) for row in conn.execute(
        "SELECT process, voltage, rated_pct, rated_amps, continuous_pct, continuous_amps, source_page, source_doc FROM duty_cycle ORDER BY process, voltage"
    ).fetchall()]

    polarity_setups = [dict(row) for row in conn.execute(
        "SELECT process, ground_socket, torch_socket, wire_feed_socket, gas_type, polarity_type, source_page, source_doc FROM polarity_setup ORDER BY process"
    ).fetchall()]

    troubleshooting = []
    for row in conn.execute("SELECT symptom, process, causes_json, solutions_json, source_page, source_doc FROM troubleshooting ORDER BY source_doc, source_page").fetchall():
        entry = dict(row)
        entry["causes"] = json.loads(entry.pop("causes_json") or "[]")
        entry["solutions"] = json.loads(entry.pop("solutions_json") or "[]")
        troubleshooting.append(entry)

    page_catalog = []
    for row in conn.execute("SELECT doc_name, page_number, summary, tags_json FROM pages WHERE page_type != 'other' ORDER BY doc_name, page_number").fetchall():
        page_catalog.append({
            "doc": row["doc_name"],
            "page": row["page_number"],
            "summary": row["summary"],
            "tags": json.loads(row["tags_json"] or "[]"),
        })

    facts = {
        "duty_cycles": duty_cycles,
        "polarity_setups": polarity_setups,
        "troubleshooting": troubleshooting,
        "page_catalog": page_catalog,
    }

    with open(output_path, "w") as f:
        json.dump(facts, f, indent=2)

    print(f"\nExported to {output_path}")
    print(f"  duty_cycles:    {len(duty_cycles)}")
    print(f"  polarity_setups:{len(polarity_setups)}")
    print(f"  troubleshooting:{len(troubleshooting)}")
    print(f"  page_catalog:   {len(page_catalog)}")


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Extract structured knowledge from Vulcan OmniPro 220 manuals")
    parser.add_argument("--docs", nargs="+", help="Specific PDF paths to process")
    parser.add_argument("--skip-pages", action="store_true", help="Don't add entries to page catalog")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    if args.docs:
        doc_paths = [Path(p) for p in args.docs]
    else:
        doc_paths = [DOCS_DIR / name for name in DEFAULT_DOCS]

    doc_paths = [p for p in doc_paths if p.exists()]
    if not doc_paths:
        print(f"No PDFs found. Put them in {DOCS_DIR}/ or pass --docs")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    conn = init_db(DB_PATH)

    total_pages = 0

    for pdf_path in doc_paths:
        doc_name = pdf_path.stem
        print(f"\nProcessing: {pdf_path.name}")

        doc = fitz.open(pdf_path)
        page_count = len(doc)
        doc.close()

        for i in tqdm(range(page_count), desc=f"  {doc_name}", unit="page"):
            page_num = i + 1
            png_bytes = rasterize_page(pdf_path, i)
            result = extract_page(client, png_bytes, doc_name, page_num)

            if not args.skip_pages:
                write_to_db(conn, doc_name, page_num, result)
            else:
                # Still write structured facts, just skip page catalog
                result_no_pages = {**result}
                write_to_db(conn, doc_name, page_num, result_no_pages)

            total_pages += 1
            time.sleep(0.3)  # gentle rate limiting

    print(f"\nProcessed {total_pages} pages across {len(doc_paths)} documents")
    export_facts(conn, FACTS_PATH)
    conn.close()


if __name__ == "__main__":
    main()
