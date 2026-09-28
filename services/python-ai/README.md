# Python AI pipeline

Сервис принимает документ от Node.js по `POST /process` и выполняет полный локальный конвейер:

1. PDF/DOCX/XML parser;
2. OCR для PDF через Tesseract;
3. traceable chunker с номерами страниц и bbox;
4. `construction-minilm-132` через Sentence-Transformers;
5. гибридный поиск пяти фрагментов для каждого параметра матрицы.

Node.js передаёт в запросе `object_id`, `process_id`, стадию `PD/RD/ID`, файл и список из 132 запросов матрицы. Python возвращает результаты поиска, после чего Node.js сохраняет доказательства, проверки и находки в PostgreSQL.

Модель должна лежать в `models/construction-minilm-132` и содержать не только `model.safetensors`, но и конфигурации Sentence-Transformers и каталог `1_Pooling`.

Проверка контейнера:

```text
GET http://localhost:8000/health
```
