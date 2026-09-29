def split_text(
    text,
    size=700,
    overlap=120
):
    words = str(text or "").split()
    if not words:
        return []

    chunks = []
    start = 0
    while start < len(words):
        end = start
        length = 0
        while end < len(words):
            word_length = len(words[end])
            next_length = word_length if end == start else length + 1 + word_length
            if end > start and next_length > size:
                break
            length = next_length
            end += 1

        chunks.append(" ".join(words[start:end]))
        if end >= len(words):
            break

        overlap_length = 0
        overlap_words = 0
        for index in range(end - 1, start - 1, -1):
            candidate = len(words[index]) + (1 if overlap_words else 0)
            if overlap_words and overlap_length + candidate > overlap:
                break
            overlap_length += candidate
            overlap_words += 1

        start = max(start + 1, end - overlap_words)

    return chunks
