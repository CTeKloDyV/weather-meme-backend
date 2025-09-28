// utils/getMemeByTemp.js
const fs = require('fs');
const path = require('path');

const memesPath = path.join(__dirname, '../data/memes.json');

function getMemeByTemp(temp, baseUrl = 'http://localhost:5000') {
    let memesData;
    try {
        const data = fs.readFileSync(memesPath, 'utf8');
        memesData = JSON.parse(data);
    } catch (err) {
        console.error('Ошибка чтения memes.json:', err.message);
        return null;
    }

    let category = 'normal';
    if (temp >= 30) {
        category = 'hot';
    } else if (temp >= 20) {
        category = 'warm';
    } else if (temp >= 10) {
        category = 'normal';
    } else if (temp >= 0) {
        category = 'cool';
    } else {
        category = 'cold'; // ← всё, что < 10°C → "cold"
    }

    const memes = memesData[category] || memesData.normal || [];
    if (memes.length === 0) return null;

    const randomMeme = memes[Math.floor(Math.random() * memes.length)];

    // Возвращаем ПОЛНЫЙ URL
    return {
        ...randomMeme,
        image: baseUrl + randomMeme.image
    };
}

module.exports = { getMemeByTemp };