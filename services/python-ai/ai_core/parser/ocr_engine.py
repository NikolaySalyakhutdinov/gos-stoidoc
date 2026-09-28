import pytesseract
from pytesseract import Output


class OCREngine:

    def __init__(
        self,
        language: str = "rus+eng",
        tesseract_path: str | None = None
    ):
        self.language = language

        if tesseract_path:
            pytesseract.pytesseract.tesseract_cmd = tesseract_path

    def recognize(self, image):
        """
        Распознаёт слова на изображении.

        Возвращает:
        - текст слова
        - confidence
        - bbox в пикселях
        - bbox в координатах от 0 до 1
        """

        data = pytesseract.image_to_data(
            image,
            lang=self.language,
            output_type=Output.DICT,
            config="--oem 3 --psm 6"
        )

        height, width = image.shape[:2]

        blocks = []

        count = len(data["text"])

        for i in range(count):

            text = data["text"][i].strip()

            try:
                confidence = float(data["conf"][i])
            except (ValueError, TypeError):
                confidence = -1

            # Пропускаем пустые элементы
            if not text:
                continue

            # Пропускаем элементы,
            # которые Tesseract не смог распознать
            if confidence < 0:
                continue

            x = int(data["left"][i])
            y = int(data["top"][i])

            w = int(data["width"][i])
            h = int(data["height"][i])

            # Координаты в пикселях
            bbox_pixels = [
                x,
                y,
                x + w,
                y + h
            ]

            # Координаты от 0 до 1
            bbox_normalized = [
                x / width,
                y / height,
                (x + w) / width,
                (y + h) / height
            ]

            blocks.append({
                "type": "word",
                "text": text,

                "confidence": round(
                    confidence / 100,
                    4
                ),

                "bbox": bbox_normalized,
                "bbox_pixels": bbox_pixels
            })

        return blocks
