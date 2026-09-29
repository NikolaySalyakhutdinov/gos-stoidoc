from __future__ import annotations

import json
import logging
import os
import re
import sys
import tempfile
import threading
import time
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import numpy as np
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest


BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR / "ai_core"))

from chunker import DocumentChunker  # noqa: E402
from parser import DocumentParser  # noqa: E402
from search import ParameterExtractor, SemanticSearch, SourceAwareReranker  # noqa: E402


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "@timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "service": os.getenv("LOG_SERVICE_NAME", "python-ai"),
            "environment": os.getenv("NODE_ENV", "development"),
            "level": record.levelname.lower(),
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["error"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


class LogstashHandler(logging.Handler):
    def __init__(self, url: str) -> None:
        super().__init__()
        self.url = url

    def emit(self, record: logging.LogRecord) -> None:
        body = self.format(record).encode("utf-8")

        def send() -> None:
            try:
                request = Request(self.url, data=body, headers={"Content-Type": "application/json"}, method="POST")
                with urlopen(request, timeout=1):
                    pass
            except Exception:
                pass

        threading.Thread(target=send, daemon=True).start()


def configure_logging() -> None:
    formatter = JsonFormatter()
    console = logging.StreamHandler()
    console.setFormatter(formatter)
    handlers: list[logging.Handler] = [console]
    logstash_url = os.getenv("LOGSTASH_URL")
    if logstash_url:
        logstash = LogstashHandler(logstash_url)
        logstash.setFormatter(formatter)
        handlers.append(logstash)
    logging.basicConfig(level=logging.INFO, handlers=handlers, force=True)


configure_logging()

AI_REQUESTS = Counter("stroynadzor_ai_requests_total", "AI document requests by status", ["status", "stage"])
AI_DURATION = Histogram("stroynadzor_ai_request_duration_seconds", "AI document processing duration", ["stage"])
AI_CHUNKS = Counter("stroynadzor_ai_chunks_total", "Searchable chunks produced by the AI parser", ["stage"])

MODEL_PATH = Path(os.getenv("AI_MODEL_PATH", str(BASE_DIR / "models" / "construction-minilm-132")))
MAX_REQUEST_BYTES = int(os.getenv("AI_MAX_REQUEST_BYTES", str(210 * 1024 * 1024)))
LISTEN_PORT = int(os.getenv("PORT", os.getenv("AI_PORT", "8000")))
# When set, /process (not /health or /metrics) requires this exact value in
# X-Internal-Token. Used when the service is reachable from the public
# internet (e.g. Cloud Run) instead of only from a private Docker network.
INTERNAL_TOKEN = os.getenv("AI_INTERNAL_TOKEN", "")
OCR_DPI = int(os.getenv("AI_OCR_DPI", "250"))
SEARCH_TOP_K = int(os.getenv("AI_SEARCH_TOP_K", "20"))
SEARCH_RERANK_TOP_K = int(os.getenv("AI_SEARCH_RERANK_TOP_K", "12"))
SEARCH_LEXICAL_WEIGHT = float(os.getenv("AI_SEARCH_LEXICAL_WEIGHT", "0.25"))
SEARCH_ANCHOR_WEIGHT = float(os.getenv("AI_SEARCH_ANCHOR_WEIGHT", "0.45"))
SEARCH_MIN_ANCHOR_SCORE = float(os.getenv("AI_SEARCH_MIN_ANCHOR_SCORE", "0.14"))
_engine: SemanticSearch | None = None
_engine_lock = threading.RLock()
_reranker = SourceAwareReranker()
_extractor = ParameterExtractor()


class AiRequestError(ValueError):
    pass


def normalize_filename(value: object) -> str:
    """Repair a UTF-8 filename decoded as Latin-1 by a multipart parser."""
    name = str(value or "").replace("\x00", "")
    if not any(marker in name for marker in ("Ã", "Â", "Ð", "Ñ")):
        return name
    try:
        decoded = name.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return name
    return name if "\ufffd" in decoded else decoded


def extract_document_metadata(file_name: str, parsed_document: dict) -> dict[str, str | None]:
    """Extract safe document metadata that can be shown with an evidence fragment."""
    pages = parsed_document.get("pages") or []
    text = "\n".join(str(page.get("text") or "") for page in pages[:5])

    revision_match = re.search(
        r"(?:редакци(?:я|и)|ред\.?|ревизи(?:я|и)|рев\.?)\s*(?:№|N|номер|:|-)?\s*([A-Za-zА-Яа-я0-9][A-Za-zА-Яа-я0-9._/-]{0,20})",
        text,
        re.IGNORECASE,
    )
    sheet_match = re.search(
        r"(?:лист|л\.)\s*№?\s*(\d+)(?:\s*(?:из|/)\s*(\d+))?",
        text,
        re.IGNORECASE,
    )
    if re.search(r"\b(?:утверждено|утверждена|утвержден|утверждаю)\b", text, re.IGNORECASE):
        approval_status = "Утверждено"
    elif re.search(r"\b(?:согласовано|согласован|согласована)\b", text, re.IGNORECASE):
        approval_status = "Согласовано"
    else:
        approval_status = None

    return {
        "revision": revision_match.group(1) if revision_match else None,
        "approval_status": approval_status,
        "sheet": (
            f"{sheet_match.group(1)} из {sheet_match.group(2)}"
            if sheet_match and sheet_match.group(2)
            else sheet_match.group(1) if sheet_match else None
        ),
        "document_code": Path(file_name).stem,
    }


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def get_search_engine() -> SemanticSearch:
    global _engine
    if _engine is None:
        logging.info("Loading MiniLM model from %s", MODEL_PATH)
        _engine = SemanticSearch(MODEL_PATH, batch_size=16)
        logging.info("MiniLM model loaded")
    return _engine


def parse_multipart(content_type: str, body: bytes) -> tuple[dict[str, str], dict[str, object]]:
    envelope = BytesParser(policy=default).parsebytes(
        b"Content-Type: " + content_type.encode("utf-8") + b"\r\n"
        b"MIME-Version: 1.0\r\n\r\n" + body
    )
    if not envelope.is_multipart():
        raise AiRequestError("Ожидался multipart/form-data запрос")

    fields: dict[str, str] = {}
    uploaded: dict[str, object] = {}
    for part in envelope.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        filename = normalize_filename(part.get_filename())
        payload = part.get_payload(decode=True) or b""
        if filename:
            uploaded = {"name": filename, "content": payload, "mime_type": part.get_content_type()}
        else:
            fields[name] = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
    if not uploaded:
        raise AiRequestError("В запросе отсутствует поле file")
    return fields, uploaded


def parse_queries(raw: str) -> list[dict]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise AiRequestError(f"Поле queries содержит некорректный JSON: {error.msg}") from error
    if not isinstance(value, list):
        raise AiRequestError("Поле queries должно быть массивом")
    queries: list[dict] = []
    for item in value[:200]:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code", "")).strip()
        parameter = str(item.get("parameter", "")).strip()
        trigger = str(item.get("trigger", "")).strip()
        source = str(item.get("source", "")).strip()
        section = str(item.get("section", "")).strip()
        unit = str(item.get("unit", "")).strip()
        if not code or not parameter:
            continue
        queries.append({
            "code": code,
            "parameter": parameter,
            "unit": unit,
            "section": section,
            "source": source,
            "trigger": trigger,
            "text": ". ".join(part for part in (parameter, unit, section, source, trigger) if part),
            "anchor": parameter,
        })
    return queries


def process_document(fields: dict[str, str], uploaded: dict[str, object]) -> dict:
    object_id = fields.get("object_id", "").strip()
    process_id = fields.get("process_id", "").strip()
    stage = fields.get("stage", "").strip().upper()
    if not object_id or not process_id or stage not in {"PD", "RD", "ID"}:
        raise AiRequestError("Нужны object_id, process_id и stage=PD|RD|ID")

    file_name = str(uploaded["name"])
    file_content = uploaded["content"]
    suffix = Path(file_name).suffix.lower()
    if suffix not in {".pdf", ".docx", ".xml"}:
        raise AiRequestError("Поддерживаются только PDF, DOCX и XML")
    if not isinstance(file_content, bytes) or not file_content:
        raise AiRequestError("Файл пустой")

    queries = parse_queries(fields.get("queries", ""))
    for item in queries:
        item["stage"] = stage

    with tempfile.TemporaryDirectory(prefix="stroynadzor-ai-") as temp_dir:
        work_dir = Path(temp_dir)
        input_path = work_dir / Path(file_name).name
        chunks_path = work_dir / "chunks.json"
        index_path = work_dir / "search_index.npz"
        input_path.write_bytes(file_content)

        parser = DocumentParser(dpi=OCR_DPI)
        parsed_document = parser.parse(
            str(input_path),
            source=file_name,
            stage=stage,
        )
        document_metadata = extract_document_metadata(file_name, parsed_document)
        chunker = DocumentChunker(
            chunk_size=700,
            overlap=120,
            max_words=int(os.getenv("AI_CHUNK_MAX_WORDS", "48")),
            overlap_words=int(os.getenv("AI_CHUNK_OVERLAP_WORDS", "12")),
            min_words=8,
            min_ocr_confidence=0.0,
        )
        chunks_document = chunker.chunk(
            parsed_document,
            source=file_name,
            stage=stage,
        )
        chunks_path.write_text(json.dumps(chunks_document, ensure_ascii=False), encoding="utf-8")
        searchable_chunks = [
            {
                "id": chunk.get("id"),
                "text": chunk.get("text"),
                "page": chunk.get("page"),
                "bbox": chunk.get("bbox"),
                "source": chunk.get("source") or file_name,
                "stage": chunk.get("stage") or stage,
                "section": chunk.get("section"),
                "content_kind": chunk.get("content_kind"),
                "searchable": chunk.get("searchable", True),
            }
            for chunk in chunks_document.get("chunks", [])
            if chunk.get("searchable", True) and chunk.get("content_kind") != "drawing_dimension" and str(chunk.get("text") or "").strip()
        ][: int(os.getenv("AI_SUSPICION_MAX_CHUNKS", "500"))]
        AI_CHUNKS.labels(stage=stage).inc(len(searchable_chunks))

        results_by_parameter: dict[str, list[dict]] = {}
        parameter_status: dict[str, dict] = {}
        search_diagnostics: dict[str, dict] = {}
        embedding_dim = None
        if queries and chunks_document.get("chunks"):
            # Sentence-Transformers keeps mutable chunk/index state, so one request
            # at a time uses the shared loaded model.
            with _engine_lock:
                engine = get_search_engine()
                engine.load_chunks(chunks_path)
                embeddings = engine.build_index(cache_path=index_path, force=True)
                embedding_dim = int(np.asarray(embeddings).shape[1])
                for item in queries:
                    semantic_candidates = engine.search(
                        item["text"],
                        top_k=SEARCH_TOP_K,
                        hybrid=True,
                        lexical_weight=SEARCH_LEXICAL_WEIGHT,
                        anchor_text=item["anchor"],
                        anchor_weight=SEARCH_ANCHOR_WEIGHT,
                        min_anchor_score=SEARCH_MIN_ANCHOR_SCORE,
                    )
                    reranked = _reranker.rerank(
                        semantic_candidates,
                        item,
                        top_k=SEARCH_RERANK_TOP_K,
                    )
                    extracted = _extractor.extract(item, reranked["results"])
                    results_by_parameter[item["code"]] = extracted
                    parameter_status[item["code"]] = {
                        "status": "FOUND" if extracted else "NOT_FOUND",
                        "reason": None if extracted else "no_confirmed_value",
                        "candidate_count": len(semantic_candidates),
                        "reranked_count": len(reranked["results"]),
                        "extracted_count": len(extracted),
                    }
                    search_diagnostics[item["code"]] = {
                        "miniLM_top_k": SEARCH_TOP_K,
                        "semantic_count": len(semantic_candidates),
                        "reranked_count": len(reranked["results"]),
                        "rejected_count": len(reranked["rejected"]),
                        "rejected_reasons": reranked["rejected"][:10],
                    }
        else:
            for item in queries:
                results_by_parameter[item["code"]] = []
                parameter_status[item["code"]] = {
                    "status": "NOT_FOUND",
                    "reason": "no_searchable_chunks",
                    "candidate_count": 0,
                    "reranked_count": 0,
                    "extracted_count": 0,
                }

        for evidence_list in results_by_parameter.values():
            for evidence in evidence_list:
                evidence["document_metadata"] = document_metadata

        pages = parsed_document.get("pages") or []
        return {
            "status": "COMPLETED",
            "object_id": object_id,
            "process_id": process_id,
            "stage": stage,
            "file_name": file_name,
            "parser": {
                "type": parsed_document.get("type"),
                "pages": len(pages),
                "blocks": sum(len(page.get("blocks") or []) for page in pages),
            },
            "chunk_count": int(chunks_document.get("chunk_count", 0)),
            "searchable_chunks": searchable_chunks,
            "document_metadata": document_metadata,
            "model": {
                "name": MODEL_PATH.name,
                "path": str(MODEL_PATH),
                "embedding_dim": embedding_dim,
                "search": "semantic+lexical+anchor",
                "pipeline": "Parser v2 -> Chunker v3 -> MiniLM TOP-20 -> source-aware reranker -> Parameter Extractor -> Comparator",
                "semantic_top_k": SEARCH_TOP_K,
                "rerank_top_k": SEARCH_RERANK_TOP_K,
            },
            "results_by_parameter": results_by_parameter,
            "parameter_status": parameter_status,
            "search_diagnostics": search_diagnostics,
        }


class Handler(BaseHTTPRequestHandler):
    server_version = "StroynadzorAI/1.0"

    def send_json(self, status: int, payload: dict) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            self.send_json(
                200,
                {
                    "ok": True,
                    "service": "python-ai",
                    "model": MODEL_PATH.name,
                    "model_weights_present": (MODEL_PATH / "model.safetensors").exists(),
                },
            )
            return
        if path == "/metrics":
            body = generate_latest()
            self.send_response(200)
            self.send_header("Content-Type", CONTENT_TYPE_LATEST)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/process":
            self.send_json(404, {"error": "Not found"})
            return

        if INTERNAL_TOKEN and self.headers.get("X-Internal-Token", "") != INTERNAL_TOKEN:
            self.send_json(401, {"status": "FAILED", "code": "UNAUTHORIZED", "error": "Неверный или отсутствующий X-Internal-Token"})
            return

        started = time.monotonic()
        stage = "unknown"
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
                raise AiRequestError("Размер запроса превышает допустимый лимит")
            content_type = self.headers.get("Content-Type", "")
            body = self.rfile.read(content_length)
            fields, uploaded = parse_multipart(content_type, body)
            stage = fields.get("stage", "unknown").upper()
            result = process_document(fields, uploaded)
            AI_REQUESTS.labels(status="completed", stage=stage).inc()
            AI_DURATION.labels(stage=stage).observe(time.monotonic() - started)
            logging.info(
                "Processed %s/%s stage=%s chunks=%s",
                fields.get("object_id"),
                uploaded.get("name"),
                fields.get("stage"),
                result.get("chunk_count"),
            )
            self.send_json(200, result)
        except AiRequestError as error:
            AI_REQUESTS.labels(status="invalid_request", stage=stage).inc()
            AI_DURATION.labels(stage=stage).observe(time.monotonic() - started)
            self.send_json(400, {"status": "FAILED", "code": "INVALID_REQUEST", "error": str(error)})
        except Exception as error:  # noqa: BLE001
            AI_REQUESTS.labels(status="failed", stage=stage).inc()
            AI_DURATION.labels(stage=stage).observe(time.monotonic() - started)
            logging.exception("AI processing failed")
            self.send_json(500, {"status": "FAILED", "code": "AI_PROCESSING_ERROR", "error": str(error)})

    def log_message(self, format: str, *args: object) -> None:
        logging.info("%s - %s", self.address_string(), format % args)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), Handler)
    logging.info("Python AI listening on :%s, model=%s", LISTEN_PORT, MODEL_PATH)
    server.serve_forever()
