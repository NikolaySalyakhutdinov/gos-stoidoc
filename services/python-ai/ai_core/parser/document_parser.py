from pathlib import Path

from .docx_parser import DOCXParser
from .pdf_parser import PDFParser
from .xml_parser import XMLParser


class DocumentParser:

    SUPPORTED_FORMATS = {
        ".pdf",
        ".docx",
        ".xml"
    }

    def __init__(
        self,
        dpi: int = 300,
        tesseract_path: str | None = None
    ):
        self.pdf_parser = PDFParser(
            dpi=dpi,
            tesseract_path=tesseract_path
        )
        self.docx_parser = DOCXParser()
        self.xml_parser = XMLParser()

    def parse(self, file_path: str):
        path = Path(file_path)

        if not path.exists():
            raise FileNotFoundError(
                f"Файл не найден: {file_path}"
            )

        extension = path.suffix.lower()

        if extension not in self.SUPPORTED_FORMATS:
            raise ValueError(
                f"Формат {extension} не поддерживается. "
                f"Поддерживаются: {self.SUPPORTED_FORMATS}"
            )

        print(f"[Parser] Файл: {path.name}")
        print(f"[Parser] Формат: {extension}")

        if extension == ".pdf":
            return self.pdf_parser.parse(str(path))

        if extension == ".docx":
            return self.docx_parser.parse(str(path))

        if extension == ".xml":
            return self.xml_parser.parse(str(path))

        raise ValueError("Неизвестный формат")
