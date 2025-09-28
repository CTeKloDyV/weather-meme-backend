const request = require('supertest');
const app = require('../server');

describe('GET /weather', () => {
    it('should return weather data for a valid city', async () => {
        const res = await request(app)
            .get('/weather?city=Moscow')
            .expect(200);

        expect(res.body).toHaveProperty('city');
        expect(res.body).toHaveProperty('temperature');
        expect(res.body).toHaveProperty('meme');
        expect(typeof res.body.temperature).toBe('number');
    });

    it('should return 400 if city is missing', async () => {
        const res = await request(app)
            .get('/weather')
            .expect(400);

        expect(res.body).toEqual({ error: 'Город не указан' });
    });
});