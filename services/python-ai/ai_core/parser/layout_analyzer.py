def analyze(blocks):
    def sort_key(block):
        bbox = block.get("bbox")
        if not bbox:
            return (float("inf"), float("inf"))
        return (bbox[1], bbox[0])

    return sorted(blocks, key=sort_key)
