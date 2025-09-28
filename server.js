// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { getMemeByTemp } = require('./utils/getMemeByTemp');

const app = express();
const PORT = process.env.PORT || 5000;

// Кэш
const weatherCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 минут

function getCachedWeather(city) {
    const cached = weatherCache.get(city);
    return (cached && Date.now() - cached.timestamp < CACHE_DURATION) ? cached.data : null;
}

function setCachedWeather(city, data) {
    weatherCache.set(city, { data, timestamp: Date.now() });
}

// CORS — разрешаем только фронтенд
const FRONTEND_URL = 'https://weather-meme-frontend.vercel.app';
app.use(cors({ origin: FRONTEND_URL, credentials: true }));

// Статика
app.use('/images', express.static(path.join(__dirname, 'public/images'), {
    setHeaders: (res, filepath) => {
        if (/\.(jpg|jpeg|png)$/i.test(filepath)) {
            res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);
        }
    }
}));

app.use(express.json());

// Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'public/images');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        cb(null, file.mimetype.startsWith('image/'));
    }
});

// Роуты
app.get('/weather', async (req, res) => {
    const { city } = req.query;
    if (!city) return res.status(400).json({ error: 'Город не указан' });

    const cached = getCachedWeather(city);
    if (cached) {
        console.log(`✅ Кэш использован для: ${city}`);
        return res.json(cached);
    }

    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&units=metric&lang=ru&appid=${process.env.OPENWEATHER_API_KEY}`;
        const response = await axios.get(url);
        const data = response.data;

        const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
        const result = {
            city: data.name,
            temperature: Math.round(data.main.temp),
            description: data.weather[0].description,
            icon: data.weather[0].icon,
            wind: { speed: data.wind?.speed || 0, deg: data.wind?.deg || 0 },
            main: { humidity: data.main?.humidity || null },
            timezone: data.timezone,
            dt: data.dt,
            meme: getMemeByTemp(Math.round(data.main.temp), baseUrl)
        };

        setCachedWeather(city, result);
        res.json(result);
    } catch (error) {
        console.error('Ошибка OpenWeatherMap:', error.message);
        if (error.response?.status === 404) return res.status(404).json({ error: 'Город не найден' });
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/memes', upload.single('image'), (req, res) => {
    const { category, text } = req.body;
    const file = req.file;
    if (!category || !text || !file) {
        return res.status(400).json({ error: 'Категория, текст и изображение обязательны' });
    }

    try {
        const imagePath = `/images/${file.filename}`;
        const memesPath = path.join(__dirname, 'data/memes.json');
        let memes = {};
        if (fs.existsSync(memesPath)) memes = JSON.parse(fs.readFileSync(memesPath, 'utf8'));
        if (!memes[category]) memes[category] = [];
        memes[category].push({ image: imagePath, text });
        fs.writeFileSync(memesPath, JSON.stringify(memes, null, 2));
        res.json({ success: true, message: 'Мем добавлен', imagePath });
    } catch (err) {
        console.error('Ошибка сохранения мема:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.delete('/memes/:category/:index', (req, res) => {
    const { category, index } = req.params;
    const idx = parseInt(index, 10);
    if (isNaN(idx)) return res.status(400).json({ error: 'Неверный индекс' });

    try {
        const memesPath = path.join(__dirname, 'data/memes.json');
        const memes = fs.existsSync(memesPath) ? JSON.parse(fs.readFileSync(memesPath, 'utf8')) : {};
        if (!memes[category] || memes[category].length <= idx) return res.status(404).json({ error: 'Мем не найден' });

        const imagePath = memes[category][idx].image;
        if (imagePath.startsWith('/images/')) {
            const fullPath = path.join(__dirname, 'public', imagePath);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        }

        memes[category].splice(idx, 1);
        fs.writeFileSync(memesPath, JSON.stringify(memes, null, 2));
        res.json({ success: true, message: 'Мем удалён' });
    } catch (err) {
        console.error('Ошибка удаления мема:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/memes-list', (req, res) => {
    try {
        const memesPath = path.join(__dirname, 'data/memes.json');
        const memes = fs.existsSync(memesPath) ? JSON.parse(fs.readFileSync(memesPath, 'utf8')) : {};
        res.json(memes);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка загрузки мемов' });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`✅ Бэкенд запущен на порту ${PORT}`);
    });
}

module.exports = app;