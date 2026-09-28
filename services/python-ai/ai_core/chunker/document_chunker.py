from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


@dataclass(frozen=True)
class _Token:
    text: str
    bbox: tuple[float, float, float, float] | None = None
    confidence: float | None = None
    source_index: int | None = None


class DocumentChunker:
    """
    Chunker for the output of this project's DocumentParser.

    Supported parser results:
      - PDF:  {"type": "pdf", "pages": [...]} 
      - DOCX: {"type": "docx", "blocks": [...], "tables": [...]} 
      - XML:  {"type": "xml", "data": {...}}

    The chunker does NOT call an LLM and does NOT require extra libraries.
    Its job is to split parser output into small, traceable text fragments while
    preserving source metadata (page/block/table path, bbox, OCR confidence).
    """

    def __init__(
        self,
        max_words: int = 120,
        overlap_words: int = 20,
        min_words: int = 8,
        min_ocr_confidence: float = 0.0,
        line_tolerance: float = 0.012,
    ) -> None:
        if max_words <= 0:
            raise ValueError("max_words must be > 0")
        if overlap_words < 0:
            raise ValueError("overlap_words must be >= 0")
        if overlap_words >= max_words:
            raise ValueError("overlap_words must be smaller than max_words")
        if min_words <= 0:
            raise ValueError("min_words must be > 0")
        if not 0.0 <= min_ocr_confidence <= 1.0:
            raise ValueError("min_ocr_confidence must be in [0, 1]")
        if line_tolerance <= 0:
            raise ValueError("line_tolerance must be > 0")

        self.max_words = max_words
        self.overlap_words = overlap_words
        self.min_words = min_words
        self.min_ocr_confidence = min_ocr_confidence
        self.line_tolerance = line_tolerance

    def chunk(self, parsed_document: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(parsed_document, dict):
            raise TypeError("parsed_document must be a dict")

        document_type = parsed_document.get("type")

        if document_type == "pdf":
            chunks = self._chunk_pdf(parsed_document)
        elif document_type == "docx":
            chunks = self._chunk_docx(parsed_document)
        elif document_type == "xml":
            chunks = self._chunk_xml(parsed_document)
        else:
            raise ValueError(
                f"Unsupported parser result type: {document_type!r}. "
                "Expected 'pdf', 'docx' or 'xml'."
            )

        return {
            "type": "chunks",
            "source_type": document_type,
            "settings": {
                "max_words": self.max_words,
                "overlap_words": self.overlap_words,
                "min_words": self.min_words,
                "min_ocr_confidence": self.min_ocr_confidence,
            },
            "chunk_count": len(chunks),
            "chunks": chunks,
        }

    # ------------------------------------------------------------------
    # PDF
    # ------------------------------------------------------------------

    def _chunk_pdf(self, parsed_document: dict[str, Any]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []

        for page in parsed_document.get("pages", []):
            page_number = page.get("page")
            blocks = page.get("blocks") or []

            tokens = self._pdf_tokens(blocks)

            # Fallback: if no OCR word blocks exist, use page text.
            if not tokens:
                page_text = self._normalize_space(str(page.get("text", "")))
                if not page_text:
                    continue
                tokens = [_Token(text=word) for word in page_text.split()]

            # Sort OCR words by visual reading order. This is more stable than
            # trusting the raw OCR array when a page contains several regions.
            tokens = self._sort_pdf_tokens(tokens)

            page_chunks = self._window_tokens(tokens)

            for local_index, token_group in enumerate(page_chunks, start=1):
                text = self._tokens_to_text(token_group)
                if not text:
                    continue

                result.append(
                    {
                        "id": f"pdf-p{int(page_number or 0):04d}-c{local_index:04d}",
                        "source_type": "pdf",
                        "page": page_number,
                        "text": text,
                        "word_count": len(token_group),
                        "bbox": self._merge_bboxes(token_group),
                        "avg_confidence": self._avg_confidence(token_group),
                        "source_word_indices": self._source_index_range(token_group),
                    }
                )

        return result

    def _pdf_tokens(self, blocks: list[dict[str, Any]]) -> list[_Token]:
        tokens: list[_Token] = []

        for index, block in enumerate(blocks):
            text = self._normalize_space(str(block.get("text", "")))
            if not text:
                continue

            confidence_raw = block.get("confidence")
            confidence: float | None = None
            if isinstance(confidence_raw, (int, float)):
                confidence = float(confidence_raw)
                if confidence < self.min_ocr_confidence:
                    continue

            bbox = self._valid_bbox(block.get("bbox"))

            # OCR usually returns a single word, but split defensively in case
            # a block contains several whitespace-separated items.
            words = text.split()
            for word in words:
                tokens.append(
                    _Token(
                        text=word,
                        bbox=bbox,
                        confidence=confidence,
                        source_index=index,
                    )
                )

        return tokens

    def _sort_pdf_tokens(self, tokens: list[_Token]) -> list[_Token]:
        with_bbox = [token for token in tokens if token.bbox is not None]
        without_bbox = [token for token in tokens if token.bbox is None]

        if not with_bbox:
            return tokens

        # Group by approximate text line using normalized vertical centers.
        ordered = sorted(
            with_bbox,
            key=lambda token: (
                self._bbox_y_center(token.bbox),
                token.bbox[0],
            ),
        )

        lines: list[list[_Token]] = []
        line_centers: list[float] = []

        for token in ordered:
            center = self._bbox_y_center(token.bbox)

            best_line = None
            best_distance = None

            for line_index, line_center in enumerate(line_centers):
                distance = abs(center - line_center)
                if distance <= self.line_tolerance and (
                    best_distance is None or distance < best_distance
                ):
                    best_line = line_index
                    best_distance = distance

            if best_line is None:
                lines.append([token])
                line_centers.append(center)
            else:
                lines[best_line].append(token)
                line_centers[best_line] = sum(
                    self._bbox_y_center(item.bbox) for item in lines[best_line]
                ) / len(lines[best_line])

        line_pairs = sorted(zip(line_centers, lines), key=lambda item: item[0])

        result: list[_Token] = []
        for _, line in line_pairs:
            result.extend(sorted(line, key=lambda token: token.bbox[0]))

        # Keep non-geometric tokens after the ordered OCR tokens rather than
        # discarding them.
        result.extend(without_bbox)
        return result

    # ------------------------------------------------------------------
    # DOCX
    # ------------------------------------------------------------------

    def _chunk_docx(self, parsed_document: dict[str, Any]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        sequence = 0

        # Paragraphs are kept as logical units and only split when too large.
        for block in parsed_document.get("blocks", []):
            text = self._normalize_space(str(block.get("text", "")))
            if not text:
                continue

            block_index = block.get("index")
            token_groups = self._window_plain_text(text)

            for part_index, words in enumerate(token_groups, start=1):
                sequence += 1
                result.append(
                    {
                        "id": f"docx-c{sequence:04d}",
                        "source_type": "docx",
                        "source_kind": block.get("type", "paragraph"),
                        "block_index": block_index,
                        "part": part_index,
                        "text": " ".join(words),
                        "word_count": len(words),
                    }
                )

        # Tables are chunked row by row so values stay close to their labels.
        for table in parsed_document.get("tables", []):
            table_index = table.get("table")
            rows = table.get("rows") or []

            for row_index, cells in enumerate(rows):
                clean_cells = [self._normalize_space(str(cell)) for cell in cells]
                clean_cells = [cell for cell in clean_cells if cell]
                if not clean_cells:
                    continue

                text = " | ".join(clean_cells)
                token_groups = self._window_plain_text(text)

                for part_index, words in enumerate(token_groups, start=1):
                    sequence += 1
                    result.append(
                        {
                            "id": f"docx-c{sequence:04d}",
                            "source_type": "docx",
                            "source_kind": "table_row",
                            "table_index": table_index,
                            "row_index": row_index,
                            "part": part_index,
                            "text": " ".join(words),
                            "word_count": len(words),
                        }
                    )

        return result

    # ------------------------------------------------------------------
    # XML
    # ------------------------------------------------------------------

    def _chunk_xml(self, parsed_document: dict[str, Any]) -> list[dict[str, Any]]:
        entries: list[tuple[str, str]] = []
        self._collect_xml_text(
            parsed_document.get("data") or {},
            path="",
            output=entries,
        )

        result: list[dict[str, Any]] = []
        sequence = 0

        for path, text in entries:
            token_groups = self._window_plain_text(text)
            for part_index, words in enumerate(token_groups, start=1):
                sequence += 1
                result.append(
                    {
                        "id": f"xml-c{sequence:04d}",
                        "source_type": "xml",
                        "xml_path": path,
                        "part": part_index,
                        "text": " ".join(words),
                        "word_count": len(words),
                    }
                )

        return result

    def _collect_xml_text(
        self,
        node: dict[str, Any],
        path: str,
        output: list[tuple[str, str]],
    ) -> None:
        if not isinstance(node, dict):
            return

        tag = str(node.get("tag", "node"))
        current_path = f"{path}/{tag}" if path else f"/{tag}"

        text = self._normalize_space(str(node.get("text", "")))
        if text:
            output.append((current_path, text))

        for child in node.get("children", []) or []:
            self._collect_xml_text(child, current_path, output)

    # ------------------------------------------------------------------
    # Generic token windows
    # ------------------------------------------------------------------

    def _window_plain_text(self, text: str) -> list[list[str]]:
        words = self._normalize_space(text).split()
        return [
            [token.text for token in group]
            for group in self._window_tokens([_Token(text=word) for word in words])
        ]

    def _window_tokens(self, tokens: list[_Token]) -> list[list[_Token]]:
        if not tokens:
            return []

        if len(tokens) <= self.max_words:
            return [tokens]

        chunks: list[list[_Token]] = []
        step = self.max_words - self.overlap_words
        start = 0

        while start < len(tokens):
            end = min(start + self.max_words, len(tokens))
            group = tokens[start:end]

            # Avoid creating a tiny final chunk. Merge it into the previous
            # chunk when possible, preserving the hard max_words limit by
            # taking the tail of the previous chunk.
            if (
                len(group) < self.min_words
                and chunks
                and end == len(tokens)
            ):
                previous = chunks.pop()
                merged = previous + group
                chunks.append(merged[-self.max_words :])
                break

            chunks.append(group)

            if end == len(tokens):
                break
            start += step

        return chunks

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_space(text: str) -> str:
        return " ".join(text.replace("\u00a0", " ").split())

    @staticmethod
    def _valid_bbox(value: Any) -> tuple[float, float, float, float] | None:
        if not isinstance(value, (list, tuple)) or len(value) != 4:
            return None

        try:
            x0, y0, x1, y1 = (float(item) for item in value)
        except (TypeError, ValueError):
            return None

        if x1 < x0 or y1 < y0:
            return None

        return (x0, y0, x1, y1)

    @staticmethod
    def _bbox_y_center(bbox: tuple[float, float, float, float] | None) -> float:
        if bbox is None:
            return 0.0
        return (bbox[1] + bbox[3]) / 2.0

    @staticmethod
    def _merge_bboxes(tokens: Iterable[_Token]) -> list[float] | None:
        bboxes = [token.bbox for token in tokens if token.bbox is not None]
        if not bboxes:
            return None

        return [
            round(min(box[0] for box in bboxes), 6),
            round(min(box[1] for box in bboxes), 6),
            round(max(box[2] for box in bboxes), 6),
            round(max(box[3] for box in bboxes), 6),
        ]

    @staticmethod
    def _avg_confidence(tokens: Iterable[_Token]) -> float | None:
        values = [
            token.confidence
            for token in tokens
            if token.confidence is not None
        ]
        if not values:
            return None
        return round(sum(values) / len(values), 4)

    @staticmethod
    def _source_index_range(tokens: Iterable[_Token]) -> list[int] | None:
        indices = [
            token.source_index
            for token in tokens
            if token.source_index is not None
        ]
        if not indices:
            return None
        return [min(indices), max(indices)]

    @staticmethod
    def _tokens_to_text(tokens: Iterable[_Token]) -> str:
        return " ".join(token.text for token in tokens).strip()
