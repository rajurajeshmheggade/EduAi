from app.services.pdf_chunker import Chapter, PageText, chunk_chapter, detect_chapters, get_tokenizer, parse_pdf
from scripts.sample_pdf import build_sample_textbook


def test_chunk_size_and_overlap():
    words = " ".join(f"word{i}" for i in range(2500))
    pages = [PageText(1, words[: len(words) // 2]), PageText(2, words[len(words) // 2 :])]
    chunks = chunk_chapter(pages, Chapter(1, "Long", 1, 2), size=600, overlap=100)

    assert len(chunks) >= 4
    assert all(c.token_count <= 600 for c in chunks)
    assert all(c.token_count == 600 for c in chunks[:-1])
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
    for a, b in zip(chunks, chunks[1:]):
        # The last ~150 chars of a chunk (inside the 100-token overlap region) must open the next chunk.
        assert a.text[-150:] in b.text[:1200]


def test_chunk_page_metadata():
    pages = [PageText(1, "alpha " * 700), PageText(2, "beta " * 700)]
    chunks = chunk_chapter(pages, Chapter(1, "X", 1, 2), size=600, overlap=100)
    assert chunks[0].page_number == 1
    assert chunks[-1].page_number == 2
    assert all(c.metadata["pages"] for c in chunks)


def test_overlap_must_be_smaller_than_size():
    import pytest

    with pytest.raises(ValueError):
        chunk_chapter([PageText(1, "a b c")], Chapter(1, "X", 1, 1), size=100, overlap=100)


def test_sample_pdf_chapter_detection():
    parsed = parse_pdf(build_sample_textbook())
    chapters = detect_chapters(parsed, "Fallback")
    assert [c.number for c in chapters] == [1, 2, 3, 4]
    assert chapters[1].title == "Force and Laws of Motion"
    assert chapters[0].start_page == 2  # page 1 is the title page
    assert chapters[-1].end_page == len(parsed.pages)


def test_no_chapters_falls_back_to_single():
    from app.services.pdf_chunker import ParsedPdf

    parsed = ParsedPdf([PageText(1, "just some text"), PageText(2, "more text")], [], [])
    chapters = detect_chapters(parsed, "My Book")
    assert len(chapters) == 1 and chapters[0].title == "My Book" and chapters[0].end_page == 2
