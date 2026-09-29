from __future__ import annotations

import re
from typing import Any


class ParameterExtractor:
    """Extract a single value only when it is explicitly anchored in text."""

    _NUMBER = r"-?\d+(?:[\s\u00a0]\d{3})*(?:[.,]\d+)?"
    _CLASS_RE = re.compile(r"\b([ВB]\s*-?\s*\d{1,3}(?:[.,]\d+)?)\b", re.IGNORECASE)

    def extract(self, query: dict[str, Any], candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        extracted: list[dict[str, Any]] = []
        for candidate in candidates:
            text = str(candidate.get("text") or "")
            value = self._extract_class(text) if self._is_concrete_query(query) else None
            if value is None:
                value = self._extract_number_with_unit(text, str(query.get("unit") or ""))
            if value is None:
                continue

            item = dict(candidate)
            item.update(value)
            item.update({
                "status": "CONFIRMED",
                "extraction_status": "CONFIRMED",
                "parameter_code": query.get("code"),
                "parameter": query.get("parameter"),
                "unit": query.get("unit") or value.get("unit"),
                "section": query.get("section") or candidate.get("section"),
                "stage": query.get("stage") or candidate.get("stage"),
                "source_hint": query.get("source") or candidate.get("source_hint"),
            })
            extracted.append(item)

        extracted.sort(
            key=lambda item: (
                float(item.get("extraction_confidence", 0)),
                float(item.get("rerank_score", 0)),
                float(item.get("semantic_score", 0)),
            ),
            reverse=True,
        )

        unique: list[dict[str, Any]] = []
        keys: set[tuple[str, str]] = set()
        for item in extracted:
            key = (str(item.get("normalized_value")), str(item.get("source")))
            if key in keys:
                continue
            keys.add(key)
            unique.append(item)
        return unique

    @staticmethod
    def _is_concrete_query(query: dict[str, Any]) -> bool:
        text = str(query.get("parameter") or "").casefold()
        return "бетон" in text or ("класс" in text and "прочност" in text)

    def _extract_class(self, text: str) -> dict[str, Any] | None:
        for match in self._CLASS_RE.finditer(text):
            context = text[max(0, match.start() - 80): match.end() + 80].casefold()
            if "бетон" not in context and "класс" not in context and "прочност" not in context:
                continue
            display = re.sub(r"\s+", "", match.group(1)).upper().replace("В", "B")
            number = display[1:]
            return {
                "value": display,
                "extracted_value": display,
                "normalized_value": f"B{number}",
                "unit": "класс",
                "match_text": match.group(0),
                "extractor": "concrete_strength_class",
                "extraction_confidence": 0.98,
            }
        return None

    def _extract_number_with_unit(self, text: str, unit: str) -> dict[str, Any] | None:
        if not unit or unit in {"—", "-"}:
            return None
        unit_pattern = self._unit_pattern(unit)
        if not unit_pattern:
            return None
        pattern = re.compile(
            rf"(?P<number>{self._NUMBER})\s*(?P<unit>{unit_pattern})",
            re.IGNORECASE,
        )
        match = pattern.search(text)
        if not match:
            return None

        raw_number = match.group("number").strip()
        normalized_number = raw_number.replace(" ", "").replace("\u00a0", "").replace(",", ".")
        display_unit = self._display_unit(unit)
        return {
            "value": f"{raw_number} {display_unit}",
            "extracted_value": f"{raw_number} {display_unit}",
            "normalized_value": f"{normalized_number}|{self._normalized_unit(unit)}",
            "unit": display_unit,
            "match_text": match.group(0),
            "extractor": "number_with_unit",
            "extraction_confidence": 0.96,
        }

    @staticmethod
    def _unit_pattern(unit: str) -> str | None:
        normalized = unit.casefold().replace(" ", "")
        aliases = {
            "м³": r"м\s*(?:3|³)|куб(?:\.|ических)?\s*м",
            "м3": r"м\s*(?:3|³)|куб(?:\.|ических)?\s*м",
            "м²": r"м\s*(?:2|²)|кв(?:\.|адратных)?\s*м",
            "м2": r"м\s*(?:2|²)|кв(?:\.|адратных)?\s*м",
            "м": r"(?<![а-яa-z])м(?![а-яa-z])",
            "мм": r"мм|mm",
            "см": r"см|cm",
            "шт.": r"шт\.?|ед\.?",
            "ед.": r"ед\.?|шт\.?",
            "%": r"%",
            "квт": r"квт|kw",
            "па": r"па|pa",
            "л/с": r"л\s*/\s*с",
        }
        return aliases.get(normalized, re.escape(unit).replace(r"\ ", r"\s*"))

    @staticmethod
    def _display_unit(unit: str) -> str:
        normalized = unit.casefold().replace(" ", "")
        return {
            "м3": "м³",
            "м²": "м²",
            "м2": "м²",
            "шт.": "шт.",
            "ед.": "ед.",
        }.get(normalized, unit.strip())

    @staticmethod
    def _normalized_unit(unit: str) -> str:
        normalized = unit.casefold().replace(" ", "")
        return {
            "м³": "м3",
            "м²": "м2",
            "шт.": "шт",
            "ед.": "ед",
        }.get(normalized, normalized)
