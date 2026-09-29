import re


def check_text(text):
    if not text:
        return False, 0, "empty"

    length = len(text)

    bad = len(
        re.findall(
            r"[ÐÑÃÂ]",
            text
        )
    )

    russian = len(
        re.findall(
            r"[А-Яа-яЁё]",
            text
        )
    )

    if bad / length > 0.08:
        return False, 0.1, "encoding_error"

    if russian / length < 0.03:
        return False, 0.3, "not_russian"

    return True, 0.95, "ok"
