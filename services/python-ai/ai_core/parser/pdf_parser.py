import fitz
import cv2
import numpy as np

from .image_processor import ImageProcessor
from .ocr_engine import OCREngine


class PDFParser:

    def __init__(
        self,
        dpi: int = 300,
        language: str = "rus+eng",
        tesseract_path: str | None = None
    ):

        self.dpi = dpi

        self.image_processor = ImageProcessor()

        self.ocr = OCREngine(
            language=language,
            tesseract_path=tesseract_path
        )

    def _page_to_image(self, page):
        """
        PDF page -> OpenCV image
        """

        zoom = self.dpi / 72

        matrix = fitz.Matrix(
            zoom,
            zoom
        )

        pixmap = page.get_pixmap(
            matrix=matrix,
            alpha=False
        )

        image = np.frombuffer(
            pixmap.samples,
            dtype=np.uint8
        )

        image = image.reshape(
            pixmap.height,
            pixmap.width,
            pixmap.n
        )

        if pixmap.n == 4:

            image = cv2.cvtColor(
                image,
                cv2.COLOR_RGBA2BGR
            )

        else:

            image = cv2.cvtColor(
                image,
                cv2.COLOR_RGB2BGR
            )

        return image

    def parse(self, file_path: str):

        document = fitz.open(file_path)

        pages = []

        try:

            for page_index, page in enumerate(document):

                page_number = page_index + 1

                print(
                    f"[PDF] Обработка страницы "
                    f"{page_number}/{len(document)}"
                )

                # -----------------------------
                # PDF -> IMAGE
                # -----------------------------

                image = self._page_to_image(page)

                original_height, original_width = (
                    image.shape[:2]
                )

                # -----------------------------
                # OPENCV
                # -----------------------------

                processed = (
                    self.image_processor.preprocess(
                        image
                    )
                )

                # -----------------------------
                # OCR
                # -----------------------------

                blocks = self.ocr.recognize(
                    processed
                )

                # Собираем весь текст страницы

                page_text = " ".join(
                    block["text"]
                    for block in blocks
                )

                pages.append({

                    "page": page_number,

                    "width": original_width,

                    "height": original_height,

                    "text": page_text,

                    "blocks": blocks
                })

        finally:

            document.close()

        return {
            "type": "pdf",
            "pages": pages
        }
