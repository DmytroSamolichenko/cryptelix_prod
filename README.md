# Cryptelix

Платформа для обліку крипто-угод, дашбордів і AI-асистента. Монорепозиторій:

- **`crptelix_web`** — клієнт (React, Vite)
- **`cryptelix_app`** — API (FastAPI, PostgreSQL)

## Локальний запуск

1. PostgreSQL і змінні середовища — у `cryptelix_app/.env`. Файл у репозиторій не потрапляє.
2. Бекенд: залежності з `cryptelix_app/requirements.txt`, далі з каталогу `cryptelix_app`:

   ```bash
   python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
   ```

3. Фронт: у `crptelix_web` — `npm install`, `npm run dev`. Vite проксує `/api` на порт 8000.

## Безпека

Не комітьте `.env`, `.env.local` і ключі API. Секрети лишаються локально або в secret manager на проді.
