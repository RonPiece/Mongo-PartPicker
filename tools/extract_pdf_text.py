#!/usr/bin/env python3
"""Extract full readable text from a PDF file, page by page."""

import sys
import importlib

def extract_with_fitz(pdf_path):
    import fitz  # PyMuPDF
    doc = fitz.open(pdf_path)
    for i, page in enumerate(doc, 1):
        text = page.get_text()
        print(f"===== PAGE {i} =====")
        print(text)
    doc.close()

def extract_with_pdfplumber(pdf_path):
    import pdfplumber
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages, 1):
            text = page.extract_text() or ""
            print(f"===== PAGE {i} =====")
            print(text)

def extract_with_pypdf2(pdf_path):
    from PyPDF2 import PdfReader
    reader = PdfReader(pdf_path)
    for i, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ""
        print(f"===== PAGE {i} =====")
        print(text)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract_pdf_text.py <pdf_path>")
        sys.exit(1)

    pdf_path = sys.argv[1]
    extracted = False

    for name, func in [("fitz (PyMuPDF)", extract_with_fitz),
                        ("pdfplumber", extract_with_pdfplumber),
                        ("PyPDF2", extract_with_pypdf2)]:
        try:
            func(pdf_path)
            extracted = True
            break
        except ImportError:
            print(f"[INFO] {name} not available, trying next...", file=sys.stderr)
        except Exception as e:
            print(f"[ERROR] {name} failed: {e}", file=sys.stderr)

    if not extracted:
        print("No PDF library available. Install one: pip install pymupdf pdfplumber PyPDF2", file=sys.stderr)
        sys.exit(1)
