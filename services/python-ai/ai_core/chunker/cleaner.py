import re


REMOVE_PATTERNS = [
    r"^стр\.\s*\d+.*$",
    r"^страница\s+\d+.*$",
    r"^\d+\s*/\s*\d+$"
]


def clean(text):
    text = text.replace("\x00", "")

    for pattern in REMOVE_PATTERNS:
        text = re.sub(
            pattern,
            "",
            text,
            flags=re.I
        )

    text = re.sub(
        r"\s+",
        " ",
        text
    )

    return text.strip()
