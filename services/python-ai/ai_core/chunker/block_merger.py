def merge_blocks(blocks):
    result = []
    current = ""
    current_boxes = []

    for block in blocks:
        text = block.get("text", "").strip()
        if not text:
            continue

        current += " " + text

        if block.get("bbox"):
            current_boxes.append(block["bbox"])

    if current:
        result.append({
            "text": current.strip(),
            "bbox": current_boxes
        })

    return result
