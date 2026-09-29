# Стройнадзор ИИ

Локальная система для загрузки проектной, рабочей и исполнительной документации и автоматической проверки параметров объекта.

## 1. Что нужно установить

- Docker Desktop с включённым WSL 2;
- Git — только если проект нужно скачать из GitHub.

Для первого запуска рекомендуется выделить Docker Desktop не менее 8 ГБ оперативной памяти: AI-сервис загружает модель MiniLM.

## 2. Запуск через Docker

Откройте PowerShell и перейдите в каталог проекта:

```powershell
cd C:\Users\olgas\OneDrive\Desktop\Коля\stroynadzor-ai-main
```

Если проект ещё не скачан:

```powershell
git clone https://github.com/NikolaySalyakhutdinov/gos-stoidoc.git stroynadzor-ai-main
cd stroynadzor-ai-main
```

Создайте локальный файл настроек:

```powershell
Copy-Item .env.example .env -Force
```

Запустите приложение вместе с RabbitMQ:

```powershell
docker compose --profile messaging up -d --build
```

Проверка состояния:

```powershell
docker compose --profile messaging ps
```

Основные контейнеры должны иметь статус `Up`. У `postgres` и `python-ai` должен быть статус `healthy`.

## 3. Адреса сервисов

| Назначение | Адрес |
|---|---|
| Веб-приложение | http://localhost:8080 |
| Node.js API | http://localhost:4000 |
| Проверка API | http://localhost:4000/api/health |
| OpenAPI 3.0.3 | http://localhost:4000/openapi.json |
| Python AI | http://localhost:8000/health |
| RabbitMQ Management | http://localhost:15672 |

Веб-приложение открывается на `http://localhost:8080`.
Пароль и логин для RabbitMQ: guest
RabbitMQ используется API для асинхронной постановки задач анализа. В Management UI очередь находится в разделе `Queues and Streams` и называется `stroynadzor.analysis`.

## 4. Вход в приложение

### Демо-вход для локального режима

```text
Email:    inspector@stroynadzor-ai.ru
Пароль:   demo1234
```

Демо-пользователь создаётся автоматически при первом успешном входе, если контейнер API запущен с `NODE_ENV=development`.

### Регистрация нового пользователя

На странице регистрации укажите:

- имя;
- email с доменом `.ru`;
- пароль минимум из 6 символов.

Пример:

```text
Имя:      Тестовый инспектор
Email:    inspector2@example.ru
Пароль:   StrongPass123
```

В production демо-вход использовать нельзя. Задайте собственные секреты в `.env` до запуска:

```dotenv
JWT_SECRET=замените-на-длинный-случайный-секрет
POSTGRES_PASSWORD=замените-на-пароль-базы
```

### Вход в RabbitMQ

Для локального RabbitMQ Management UI:

```text
Логин:  guest
Пароль: guest
```

Эти данные предназначены только для локального запуска.

## 5. API: где находится и как авторизоваться

Исходный код API находится в каталоге:

```text
server/src/
```

Основные файлы:

```text
server/src/index.js                 запуск Express и middleware
server/src/routes/auth.js           регистрация и вход
server/src/routes/objects.js        объекты, документы и результаты проверки
server/src/routes/matrix.js         параметры матрицы
server/src/routes/audit.js          аудит действий
server/src/services/jobQueue.js     RabbitMQ: публикация и обработка задач
server/openapi/openapi.json         контракт OpenAPI 3.0.3
```

Открытые маршруты, которым не нужен JWT:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/forgot-password
GET  /api/health
GET  /openapi.json
GET  /metrics
```

После регистрации или входа API возвращает `token` и `refreshToken`. Для остальных JSON-запросов передавайте JWT так:

```http
Authorization: Bearer <token>
Content-Type: application/json
```

Основные защищённые маршруты:

```text
GET/PATCH /api/auth/me
PATCH     /api/auth/me/notifications
POST      /api/auth/change-password

GET/POST/DELETE /api/objects
GET             /api/objects/:id
PATCH           /api/objects/:id/status
GET             /api/objects/:id/completeness
GET             /api/objects/:id/findings
GET             /api/objects/:id/suspicions

GET         /api/objects/:id/uploads
POST        /api/objects/:id/uploads/:stage
DELETE      /api/objects/:id/uploads/:stage/:fileId

POST        /api/objects/:id/findings/:findingId/decide
POST        /api/objects/:id/findings/:findingId/undo

GET         /api/matrix
POST        /api/matrix       только роль ADMIN
DELETE      /api/matrix/:id   только роль ADMIN
GET         /api/audit
```

JSON-запросы и ответы проверяются по OpenAPI-схеме. Файл схемы можно открыть по адресу `http://localhost:4000/openapi.json` или найти в `server/openapi/openapi.json`.

Исключения:

- загрузка документов использует `multipart/form-data`;
- поток прогресса обработки использует SSE `text/event-stream`;
- просмотр исходного файла возвращает binary;
- `/metrics` возвращает формат Prometheus.

## 6. Что происходит после загрузки документов

1. Web-интерфейс отправляет документ в Node.js API.
2. API сохраняет файл и создаёт задачу анализа.
3. Задача отправляется в RabbitMQ в очередь `stroynadzor.analysis`.
4. Worker API получает задачу и передаёт документ в Python AI.
5. Python AI выполняет Parser v2 → layout-aware Chunker v3 → MiniLM TOP-20 → source-aware reranker → Parameter Extractor.
6. API сохраняет результат сравнения ПД/РД/ИД и публикует прогресс в интерфейс.

Если RabbitMQ временно недоступен, API использует прямой fallback-режим анализа. Для штатной асинхронной работы запускайте проект с профилем `messaging`.

## 7. Логи и мониторинг

Логи:

```powershell
docker compose logs -f api
docker compose logs -f python-ai
docker compose logs -f rabbitmq
```

Для запуска Prometheus, Grafana и ELK:

```powershell
docker compose --profile messaging --profile monitoring up -d --build
```

Адреса:

| Сервис | Адрес |
|---|---|
| Grafana | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Kibana | http://localhost:5601 |
| Elasticsearch | http://localhost:9200 |

Локальный вход в Grafana по умолчанию:

```text
Логин:  admin
Пароль: local-grafana-change-me
```

Для изменения пароля задайте `GRAFANA_ADMIN_PASSWORD` в `.env` до запуска.

## 8. Остановка и повторный запуск

Остановить контейнеры без удаления данных:

```powershell
docker compose --profile messaging --profile monitoring down
```

Запустить снова:

```powershell
docker compose --profile messaging up -d
```

Не используйте `down -v`, если нужно сохранить пользователей, объекты, документы и результаты проверки: эта команда удаляет volumes PostgreSQL и RabbitMQ.

## 9. Типовые проблемы

### Открывается ошибка `502` или `Host is unreachable`

Проверьте API:

```powershell
docker compose ps api
docker compose logs --tail 100 api
```

Перезапустите API:

```powershell
docker compose --profile messaging up -d --build api
```

### В RabbitMQ нет очереди

Запустите проект с профилем очереди и обновите страницу Management UI:

```powershell
docker compose --profile messaging up -d
```

После запуска API очередь `stroynadzor.analysis` создаётся автоматически.

### Регистрация отклоняется

Проверьте, что email заканчивается на `.ru`, а пароль содержит минимум 6 символов.

### Нужно полностью очистить локальные данные

Выполняйте только если данные больше не нужны:

```powershell
docker compose --profile messaging --profile monitoring down -v
```

