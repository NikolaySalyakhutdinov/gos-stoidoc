def extract_blocks(page):
    blocks = []

    # PyMuPDF's native ordering is more reliable for multi-column pages than
    # sorting already flattened blocks after extraction.
    for block in page.get_text("blocks", sort=True):
        if len(block) >= 5:
            text = str(block[4]).strip()
            if not text:
                continue
            block_type = int(block[6]) if len(block) > 6 else 0
            blocks.append({
                "bbox": [
                    block[0],
                    block[1],
                    block[2],
                    block[3]
                ],
                "text": text,
                "block_type": block_type,
                "source_kind": "image" if block_type == 1 else "text",
            })

    return blocks
