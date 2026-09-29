FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    AI_MODEL_PATH=/app/models/construction-minilm-132 \
    AI_OCR_DPI=250

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       tesseract-ocr \
       tesseract-ocr-rus \
       tesseract-ocr-eng \
       libgl1 \
       libglib2.0-0 \
       libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./app.py
COPY ai_core ./ai_core
COPY tests ./tests
COPY models ./models

# Fail the image build early if the archived model was copied without a
# compatible Sentence-Transformers configuration or tokenizer.
RUN python -c "from sentence_transformers import SentenceTransformer; model = SentenceTransformer('/app/models/construction-minilm-132', device='cpu'); assert model.get_sentence_embedding_dimension() == 384"

EXPOSE 8000
CMD ["python", "app.py"]
