from __future__ import annotations

import re
from typing import Any


class SourceAwareReranker:
    """Reject semantically similar chunks without the parameter's evidence anchor."""

    _WORD_RE = re.compile(r"[\wА-Яа-яЁё]+(?:[-./][\wА-Яа-яЁё]+)*", re.UNICODE)
    _STOP_WORDS = {
        "а", "без", "в", "во", "для", "до", "за", "и", "из", "к", "как", "на",
        "над", "не", "ни", "о", "об", "от", "по", "под", "при", "с", "со", "у",
        "через", "это", "этот", "эта", "эти", "раздел", "источник", "таблица", "лист",
    }
    _GENERIC_TERMS = {
        "общий", "общие", "общего", "общая", "основной", "основные", "данные", "сведения",
        "работа", "работы", "рабочий", "рабочие", "конструкция", "конструкции", "объект",
        "объекта", "здание", "здания", "устройство", "система", "системы", "материал",
        "материалы", "схема", "схемы", "план", "планы", "чертеж", "чертежи", "ведомость",
        "ведомости", "значение", "показатель", "параметр",
    }
    _SUFFIXES = (
        "иями", "ами", "ями", "ого", "ему", "ому", "ыми", "ими", "ее", "ое", "ей",
        "ий", "ый", "ой", "ая", "яя", "ов", "ев", "ам", "ям", "ах", "ях", "ом", "ем",
        "ы", "и", "а", "я", "у", "ю", "е",
    )

    def rerank(
        self,
        candidates: list[dict[str, Any]],
        query: dict[str, Any],
        *,
        top_k: int = 12,
    ) -> dict[str, Any]:
        if top_k <= 0:
            raise ValueError("top_k must be > 0")

        accepted: list[dict[str, Any]] = []
        rejected: list[dict[str, Any]] = []
        for candidate in candidates:
            scored, reason = self._score(candidate, query)
            if scored is None:
                rejected.append({
                    "chunk_id": candidate.get("id"),
                    "reason": reason,
                    "text": str(candidate.get("text", ""))[:220],
                })
                continue
            accepted.append(scored)

        accepted.sort(
            key=lambda item: (
                float(item.get("rerank_score", 0)),
                float(item.get("semantic_score", 0)),
            ),
            reverse=True,
        )
        return {
            "results": accepted[:top_k],
            "rejected": rejected,
            "candidate_count": len(candidates),
            "accepted_count": len(accepted),
        }

    def _score(self, candidate: dict[str, Any], query: dict[str, Any]):
        content_kind = str(candidate.get("content_kind") or "text")
        if content_kind in {"drawing_dimension", "image"} or candidate.get("searchable") is False:
            return None, "non_text_layout_block"

        text = str(candidate.get("text") or "")
        terms = self._terms(query.get("parameter"))
        text_terms = self._terms(text)
        distinctive = [term for term in terms if term not in self._GENERIC_TERMS]
        matches = [term for term in terms if any(self._matches(term, value) for value in text_terms)]
        distinctive_matches = [term for term in distinctive if any(self._matches(term, value) for value in text_terms)]

        if distinctive:
            required = 2 if len(distinctive) >= 2 else 1
            if len(distinctive_matches) < required:
                return None, "missing_parameter_anchor"
        elif len(matches) < 1:
            return None, "missing_parameter_anchor"

        expected_unit = str(query.get("unit") or "").strip()
        unit_match = self._unit_matches(expected_unit, text)
        if expected_unit and expected_unit not in {"—", "-"} and not unit_match:
            return None, "missing_unit_anchor"

        source_terms = self._terms(query.get("source"))
        section_terms = self._terms(query.get("section"))
        source_matches = sum(
            1 for term in source_terms if any(self._matches(term, value) for value in text_terms)
        )
        section_matches = sum(
            1 for term in section_terms if any(self._matches(term, value) for value in text_terms)
        )
        semantic = float(candidate.get("semantic_score", 0) or 0)
        semantic_01 = max(0.0, min(1.0, (semantic + 1.0) / 2.0))
        anchor_ratio = len(distinctive_matches or matches) / max(1, len(distinctive or terms))
        source_ratio = source_matches / max(1, len(source_terms)) if source_terms else 0.0
        section_ratio = section_matches / max(1, len(section_terms)) if section_terms else 0.0
        score = (
            0.45 * anchor_ratio
            + 0.20 * (1.0 if unit_match else 0.0)
            + 0.15 * source_ratio
            + 0.10 * section_ratio
            + 0.10 * semantic_01
        )

        enriched = dict(candidate)
        enriched.update({
            "source_hint": query.get("source") or None,
            "stage": query.get("stage") or candidate.get("stage"),
            "section": query.get("section") or candidate.get("section"),
            "parameter_code": query.get("code") or None,
            "parameter_match_count": len(distinctive_matches or matches),
            "unit_match": unit_match,
            "rerank_score": round(score, 6),
            "rerank_reason": "parameter_anchor+source_context",
        })
        return enriched, None

    @classmethod
    def _terms(cls, text: Any) -> list[str]:
        values = []
        for match in cls._WORD_RE.finditer(str(text or "")):
            value = match.group(0).casefold().replace("ё", "е")
            if len(value) >= 2 and value not in cls._STOP_WORDS:
                values.append(value)
        return list(dict.fromkeys(values))

    @classmethod
    def _matches(cls, left: str, right: str) -> bool:
        if left == right:
            return True
        left_stem = cls._stem(left)
        right_stem = cls._stem(right)
        if left_stem == right_stem:
            return True
        return len(left_stem) >= 5 and right_stem.startswith(left_stem[:5])

    @classmethod
    def _stem(cls, value: str) -> str:
        for suffix in cls._SUFFIXES:
            if len(value) - len(suffix) >= 4 and value.endswith(suffix):
                return value[:-len(suffix)]
        return value

    @staticmethod
    def _unit_matches(unit: str, text: str) -> bool:
        normalized = unit.casefold().replace(" ", "")
        if "марка" in normalized and "b" in normalized:
            return bool(re.search(r"\b[ВB]\s*-?\s*\d{1,3}\b", text, re.IGNORECASE))
        aliases = {
            "м³": r"м\s*(?:3|³)|куб(?:\.|ических)?\s*м",
            "м2": r"м\s*(?:2|²)|кв(?:\.|адратных)?\s*м",
            "м²": r"м\s*(?:2|²)|кв(?:\. |адратных)?\s*м",
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
        pattern = aliases.get(normalized, re.escape(unit).replace(r"\ ", r"\s*"))
        return bool(re.search(pattern, text, re.IGNORECASE))
