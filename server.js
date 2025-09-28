require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Импорт логики мемов
const { getMemeByTemp } = require('./utils/getMemeByTemp');

const app = express();
// Кэш погоды: { "Moscow": { data, timestamp } }
const weatherCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 минут

function getCachedWeather(city) {
    const cached = weatherCache.get(city);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    return null;
}

function setCachedWeather(city, data) {
    weatherCache.set(city, {
        data,
        timestamp: Date.now()
    });
}
const PORT = process.env.PORT || 5000;

// CORS — разрешаем фронтенду
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
}));

app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, path) => {
        if (/\.(jpg|jpeg|png|gif)$/i.test(path)) {
            res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
        }
    }
}));

// Для парсинга JSON
app.use(express.json());

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'public/images');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const uniqueName = `${Date.now()}${ext}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 МБ
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Только изображения!'), false);
        }
    }
});

// Логируем API-ключ при старте
console.log('API Key:', process.env.OPENWEATHER_API_KEY);

// Роут: получение погоды + мема
app.get('/weather', async (req, res) => {
    const { city } = req.query;
    if (!city) {
        return res.status(400).json({ error: 'Город не указан' });
    }

    // Проверка кэша
    const cached = getCachedWeather(city);
    if (cached) {
        console.log(`✅ Кэш использован для: ${city}`);
        return res.json(cached);
    }

    try {
        const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?q=${city}&units=metric&lang=ru&appid=${process.env.OPENWEATHER_API_KEY}`;
        const response = await axios.get(weatherUrl);
        const data = response.data;

        const baseUrl = `http://localhost:${PORT}`;
        const result = {
            city: data.name,
            temperature: Math.round(data.main.temp),
            description: data.weather[0].description,
            icon: data.weather[0].icon,
            wind: {
                speed: data.wind?.speed || 0,
                deg: data.wind?.deg || 0
            },
            main: {
                humidity: data.main?.humidity || null,
                pressure: data.main?.pressure || null
            },
            timezone: data.timezone,
            dt: data.dt,
            meme: getMemeByTemp(Math.round(data.main.temp), baseUrl)
        };

        // Сохраняем в кэш
        setCachedWeather(city, result);
        res.json(result);
    } catch (error) {
        console.error('Ошибка OpenWeatherMap:', error.message);
        if (error.response?.status === 404) {
            return res.status(404).json({ error: 'Город не найден' });
        }
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Роут: добавление мема (админка)
app.post('/memes', upload.single('image'), (req, res) => {
    const { category, text } = req.body;
    const file = req.file;

    if (!category || !text) {
        return res.status(400).json({ error: 'Категория и текст обязательны' });
    }
    if (!file) {
        return res.status(400).json({ error: 'Изображение обязательно' });
    }

    try {
        const imagePath = `/images/${file.filename}`;
        const memesPath = path.join(__dirname, 'data/memes.json');
        let memes = {};

        if (fs.existsSync(memesPath)) {
            memes = JSON.parse(fs.readFileSync(memesPath, 'utf8'));
        }

        if (!memes[category]) memes[category] = [];
        memes[category].push({ image: imagePath, text });

        fs.writeFileSync(memesPath, JSON.stringify(memes, null, 2));
        res.json({ success: true, message: 'Мем добавлен', imagePath });
    } catch (err) {
        console.error('Ошибка сохранения мема:', err);
        res.status(500).json({ error: 'Ошибка сервера при сохранении' });
    }
});
// Удаление мема по индексу и категории
app.delete('/memes/:category/:index', (req, res) => {
    const { category, index } = req.params;
    const idx = parseInt(index, 10);

    if (isNaN(idx)) {
        return res.status(400).json({ error: 'Неверный индекс' });
    }

    try {
        const memesPath = path.join(__dirname, 'data/memes.json');
        let memes = {};

        if (fs.existsSync(memesPath)) {
            memes = JSON.parse(fs.readFileSync(memesPath, 'utf8'));
        }

        if (!memes[category] || memes[category].length <= idx) {
            return res.status(404).json({ error: 'Мем не найден' });
        }

        // Удаляем файл изображения (опционально)
        const imagePath = memes[category][idx].image;
        if (imagePath.startsWith('/images/')) {
            const fullPath = path.join(__dirname, 'public', imagePath);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        }

        // Удаляем мем из массива
        memes[category].splice(idx, 1);

        fs.writeFileSync(memesPath, JSON.stringify(memes, null, 2));
        res.json({ success: true, message: 'Мем удалён' });
    } catch (err) {
        console.error('Ошибка удаления мема:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});
// Получить все мемы (для админки)
app.get('/memes-list', (req, res) => {
    try {
        const memesPath = path.join(__dirname, 'data/memes.json');
        let memes = {};
        if (fs.existsSync(memesPath)) {
            memes = JSON.parse(fs.readFileSync(memesPath, 'utf8'));
        }
        res.json(memes);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка загрузки мемов' });
    }
});
// Экспорт для тестов
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`✅ Бэкенд запущен на http://localhost:${PORT}`);
    });
}

module.exports = app;