import express, { type Request, type Response, type NextFunction } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();
const PORT = 8080;

const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = req.headers['x-api-key'];
    const VALID_KEY = 'wubba-lubba-dub-dub';

    if(!apiKey || apiKey !== VALID_KEY) {
        res.status(401).json({ error: '401 Unauthorized - Credentials or Consequences. Mostly credentials.'});
        return;
    }

    next();
}

const requestCounts = new Map<string, number>();
const RATE_LIMIT = 5;

const rateLimiter = (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || 'unknown';
    const currentCount = requestCounts.get(ip) || 0;

    if (currentCount >= RATE_LIMIT) {
        res.status(429).json({ error: '429 Too Many Requests - O-oh jeez... The server is trying its best. Maybe slow down a little.'});
        return;
    }

    requestCounts.set(ip, currentCount + 1);
    next();
};

setInterval(() => requestCounts.clear, 60000);

const apiProxy = createProxyMiddleware({
    target: 'http://localhost:5001',
    changeOrigin: true,
    pathRewrite: {
        '^/api': '',
    },
});

app.use('/api', authMiddleware, rateLimiter, apiProxy);

app.listen(PORT, () => {
    console.log(`UntitledAPIGateway running on http://localhost:${PORT}`);
});