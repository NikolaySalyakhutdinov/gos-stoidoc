import cv2
import fitz
import numpy as np

from .image_processor import preprocess
from .layout_analyzer import analyze
from .ocr_engine import OCREngine
from .quality_checker import check_text
from .text_cleaner import clean
from .text_extractor import extract_blocks


class PDFParser:

    def __init__(
        self,
        path: str | None = None,
        debug: bool = False,
        dpi: int = 360,
        language: str = "rus+eng",
        tesseract_path: str | None = None
    ):
        self.path = path
        self.debug = debug
        self.dpi = dpi
        self.ocr = OCREngine(
            language=language,
            tesseract_path=tesseract_path
        )

    def render(self, page):
        pix = page.get_pixmap(
            matrix=fitz.Matrix(
                self.dpi / 72,
                self.dpi / 72
            ),
            alpha=False
        )

        img = np.frombuffer(
            pix.samples,
            dtype=np.uint8
        )

        img = img.reshape(
            pix.height,
            pix.width,
            pix.n
        )

        if pix.n == 4:
            img = cv2.cvtColor(
                img,
                cv2.COLOR_RGBA2BGR
            )
        elif pix.n == 3:
            img = cv2.cvtColor(
                img,
                cv2.COLOR_RGB2BGR
            )

        return img

    def parse(self, file_path: str | None = None):
        path = file_path or self.path
        if not path:
            raise ValueError("Не указан путь к PDF-файлу")

        doc = fitz.open(path)

        result = {
            "type": "pdf",
            "document": path,
            "pages": []
        }

        try:
            for number, page in enumerate(doc, 1):
                blocks = extract_blocks(page)

                text = "\n".join(
                    block["text"]
                    for block in blocks
                )

                valid, quality, reason = check_text(text)
                method = "text"

                if not valid:
                    image = self.render(page)
                    image = preprocess(image)
                    blocks = self.ocr.recognize_blocks(image)
                    text = "\n".join(block["text"] for block in blocks)
                    method = "ocr"
                    if not text.strip():
                        text = self.ocr.recognize(image)
                        blocks = [{"bbox": None, "text": text}]
                    valid, quality, reason = check_text(text)

                result["pages"].append({
                    "page": number,
                    "method": method,
                    "quality": quality,
                    "reason": reason,
                    "blocks": analyze(blocks),
                    "text": clean(text)
                })
        finally:
            doc.close()

        return result
