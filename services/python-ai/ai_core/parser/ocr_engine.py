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
        return pytesseract.image_to_string(
            image,
            lang=self.language,
            config="--oem 3 --psm 3"
        )

    def recognize_blocks(self, image):
        """Return OCR lines with coordinates instead of one flattened string."""
        data = pytesseract.image_to_data(
            image,
            lang=self.language,
            config="--oem 3 --psm 3",
            output_type=Output.DICT,
        )
        lines = {}
        count = len(data.get("text", []))

        for index in range(count):
            text = str(data["text"][index] or "").strip()
            try:
                confidence = float(data["conf"][index])
            except (TypeError, ValueError):
                confidence = -1
            if not text or confidence < 0:
                continue

            key = (
                data.get("block_num", [0] * count)[index],
                data.get("par_num", [0] * count)[index],
                data.get("line_num", [0] * count)[index],
            )
            left = int(data["left"][index])
            top = int(data["top"][index])
            right = left + int(data["width"][index])
            bottom = top + int(data["height"][index])
            line = lines.setdefault(key, {"words": [], "boxes": [], "confidence": []})
            line["words"].append(text)
            line["boxes"].append((left, top, right, bottom))
            line["confidence"].append(confidence / 100)

        result = []
        for line in lines.values():
            boxes = line["boxes"]
            result.append({
                "text": " ".join(line["words"]),
                "bbox": [
                    min(box[0] for box in boxes),
                    min(box[1] for box in boxes),
                    max(box[2] for box in boxes),
                    max(box[3] for box in boxes),
                ],
                "confidence": sum(line["confidence"]) / len(line["confidence"]),
                "block_type": 0,
                "source_kind": "text",
            })

        return result
