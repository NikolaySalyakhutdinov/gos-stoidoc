from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

import numpy as np


class SearchModuleError(RuntimeError):
    """Base exception for the semantic search module."""


class ModelWeightsMissingError(SearchModuleError):
    """Raised when the model directory contains Git LFS pointers instead of weights."""


class SemanticSearch:
    """
    Semantic search over chunks produced by this project's DocumentChunker.

    Pipeline:
        chunks.json -> MiniLM embeddings -> cosine similarity -> top-k chunks

    The model is expected to be a local Sentence-Transformers model, e.g.
    all-MiniLM-L6-v2 or a fine-tuned copy of it.

    By default the ranking is pure cosine similarity.  An optional lightweight
    lexical boost can be enabled for an under-trained model.  This does not
    replace the model; it only helps exact domain terms such as "бетон", "B25",
    document codes, room numbers, etc. influence the final ordering.
    """

    _WEIGHT_CANDIDATES = (
        "model.safetensors",
        "pytorch_model.bin",
    )

    _WORD_RE = re.compile(r"[\wА-Яа-яЁё]+(?:[-./][\wА-Яа-яЁё]+)*", re.UNICODE)

    def __init__(
        self,
        model_path: str | Path,
        *,
        batch_size: int = 32,
        device: str | None = None,
    ) -> None:
        self.model_path = Path(model_path).expanduser().resolve()
        self.batch_size = int(batch_size)
        self.device = device

        if self.batch_size <= 0:
            raise ValueError("batch_size must be > 0")

        self._validate_model_files()
        self._model = self._load_model()

        self.chunks: list[dict[str, Any]] = []
        self.embeddings: np.ndarray | None = None
        self._chunks_fingerprint: str | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load_chunks(self, chunks_path: str | Path) -> int:
        """Load chunks.json produced by DocumentChunker."""
        path = Path(chunks_path)
        if not path.exists():
            raise FileNotFoundError(f"Chunks file not found: {path}")

        with path.open("r", encoding="utf-8") as file:
            payload = json.load(file)

        if isinstance(payload, dict):
            raw_chunks = payload.get("chunks")
        elif isinstance(payload, list):
            raw_chunks = payload
        else:
            raw_chunks = None

        if not isinstance(raw_chunks, list):
            raise SearchModuleError(
                "Unsupported chunks format. Expected {'chunks': [...]} or a JSON list."
            )

        cleaned: list[dict[str, Any]] = []
        for index, item in enumerate(raw_chunks):
            if not isinstance(item, dict):
                continue

            text = self._normalize_space(str(item.get("text", "")))
            if not text:
                continue

            chunk = dict(item)
            chunk["text"] = text
            chunk.setdefault("id", f"chunk-{index:06d}")
            cleaned.append(chunk)

        if not cleaned:
            raise SearchModuleError("No non-empty text chunks were found.")

        self.chunks = cleaned
        self.embeddings = None
        self._chunks_fingerprint = self._fingerprint_chunks(cleaned)
        return len(cleaned)

    def build_index(
        self,
        *,
        cache_path: str | Path | None = None,
        force: bool = False,
    ) -> np.ndarray:
        """
        Encode all loaded chunks and optionally cache embeddings on disk.

        Because embeddings are L2-normalized, a dot product with the normalized
        query embedding is the cosine similarity.
        """
        if not self.chunks:
            raise SearchModuleError("Call load_chunks() before build_index().")

        cache = Path(cache_path) if cache_path is not None else None
        meta_path = self._meta_path(cache) if cache is not None else None

        if cache is not None and not force:
            cached = self._try_load_cache(cache, meta_path)
            if cached is not None:
                self.embeddings = cached
                return cached

        texts = [chunk["text"] for chunk in self.chunks]
        embeddings = self._model.encode(
            texts,
            batch_size=self.batch_size,
            show_progress_bar=len(texts) >= 64,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        embeddings = np.asarray(embeddings, dtype=np.float32)

        if embeddings.ndim != 2 or embeddings.shape[0] != len(self.chunks):
            raise SearchModuleError(
                f"Unexpected embedding shape: {embeddings.shape}; "
                f"expected ({len(self.chunks)}, embedding_dim)."
            )

        self.embeddings = embeddings

        if cache is not None:
            cache.parent.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(cache, embeddings=embeddings)
            assert meta_path is not None
            with meta_path.open("w", encoding="utf-8") as file:
                json.dump(
                    {
                        "chunks_fingerprint": self._chunks_fingerprint,
                        "chunk_count": len(self.chunks),
                        "embedding_dim": int(embeddings.shape[1]),
                        "model_path": str(self.model_path),
                    },
                    file,
                    ensure_ascii=False,
                    indent=2,
                )

        return embeddings

    def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        min_score: float | None = None,
        hybrid: bool = False,
        lexical_weight: float = 0.15,
        anchor_text: str | None = None,
        anchor_weight: float = 0.0,
        min_anchor_score: float | None = None,
        min_anchor_terms: int | None = None,
        deduplicate: bool = True,
        duplicate_threshold: float = 0.88,
    ) -> list[dict[str, Any]]:
        """
        Return the most relevant chunks.

        Parameters
        ----------
        query:
            User search query, e.g. "класс прочности бетона".
        top_k:
            Maximum number of results.
        min_score:
            Optional minimum cosine similarity. Applied to semantic_score.
        hybrid:
            If False, rank only by MiniLM cosine similarity. If True, add a
            small lexical score for exact/domain terms.
        lexical_weight:
            Weight of lexical score in hybrid ranking, from 0 to 1.
        anchor_text:
            Parameter/source words that must be present in a result.
        anchor_weight:
            Weight of the anchor score in hybrid ranking, from 0 to 1.
        min_anchor_score:
            Optional minimum fraction of anchor terms matched by a chunk.
        min_anchor_terms:
            Optional minimum number of matched anchor terms.
        deduplicate:
            Suppress near-duplicate overlapping chunks from the result list.
        duplicate_threshold:
            Jaccard similarity threshold for duplicate suppression.
        """
        query = self._normalize_space(query)
        if not query:
            raise ValueError("query must not be empty")
        if top_k <= 0:
            raise ValueError("top_k must be > 0")
        if not 0.0 <= lexical_weight <= 1.0:
            raise ValueError("lexical_weight must be in [0, 1]")
        if not 0.0 <= anchor_weight <= 1.0:
            raise ValueError("anchor_weight must be in [0, 1]")
        if lexical_weight + anchor_weight > 1.0:
            raise ValueError("lexical_weight + anchor_weight must be <= 1")
        if min_anchor_score is not None and not 0.0 <= min_anchor_score <= 1.0:
            raise ValueError("min_anchor_score must be in [0, 1]")
        if not 0.0 <= duplicate_threshold <= 1.0:
            raise ValueError("duplicate_threshold must be in [0, 1]")
        if not self.chunks:
            raise SearchModuleError("No chunks loaded. Call load_chunks().")
        if self.embeddings is None:
            self.build_index()

        query_embedding = self._model.encode(
            [query],
            batch_size=1,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        query_embedding = np.asarray(query_embedding, dtype=np.float32)[0]

        assert self.embeddings is not None
        semantic_scores = self.embeddings @ query_embedding

        lexical_scores = np.zeros(len(self.chunks), dtype=np.float32)
        anchor_scores = np.zeros(len(self.chunks), dtype=np.float32)
        anchor_match_counts = np.zeros(len(self.chunks), dtype=np.int32)
        anchor_terms = self._normalized_terms(anchor_text or "")
        required_anchor_terms = (
            int(min_anchor_terms)
            if min_anchor_terms is not None
            else 2 if len(anchor_terms) >= 8 else 1
        )
        if required_anchor_terms < 0:
            raise ValueError("min_anchor_terms must be >= 0")

        if anchor_terms:
            anchor_values = [
                self._lexical_match_stats(anchor_terms, chunk["text"])
                for chunk in self.chunks
            ]
            anchor_match_counts = np.asarray(
                [value[0] for value in anchor_values],
                dtype=np.int32,
            )
            anchor_scores = np.asarray(
                [value[1] for value in anchor_values],
                dtype=np.float32,
            )

        if hybrid:
            lexical_scores = np.asarray(
                [self._lexical_score(query, chunk["text"]) for chunk in self.chunks],
                dtype=np.float32,
            )
            # Cosine similarity is [-1, 1], lexical score is [0, 1].
            # Convert semantic similarity to [0, 1] only for the hybrid rank.
            semantic_01 = np.clip((semantic_scores + 1.0) / 2.0, 0.0, 1.0)
            semantic_weight = 1.0 - lexical_weight - anchor_weight
            rank_scores = (
                semantic_weight * semantic_01
                + lexical_weight * lexical_scores
                + anchor_weight * anchor_scores
            )
        else:
            rank_scores = semantic_scores

        order = np.argsort(-rank_scores)
        results: list[dict[str, Any]] = []
        selected_token_sets: list[set[str]] = []

        for raw_index in order:
            index = int(raw_index)
            semantic_score = float(semantic_scores[index])
            if min_score is not None and semantic_score < min_score:
                continue
            if anchor_terms:
                if anchor_match_counts[index] < required_anchor_terms:
                    continue
                if min_anchor_score is not None and anchor_scores[index] < min_anchor_score:
                    continue

            chunk = self.chunks[index]

            if deduplicate:
                token_set = self._token_set(chunk["text"])
                is_duplicate = any(
                    self._jaccard(token_set, previous) >= duplicate_threshold
                    for previous in selected_token_sets
                )
                if is_duplicate:
                    continue
            else:
                token_set = set()

            result = dict(chunk)
            result["semantic_score"] = round(semantic_score, 6)
            result["lexical_score"] = round(float(lexical_scores[index]), 6)
            result["anchor_score"] = round(float(anchor_scores[index]), 6)
            result["anchor_match_count"] = int(anchor_match_counts[index])
            result["rank_score"] = round(float(rank_scores[index]), 6)
            results.append(result)

            if deduplicate:
                selected_token_sets.append(token_set)

            if len(results) >= top_k:
                break

        return results

    def search_texts(
        self,
        query: str,
        texts: list[str],
        *,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """
        Convenience method for quick model tests like the example with five
        standalone sentences. It does not modify the current chunk index.
        """
        query = self._normalize_space(query)
        clean_texts = [self._normalize_space(text) for text in texts]
        clean_texts = [text for text in clean_texts if text]
        if not query or not clean_texts:
            return []

        corpus_embeddings = self._model.encode(
            clean_texts,
            batch_size=self.batch_size,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        query_embedding = self._model.encode(
            [query],
            batch_size=1,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )[0]

        scores = np.asarray(corpus_embeddings, dtype=np.float32) @ np.asarray(
            query_embedding, dtype=np.float32
        )
        order = np.argsort(-scores)[:top_k]

        return [
            {
                "text": clean_texts[int(index)],
                "semantic_score": round(float(scores[int(index)]), 6),
            }
            for index in order
        ]

    # ------------------------------------------------------------------
    # Model loading / validation
    # ------------------------------------------------------------------

    def _load_model(self):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as error:
            raise SearchModuleError(
                "Package 'sentence-transformers' is not installed. "
                "Install search dependencies with: "
                "pip install -r req_search.txt"
            ) from error

        try:
            return SentenceTransformer(str(self.model_path), device=self.device)
        except Exception as error:
            raise SearchModuleError(
                f"Failed to load Sentence-Transformers model from {self.model_path}: {error}"
            ) from error

    def _validate_model_files(self) -> None:
        if not self.model_path.exists() or not self.model_path.is_dir():
            raise FileNotFoundError(f"Model directory not found: {self.model_path}")

        pointer_files: list[Path] = []
        real_weight_found = False

        for name in self._WEIGHT_CANDIDATES:
            path = self.model_path / name
            if not path.exists():
                continue
            if self._is_git_lfs_pointer(path):
                pointer_files.append(path)
            elif path.stat().st_size > 1024:
                real_weight_found = True

        if pointer_files and not real_weight_found:
            pointer_names = ", ".join(path.name for path in pointer_files)
            raise ModelWeightsMissingError(
                "The model folder contains Git LFS pointer files instead of actual "
                f"weights ({pointer_names}). Run 'git lfs install' and 'git lfs pull' "
                "inside the model repository, or copy the real model.safetensors / "
                "pytorch_model.bin into this folder."
            )

    @staticmethod
    def _is_git_lfs_pointer(path: Path) -> bool:
        try:
            if path.stat().st_size > 2048:
                return False
            head = path.read_text(encoding="utf-8", errors="ignore")[:256]
            return head.startswith("version https://git-lfs.github.com/spec/v1")
        except OSError:
            return False

    # ------------------------------------------------------------------
    # Cache
    # ------------------------------------------------------------------

    def _try_load_cache(
        self,
        cache_path: Path,
        meta_path: Path | None,
    ) -> np.ndarray | None:
        if not cache_path.exists() or meta_path is None or not meta_path.exists():
            return None

        try:
            with meta_path.open("r", encoding="utf-8") as file:
                meta = json.load(file)

            if meta.get("chunks_fingerprint") != self._chunks_fingerprint:
                return None
            if int(meta.get("chunk_count", -1)) != len(self.chunks):
                return None
            if meta.get("model_path") != str(self.model_path):
                return None

            with np.load(cache_path, allow_pickle=False) as data:
                embeddings = np.asarray(data["embeddings"], dtype=np.float32)

            if embeddings.ndim != 2 or embeddings.shape[0] != len(self.chunks):
                return None

            return embeddings
        except (OSError, ValueError, KeyError, json.JSONDecodeError, TypeError):
            return None

    @staticmethod
    def _meta_path(cache_path: Path) -> Path:
        return cache_path.with_suffix(cache_path.suffix + ".meta.json")

    @staticmethod
    def _fingerprint_chunks(chunks: list[dict[str, Any]]) -> str:
        digest = hashlib.sha256()
        for chunk in chunks:
            digest.update(str(chunk.get("id", "")).encode("utf-8"))
            digest.update(b"\0")
            digest.update(str(chunk.get("text", "")).encode("utf-8"))
            digest.update(b"\0")
        return digest.hexdigest()

    # ------------------------------------------------------------------
    # Lightweight lexical helper for under-trained models
    # ------------------------------------------------------------------

    def _lexical_score(self, query: str, text: str) -> float:
        query_tokens = self._normalized_terms(query)
        if not query_tokens:
            return 0.0

        return self._lexical_match_stats(query_tokens, text)[1]

    def _lexical_match_stats(self, query_tokens: list[str], text: str) -> tuple[int, float]:
        text_tokens = self._normalized_terms(text)
        if not query_tokens or not text_tokens:
            return 0, 0.0

        matched = sum(
            1
            for query_token in query_tokens
            if any(self._term_matches(query_token, token) for token in text_tokens)
        )
        return matched, matched / len(query_tokens)

    def _normalized_terms(self, text: str) -> list[str]:
        terms = [match.group(0).casefold() for match in self._WORD_RE.finditer(text)]
        stop_words = {
            "а", "без", "в", "во", "для", "до", "за", "и", "из", "к", "как",
            "на", "над", "не", "ни", "о", "об", "от", "по", "под", "при", "с",
            "со", "у", "через", "это", "этот", "эта", "эти", "раздел", "источник",
        }
        return [term for term in terms if len(term) >= 2 and term not in stop_words]

    @staticmethod
    def _term_matches(left: str, right: str) -> bool:
        left = left.replace("ё", "е")
        right = right.replace("ё", "е")
        if left == right:
            return True

        suffixes = (
            "иями", "ами", "ями", "ого", "ему", "ому", "ыми", "ими", "ее", "ое",
            "ей", "ий", "ый", "ой", "ая", "яя", "ов", "ев", "ам", "ям", "ах", "ях",
            "ом", "ем", "ы", "и", "а", "я", "у", "ю", "е",
        )
        for suffix in suffixes:
            if len(left) - len(suffix) >= 4 and left.endswith(suffix):
                left = left[:-len(suffix)]
                break
        for suffix in suffixes:
            if len(right) - len(suffix) >= 4 and right.endswith(suffix):
                right = right[:-len(suffix)]
                break
        if left == right:
            return True

        # Domain text often contains simple Russian inflection changes:
        # "класс" / "класса", "бетон" / "бетона".  A shared prefix keeps
        # this helper dependency-free and intentionally conservative.
        if len(left) < 4 or len(right) < 4:
            return False

        prefix_len = 0
        for a, b in zip(left, right):
            if a != b:
                break
            prefix_len += 1

        return prefix_len >= 4 and prefix_len >= min(len(left), len(right)) - 2

    # ------------------------------------------------------------------
    # Duplicate suppression / text helpers
    # ------------------------------------------------------------------

    def _token_set(self, text: str) -> set[str]:
        return set(self._normalized_terms(text))

    @staticmethod
    def _jaccard(left: set[str], right: set[str]) -> float:
        if not left and not right:
            return 1.0
        union = left | right
        if not union:
            return 0.0
        return len(left & right) / len(union)

    @staticmethod
    def _normalize_space(text: str) -> str:
        return " ".join(text.split())
