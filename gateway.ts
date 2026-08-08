import express, { type Request, type Response, type NextFunction } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { createClient } from "redis";

const PORT = 8080;

const redisClient = createClient({url: 'redis://127.0.0.1:6379'});
redisClient.on('error', (err) => console.error('Redis Client Error', err));

const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = req.headers['x-api-key'];
    const VALID_KEY = 'wubba-lubba-dub-dub';

    if(!apiKey || apiKey !== VALID_KEY) {
        res.status(401).json({ error: 'Credentials or Consequences. Mostly credentials.'});
        return;
    }

    next();
}

const RATE_LIMIT = 5;
const WINDOW_SECONDS = 60;

const redisRateLimiter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const ip = req.ip || 'unknown';
        const redisKey =  `rate_limit:${ip}`;

        const currentRequests = await redisClient.incr(redisKey);

        if (currentRequests === 1) {
            await redisClient.expire(redisKey, WINDOW_SECONDS);
        }

        if (currentRequests > RATE_LIMIT) {
            res.status(429).json({ error: 'O-oh jeez... The server is trying its best. Maybe slow down a little.'});
            return;
        }

        next();
    } catch (error) {
        console.error('Rate Limiter Error:', error);
        res.status(500).json({ error: 'Oh man, this is bad. Maybe try refreshing? Sorry'});
    }
};

const apiProxy = createProxyMiddleware({
    target: 'http://localhost:5001',
    changeOrigin: true,
    pathRewrite: {
        '^/api': '',
    },
});

const startGateway = async () => {
    await redisClient.connect();
    console.log('Connected to Redis');

    const app = express();

    app.use('/api', authMiddleware, redisRateLimiter, apiProxy);

    app.listen(PORT, () => {
        console.log(`UntitledAPIGateway running on http://localhost:${PORT}`);
    });

};

startGateway();