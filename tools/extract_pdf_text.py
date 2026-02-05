from __future__ import annotations

from pathlib import Path

from pypdf import PdfReader


def extract_text(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    parts: list[str] = []
    for i, page in enumerate(reader.pages):
        try:
            txt = page.extract_text() or ""
        except Exception as e:  # noqa: BLE001
            txt = f"\n[ERROR extracting page {i+1}: {e}]\n"
        parts.append(f"\n===== PAGE {i+1} =====\n")
        parts.append(txt)
    return "\n".join(parts).strip() + "\n"


def main() -> None:
    pdf = Path(r"C:\Users\user\Downloads\פרויקטון מסכם במונגו.pdf")
    if not pdf.exists():
        raise SystemExit(f"PDF not found: {pdf}")

    out = Path(__file__).resolve().parents[1] / "requirements_from_pdf.txt"
    text = extract_text(pdf)

    # Normalize common PDF quirks a bit
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    out.write_text(text, encoding="utf-8")
    print(f"Wrote: {out}")
    print(f"Pages: {text.count('===== PAGE ')}")


if __name__ == "__main__":
    main()
