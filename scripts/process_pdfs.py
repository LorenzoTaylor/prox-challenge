"""
Convert PDF pages to high-res PNGs for use as vision context.
Run once before starting the server.

Requirements: pip install pymupdf
(No poppler required — uses PyMuPDF/fitz directly)

Output: scripts/pages/<filename>/<page_N>.png
        scripts/page_index.json
"""

import json
from pathlib import Path
import fitz  # pymupdf

FILES_DIR = Path(__file__).parent.parent / "files"
OUTPUT_DIR = Path(__file__).parent / "pages"
INDEX_PATH = Path(__file__).parent / "page_index.json"

DPI = 100  # ~850x1100px for letter — well under Anthropic's 2000px many-image limit


def process_pdfs():
    OUTPUT_DIR.mkdir(exist_ok=True)
    index = {}

    for pdf_path in FILES_DIR.glob("*.pdf"):
        name = pdf_path.stem
        out_dir = OUTPUT_DIR / name
        out_dir.mkdir(exist_ok=True)

        print(f"Processing {pdf_path.name}...")
        doc = fitz.open(pdf_path)
        mat = fitz.Matrix(DPI / 72, DPI / 72)

        index[name] = {
            "file": pdf_path.name,
            "page_count": len(doc),
            "pages": []
        }

        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
            page_path = out_dir / f"page_{i + 1:03d}.png"
            pix.save(str(page_path))
            index[name]["pages"].append({
                "page": i + 1,
                "path": str(page_path.relative_to(Path(__file__).parent.parent))
            })

        doc.close()
        print(f"  {index[name]['page_count']} pages saved to {out_dir}")

    with open(INDEX_PATH, "w") as f:
        json.dump(index, f, indent=2)

    print(f"\nIndex written to {INDEX_PATH}")
    print(f"Total files: {len(index)}")


if __name__ == "__main__":
    process_pdfs()
