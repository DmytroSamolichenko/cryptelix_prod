# Cryptelix

Платформа для обліку крипто-угод, дашбордів і AI-асистента. Монорепозиторій:

- **`crptelix_web`** — клієнт (React, Vite)
- **`cryptelix_app`** — API (FastAPI, PostgreSQL)

## Локальний запуск (скорочено)

1. PostgreSQL і змінні середовища — скопіюй `cryptelix_app/.env` з власними значеннями (файл у репозиторій не потрапляє).
2. Бекенд: встановити залежності з `cryptelix_app/requirements.txt`, запустити `main.py` (або uvicorn за вашим скриптом).
3. Фронт: у `crptelix_web` — `npm install`, `npm run dev`.

Деталі й версії залежностей — у `package.json` та `requirements.txt`.

## Безпека

Не комітьте `.env` і ключі API. У репозиторії лише `.gitignore`; секрети — локально або в secret manager на проді.
