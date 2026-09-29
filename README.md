# gos-stoidoc

Инструкция по клонированию приватного репозитория `gos-stoidoc` на другом компьютере вместе с файлами, которые хранятся через Git LFS.

Репозиторий приватный. Инструкция предназначена для пользователей, которым уже предоставлен доступ к репозиторию на GitHub.

## Что понадобится

- аккаунт GitHub с доступом к репозиторию;
- Git;
- Git LFS;
- доступ к интернету.

## Установка и проверка Git и Git LFS

Установите Git для своей операционной системы с официального сайта:

<https://git-scm.com/downloads>

Git LFS обычно устанавливается вместе с Git для Windows. Если команда Git LFS не работает, установите его отдельно:

<https://git-lfs.com/>

Откройте PowerShell или терминал и проверьте установку:

```powershell
git --version
git lfs version
```

Обе команды должны вывести версии установленных программ.

Один раз включите Git LFS для текущего пользователя:

```powershell
git lfs install
```

Ожидаемый результат — сообщение о том, что Git LFS настроен.

## Клонирование репозитория

1. Убедитесь, что на GitHub вашему аккаунту предоставлен доступ к приватному репозиторию `gos-stoidoc`.

2. Перейдите в папку, в которую хотите скачать проект, и выполните:

```powershell
git clone https://github.com/NikolaySalyakhutdinov/gos-stoidoc.git
```

3. Перейдите в каталог проекта:

```powershell
cd gos-stoidoc
```

Если GitHub запросит авторизацию, войдите под аккаунтом, которому предоставлен доступ к репозиторию. Обычный пароль GitHub нельзя использовать вместо пароля Git в командной строке. Используйте авторизацию через браузер/Git Credential Manager или Personal Access Token.

## Скачивание файлов Git LFS

После клонирования скачайте настоящие версии файлов, хранящихся в Git LFS:

```powershell
git lfs pull
```

В проекте через Git LFS хранится, в частности, модель:

```text
services/python-ai/models/construction-minilm-132/model.safetensors
```

## Проверка Git LFS

Проверьте, какие файлы отслеживаются через Git LFS:

```powershell
git lfs ls-files
```

В выводе должна присутствовать модель, например:

```text
26d7feac2a * services/python-ai/models/construction-minilm-132/model.safetensors
```

Звёздочка `*` означает, что файл загружен в рабочую копию.

## Проверка размера модели

В PowerShell выполните:

```powershell
Get-Item ".\services\python-ai\models\construction-minilm-132\model.safetensors" |
    Select-Object FullName, Length
```

Настоящая модель должна занимать примерно **449 МБ** — около 449 000 000 байт.

Если размер файла составляет примерно 130–150 байт, скачался только Git LFS pointer — небольшой текстовый файл-ссылку вместо самой модели. В этом случае восстановите файл по инструкции ниже.

## Если вместо модели скачался Git LFS pointer

Находясь в каталоге проекта `gos-stoidoc`, выполните команды последовательно:

```powershell
git lfs fetch origin main
git lfs checkout
git lfs pull origin main
```

Что делают эти команды:

1. `git lfs fetch origin main` скачивает LFS-объекты с удалённого репозитория.
2. `git lfs checkout` заменяет pointer настоящими файлами из локального LFS-хранилища.
3. `git lfs pull origin main` синхронизирует LFS-файлы с веткой `main`.

После этого снова проверьте размер модели:

```powershell
Get-Item ".\services\python-ai\models\construction-minilm-132\model.safetensors" |
    Select-Object FullName, Length
```

Если файл по-прежнему имеет размер около 130–150 байт, проверьте доступ к приватному репозиторию и повторите авторизацию GitHub.

## Обычное обновление проекта

Чтобы получить последние изменения из ветки `main`, выполните в каталоге проекта:

```powershell
git pull origin main
git lfs pull
```

Первая команда обновляет обычные файлы Git, вторая — файлы, хранящиеся через Git LFS.

## Быстрый старт

Если Git и Git LFS уже установлены, а доступ к репозиторию настроен, достаточно выполнить:

```powershell
git lfs install
git clone https://github.com/NikolaySalyakhutdinov/gos-stoidoc.git
cd gos-stoidoc
git lfs pull
git lfs ls-files
Get-Item ".\services\python-ai\models\construction-minilm-132\model.safetensors" | Select-Object FullName, Length
```

## AI-пайплайн документов

После загрузки документов AI-сервис выполняет `Parser v2 → layout-aware Chunker
v3 → MiniLM TOP-20 → source-aware reranker → Parameter Extractor`, а Node.js
сравнивает подтверждённые значения между ПД, РД и ИД. Блоки с числовыми
размерами чертежей сохраняются с `bbox`, но не смешиваются с текстом и не
принимаются за значение параметра. При отсутствии подтверждённого значения
создаётся статус `NOT_FOUND`.

Страница объекта получает состояние обработки через Server-Sent Events (SSE):
полоса прогресса и текущий этап меняются без перезагрузки страницы. Если поток
недоступен, остаётся резервный опрос API. В протокол проверки попадают только
строки, где подтверждены оба сравниваемых значения; записи `NOT_FOUND` и строки
с `null` сохраняются в базе для диагностики, но не выводятся как данные для
сверки.

RabbitMQ в `docker-compose.yml` можно использовать как брокер фоновых заданий,
но он не заменяет канал обновления браузера. Текущий анализ публикует события
прогресса из Node.js в SSE-поток `/api/objects/:id/events`.

Проверка Python-пайплайна в Docker:

```powershell
npm run ai:test
```

Ожидаемый размер `model.safetensors` — примерно **449 МБ**.

## Полезные команды Git LFS

Проверить состояние LFS:

```powershell
git lfs status
```

Показать все LFS-файлы в текущей версии проекта:

```powershell
git lfs ls-files
```

Принудительно скачать LFS-файлы для ветки `main`:

```powershell
git lfs pull origin main
```
