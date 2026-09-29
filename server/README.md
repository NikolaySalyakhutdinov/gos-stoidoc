# Стройнадзор ИИ — API

Node.js / Express API с PostgreSQL, JWT и `bcryptjs`. При запуске выполняется
идемпотентное создание схемы базы данных. Операционные данные и demo-записи не
добавляются: новая база остаётся пустой до регистрации пользователя и создания
объекта. Единственное исключение — справочник матрицы из 132 параметров ТЗ,
который переносится в `matrix_params` один раз.

## Локальный запуск

Из корня проекта:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

После запуска:

- веб-приложение: http://localhost:8080;
- API: http://localhost:4000;
- PostgreSQL: localhost:5432;
- placeholder Python 3.11: http://localhost:8000/health.

Если Docker не используется, PostgreSQL должен быть доступен по переменным
`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`; затем выполните `npm install` и `npm start`.

## Основные переменные

| Переменная | Назначение |
|---|---|
| `JWT_SECRET` | секрет подписи JWT; для production задаётся явно |
| `POSTGRES_*` | параметры подключения к PostgreSQL |
| `CORS_ORIGIN` | разрешённые origin через запятую |
| `PYTHON_AI_URL` | endpoint AI-пайплайна, по умолчанию `http://python-ai:8000/process` |

## API

Открытые маршруты: `POST /api/auth/register`, `POST /api/auth/login`,
`POST /api/auth/forgot-password`, `GET /api/health`. Остальные маршруты
требуют `Authorization: Bearer <token>`.

- `GET/PATCH /api/auth/me`, `PATCH /api/auth/me/notifications`,
  `POST /api/auth/change-password`;
- `GET/POST/DELETE /api/objects` — список, создание и удаление объектов;
- `PATCH /api/objects/:id/status`;
- `GET /api/objects/:id/completeness` и `/findings`;
- `POST /api/objects/:id/findings/:findingId/decide` и `/undo`;
- `GET /api/objects/:id/uploads`;
- `POST /api/objects/:id/uploads/:stage` — multipart-поле `files`, стадии `PD`, `RD`, `ID`;
- `DELETE /api/objects/:id/uploads/:stage/:fileId`;
- `GET /api/matrix` и `GET /api/audit`.

Добавление и удаление параметров матрицы выполняется через `POST /api/matrix` и
`DELETE /api/matrix/:id` и доступно только пользователю с ролью `ADMIN`.
Попытка обычного пользователя получить эти операции возвращает `403`.

`DELETE /api/objects/:id` принимает JSON `{ reasonCode, comment }`. Причина
обязательна и выбирается из фиксированного перечня; для `OTHER` комментарий
обязателен. Оба значения сохраняются в `audit_logs.details`.

Регистрация разрешена только для email с доменом `.ru`. Документ после проверки
формата и лимитов сохраняется в `files.content BYTEA`; SHA-256 хранится рядом.
Для объекта, файла, finding и процесса настроены внешние ключи с каскадным
удалением. Перед удалением объекта создаётся аудит-запись, после чего связанные
документы, процессы и результаты удаляются PostgreSQL каскадно.

## Аудит и готовность к ИИ

`audit_logs` фиксирует регистрацию, создание и удаление объектов, загрузку и
удаление документов, смены статуса, решения инспектора и финализацию протокола.
После коммита документа Node отправляет multipart-запрос в `PYTHON_AI_URL`.
Недоступность Python не отменяет сохранение файла: задача получает статус
`AI_UNAVAILABLE` и может быть повторно обработана будущим worker-сервисом.

`services/python-ai` — полностью запускаемый HTTP-контейнер на Python 3.11 slim.
Он выполняет Parser v2 → Chunker v3 → MiniLM TOP-20 → source-aware reranker →
Parameter Extractor. Node.js затем сравнивает подтверждённые значения по стадиям
ПД/РД/ИД. Если подтверждённого значения нет, finding получает `NOT_FOUND`, а не
случайный числовой фрагмент из чертежа.

## Где находится БД и что в ней хранится

В Docker база работает в контейнере `postgres` PostgreSQL 16. Данные сохраняются
в именованном volume `postgres_data`, поэтому находятся не в React и не в
Node.js-контейнере. Подключение из Node выполняется через `pg` по переменным
`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER` и
`POSTGRES_PASSWORD`.

Основные таблицы:

- `users` — пользователи и bcrypt-хеши паролей;
- `objects` — карточки объектов строительства;
- `files` — документы ПД/РД/ИД: имя, тип, размер, SHA-256 и содержимое `BYTEA`;
- `matrix_params` — 132 параметра матрицы и добавленные пользователем параметры;
- `findings`, `checks`, `completeness` — результаты сверки и комплектность;
- `analysis_processes`, `process_jobs` — процессы обработки и задания для Python;
- `audit_logs` — журнал регистрации, загрузок, удаления, решений и статусов;
- `protocols`, `evidence_fragments`, `suspicions`, `rejection_log`, `dispute_log` —
  протокол, доказательства, гипотезы и действия инспектора;
- `logical_rules`, `normative_base`, `dataset_items`, `model_versions`,
  `ml_retraining_log`, `monitoring_metrics` — задел под контур ИИ и мониторинг;
- `system_settings` — технический маркер однократной загрузки 132 параметров.

Для файлов, findings, процессов и результатов объекта используются внешние ключи
с `ON DELETE CASCADE`. Запись удаления объекта в `audit_logs` сохраняется, а её
`object_id` становится `NULL`, чтобы аудит не исчезал вместе с объектом.
