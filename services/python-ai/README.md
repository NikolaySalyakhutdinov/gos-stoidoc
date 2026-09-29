# Python AI pipeline

Сервис принимает документ от Node.js по `POST /process` и выполняет конвейер:

```text
Parser v2
  -> layout-aware Chunker v3
  -> MiniLM semantic search TOP-20
  -> source-aware reranker
  -> Parameter Extractor
  -> Node Comparator (ПД / РД / ИД)
```

Parser v2 сохраняет `source`, `stage`, `page`, `bbox` и тип блока. Chunker v3 не объединяет соседние блоки PDF: числовые размеры чертежей получают `content_kind=drawing_dimension` и `searchable=false`, поэтому не могут стать значением текстового параметра. Reranker требует якорь параметра и единицу измерения, а extractor возвращает только подтверждённые пары `value` / `normalized_value`.

Если значение не найдено в допустимых текстовых блоках, результат параметра получает статус `NOT_FOUND`; сырые семантически похожие фрагменты не передаются Comparator как доказательство.

Node.js передаёт `object_id`, `process_id`, стадию `PD/RD/ID`, файл и параметры матрицы. Python возвращает evidence с `page`, `bbox`, `source`, `stage`, `section`, `chunk_id`, `extracted_value` и диагностикой отклонённых кандидатов.

Модель должна лежать в `models/construction-minilm-132` и содержать не только `model.safetensors`, но и конфигурации Sentence-Transformers и каталог `1_Pooling`.

Проверка контейнера:

```text
GET http://localhost:8000/health
```

Регрессионные тесты:

```powershell
npm run ai:test
```
