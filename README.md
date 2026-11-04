# STUDY AI — Telegram Bot

Telegram-бот для распознавания учебных фотографий, извлечения текста из документов,
кратких конспектов и поиска дополнительных материалов.

## Возможности
- Распознавание фотографий через vision-модель выбранного AI-провайдера (если модель поддерживает изображения).
- Извлечение текста из PDF, DOCX, TXT и MD.
- Краткие конспекты на русском языке.
- Объяснение сложных тем простыми словами.
- Пошаговое решение учебных задач по тексту, фотографии и документу через /solve.
- Поиск до пяти дополнительных источников через Tavily.
- Команды и меню Telegram.
- HTTP health endpoint для Render: /health.

## Локальный запуск
1. Установи Node.js 20 или новее.
2. Создай бота через @BotFather.
3. Скопируй .env.example в .env и заполни ключи.
4. Выполни npm install и npm start.

## Переменные окружения
- BOT_TOKEN — токен Telegram от BotFather.
- AI_PROVIDER — провайдер: openrouter или openai. Для OpenRouter укажи openrouter.
- OPENROUTER_API_KEY — ключ OpenRouter (нужен при AI_PROVIDER=openrouter).
- AI_MODEL — модель; для бесплатного маршрутизатора OpenRouter можно указать openrouter/free.
- OPENAI_API_KEY — ключ OpenAI (нужен только при AI_PROVIDER=openai).
- OPENAI_MODEL — модель OpenAI, по умолчанию gpt-4o-mini.
- TAVILY_API_KEY — ключ интернет-поиска (необязательный, но нужен для /search).
- MAX_FILE_MB — лимит размера файла в мегабайтах, по умолчанию 15.

## Telegram Mini App
В репозитории есть веб-интерфейс Black Glass в папке `public/`. Он использует Telegram Mini App SDK и серверную проверку `initData` перед каждым AI-запросом. Ключи провайдера остаются на сервере.

После публикации на Render добавь переменную `WEBAPP_URL` со значением публичного HTTPS-адреса сервиса, например `https://имя-сервиса.onrender.com`. Затем перезапусти сервис. Команда `/start` покажет кнопку открытия Mini App. Для отдельной кнопки в меню Telegram настрой Menu Button через @BotFather и укажи тот же HTTPS URL.

## Render
Создай Web Service из этого репозитория:
- Build Command: npm install
- Start Command: npm start
- Health Check Path: /health

Для OpenRouter добавь AI_PROVIDER=openrouter, OPENROUTER_API_KEY и AI_MODEL=openrouter/free.
Не добавляй настоящий .env или API-ключи в GitHub.

## Ограничения
- Поддержка изображений зависит от выбранной модели OpenRouter; не каждая бесплатная модель принимает фотографии.
- Сканированные PDF пока не проходят OCR автоматически: отправляй их страницы фотографиями.
- История конспектов и PostgreSQL будут добавлены отдельным этапом.
- Запускай только один экземпляр бота с одним токеном в режиме long polling, иначе Telegram выдаст polling conflict.
