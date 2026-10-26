"""Sample files for trying the AI Evaluation flow.   python -m scripts.sample_evaluation

Writes to <repo>/.data/sample_evaluation/:
  question_paper.md, model_answers.md   -> upload in step 1 (Questions & answers)
  scripts/<Student_Name>.pdf            -> pick the folder in step 2 (Student scripts)
Scripts are typed PDFs (work offline); real handwritten scans need PROVIDER_MODE=azure|openai.
Names match the demo class Grade-10-A (teacher@demo.edu, subject PHY101).
"""
from pathlib import Path

import pymupdf

from app.config import ROOT

OUT = ROOT / ".data" / "sample_evaluation"

QUESTION_PAPER = """# Physics — Chapter 1: Light (Unit Test)
SL.No 1. State the two laws of reflection of light and draw a labeled ray diagram. (5 marks)
SL.No 2. An object is placed 20 cm in front of a concave mirror of focal length 15 cm. Find the image distance and nature. (5 marks)
SL.No 3. Derive the relation between critical angle and refractive index for total internal reflection. (5 marks)
"""

MODEL_ANSWERS = """Ans 1: 1. Angle of incidence (i) equals angle of reflection (r) (2M). 2. The incident ray, the normal and the reflected ray lie in the same plane (2M). 3. Labeled ray diagram with arrows (1M).
Ans 2: Mirror formula 1/v + 1/u = 1/f (1M). Sign convention u = -20 cm, f = -15 cm (1M). Calculation gives v = -60 cm (2M). Nature of image: real, inverted, magnified (1M).
Ans 3: Snell law at the critical angle n1 sin c = n2 sin 90 (2M). Relation n = 1/sin c (2M). Conditions for total internal reflection: denser to rarer medium and angle greater than critical angle (1M).
"""

SCRIPTS = {
    "Rohan_Student.pdf": [
        "SL.No 1. Angle of incidence (i) equals angle of reflection (r). The incident ray, the normal and the reflected "
        "ray lie in the same plane. Labeled ray diagram with arrows drawn.",
        "SL.No 2. Mirror formula 1/v + 1/u = 1/f. Sign convention u = -20 cm, f = -15 cm. Calculation gives v = -60 cm. "
        "Nature of image: real, inverted, magnified.",
    ],
    "Meera_Student.pdf": [
        "SL.No 1. Angle of incidence equals angle of reflection.",
        "SL.No 2. Mirror formula 1/v + 1/u = 1/f with u = -20 and f = +15.",
    ],
    "10A03_Ishaan_Verma.pdf": ["SL.No 1. Light bounces back from a shiny mirror surface."],
    "Ananya Iyar.pdf": [  # deliberate typo -> fuzzy match to "Ananya Iyer", shown for confirmation
        "SL.No 1. Angle of incidence (i) equals angle of reflection (r). The incident ray, the normal and the reflected "
        "ray lie in the same plane.",
        "SL.No 2. Mirror formula 1/v + 1/u = 1/f, sign convention u = -20 cm, f = -15 cm, v = -60 cm.",
    ],
}


def _pdf(paragraphs: list[str]) -> bytes:
    doc = pymupdf.open()
    for para in paragraphs:
        page = doc.new_page()
        page.insert_textbox(pymupdf.Rect(50, 60, 545, 780), "Answer script\n\n" + para, fontsize=12)
    return doc.tobytes()


def run() -> Path:
    (OUT / "scripts").mkdir(parents=True, exist_ok=True)
    (OUT / "question_paper.md").write_text(QUESTION_PAPER, encoding="utf-8")
    (OUT / "model_answers.md").write_text(MODEL_ANSWERS, encoding="utf-8")
    for name, paras in SCRIPTS.items():
        (OUT / "scripts" / name).write_bytes(_pdf(paras))
    return OUT


if __name__ == "__main__":
    print("Sample evaluation files written to", run())
