"""scripts.import_nlp_pdfs: downloaded chapter PDFs land next to the matching NLP chapter .txt, by content."""
import zipfile

import pymupdf as fitz

from scripts import import_nlp_pdfs as imp

CIRCUITS = ("current charge voltage resistance conductor ammeter voltmeter circuit series parallel battery "
            "terminal electron potential difference heating filament fuse wattage appliance switch ohmic").split()
LENSES = ("mirror lens convex concave focus refraction reflection image virtual real magnification optical "
          "spectacles retina pupil cornea prism spectrum dispersion rainbow beam").split()
PLANTS = ("photosynthesis chlorophyll stomata xylem phloem transpiration nutrient sunlight glucose starch "
          "leaves roots stems flowers pollination seeds germination fertilizer manure").split()


def _chapter(root, cls, subj, ch, words):
    folder = root / cls / subj / ch
    folder.mkdir(parents=True)
    (folder / f"{ch}.txt").write_text(" ".join(words * 3), encoding="utf-8")
    return folder


def _pdf(path, words, filler="the and with which there their about"):
    doc = fitz.open()
    for i in range(0, len(words), 8):
        page = doc.new_page()
        page.insert_text((72, 72), " ".join(words[i:i + 8]) + " " + filler, fontsize=11)
    page = doc.new_page()
    page.insert_text((72, 72), " ".join(words), fontsize=8)
    doc.save(path)
    doc.close()
    return path


def _root(tmp_path):
    root = tmp_path / "nlp"
    _chapter(root, "X", "General Science", "electricity", CIRCUITS)
    _chapter(root, "X", "General Science", "light", LENSES)
    _chapter(root, "IX", "Science", "plant life", PLANTS)
    _chapter(root, "IX", "General Science", "plant life", PLANTS)  # same chapter filed under two subjects
    return root


def test_places_by_content_and_skips_non_chapters(tmp_path):
    root, dl = _root(tmp_path), tmp_path / "downloads"
    dl.mkdir()
    _pdf(dl / "jesc112.pdf", CIRCUITS)          # class X hint, matches electricity
    _pdf(dl / "some-random-name.pdf", LENSES)   # no hint, still matches by content
    _pdf(dl / "iesc1ps.pdf", PLANTS)            # prelims: never a chapter
    _pdf(dl / "notes.pdf", ("football cricket stadium umpire wicket goalkeeper referee tournament hockey tennis racket "
                            "badminton shuttle volleyball basketball dribble penalty offside trophy medal podium athlete "
                            "sprint marathon").split())
    res = {r.source.name: r for r in imp.run(dl, root=root)}

    assert res["jesc112.pdf"].status == "placed"
    assert (root / "X" / "General Science" / "electricity" / "electricity.pdf").exists()
    assert res["some-random-name.pdf"].status == "placed"
    assert (root / "X" / "General Science" / "light" / "light.pdf").exists()
    assert res["iesc1ps.pdf"].status == "skipped"
    assert res["notes.pdf"].status == "unmatched" and "closest" in res["notes.pdf"].note
    assert not list((root / "IX").rglob("*.pdf"))  # nothing guessed for the skipped/unmatched files
    assert (root / "X" / "General Science" / "electricity" / "electricity.txt").exists()  # text untouched


def test_duplicate_chapters_get_the_pdf_in_both_subjects(tmp_path):
    root, dl = _root(tmp_path), tmp_path / "downloads"
    dl.mkdir()
    _pdf(dl / "iesc105.pdf", PLANTS)
    (r,) = imp.run(dl, root=root)
    assert r.status == "placed" and {c.subject for c in r.chapters} == {"Science", "General Science"}
    assert (root / "IX" / "Science" / "plant life" / "plant life.pdf").exists()
    assert (root / "IX" / "General Science" / "plant life" / "plant life.pdf").exists()


def test_existing_pdf_needs_force_and_dry_run_copies_nothing(tmp_path):
    root, dl = _root(tmp_path), tmp_path / "downloads"
    dl.mkdir()
    _pdf(dl / "jesc112.pdf", CIRCUITS)
    (r,) = imp.run(dl, root=root, dry_run=True)
    assert r.status == "placed" and not list(root.rglob("*.pdf"))

    target = root / "X" / "General Science" / "electricity" / "electricity.pdf"
    target.write_bytes(b"%PDF-older")
    (r,) = imp.run(dl, root=root)
    assert r.status == "exists" and target.read_bytes() == b"%PDF-older"
    (r,) = imp.run(dl, root=root, force=True)
    assert r.status == "placed" and target.read_bytes() != b"%PDF-older"


def test_reads_pdfs_inside_zip_downloads(tmp_path):
    root, dl = _root(tmp_path), tmp_path / "downloads"
    dl.mkdir()
    loose = _pdf(tmp_path / "jesc110.pdf", LENSES)
    with zipfile.ZipFile(dl / "jesc1dd.zip", "w") as z:
        z.write(loose, "jesc1dd/jesc110.pdf")
        z.writestr("../../escape.pdf", b"not a pdf")  # a hostile path is reduced to its file name
    res = imp.run(dl, root=root)
    placed = [r for r in res if r.status == "placed"]
    assert len(placed) == 1 and placed[0].chapters[0].chapter == "light"
    assert not (tmp_path / "escape.pdf").exists()


def test_class_hint_from_ncert_names():
    assert imp.class_hint(type("P", (), {"stem": "jesc112"})()) == ("X", False)
    assert imp.class_hint(type("P", (), {"stem": "lech1an"})()) == ("XII", True)
    assert imp.class_hint(type("P", (), {"stem": "chapter 3"})()) == (None, False)
