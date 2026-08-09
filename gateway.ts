import express, { type Request, type Response, type NextFunction } from "express";
import { legacyCreateProxyMiddleware, responseInterceptor } from "http-proxy-middleware";
import { createClient } from "redis";
import client from "prom-client";
import fs from "fs";

const PORT = 8080;
const app = express();

const redisClient = createClient({url: 'redis://127.0.0.1:6379'});
redisClient.on('error', (err) => console.error('Redis Client Error', err));

client.collectDefaultMetrics();

const cacheMetrics = new client.Counter({
    name: 'gateway_cache_operations_total',
    help: 'Total cache hits and misses',
    labelNames: ['result']
});

const circuitBreakerMetrics = new client.Counter({
    name: 'gateway_cache_operations_total',
    help: 'Total cache hits and misses',
    labelNames: ['route']
});

const responseTimeHistogram = new client.Histogram({
    name: 'gateway_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
});

const metricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const end = responseTimeHistogram.startTimer();

    res.on('finish', () => {
        const route = req.originalUrl.split('?')[0] || ""; //Fallback to ensure typesafety
        end({ method: req.method, route: route, status_code: res.statusCode });
    });

    next();
}

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

enum CircuitState { CLOSED, OPEN, HALF_OPEN }

/* 
NOTE TO SELF:
After adding the Load Balancing Logic, it would make more sense to have the 
separate circuit breakers for EVERY INDIVIDUAL target inside the array.
*/
class CircuitBreaker {
    state: CircuitState = CircuitState.CLOSED;
    failureCount = 0;
    failureThreshold = 3;
    resetTimeout = 15000;
    nextAttempt = Date.now();

    middleware = (req: Request, res: Response, next: NextFunction) => {
        if (this.state === CircuitState.OPEN) {
            if (Date.now() > this.nextAttempt) {
                this.state = CircuitState.HALF_OPEN;
                console.log(`Circuit Half Open: Testing Backend`);
            } else {
                res.status(503).json({ error: 'Existence is pain, and apparently so is this server'});
                return;
            }
        }

        next();
    };

    onSuccess() {
        if (this.state !== CircuitState.CLOSED) console.log('Circuit is CLOSED, backend recovered');
        this.failureCount = 0;
        this.state = CircuitState.CLOSED;
    }

    onFailure() {
        this.failureCount++;
        console.log(`Backend failure ${this.failureCount}/${this.failureThreshold}`);
        if (this.failureCount >= this.failureThreshold && this.state === CircuitState.CLOSED) {
            this.state = CircuitState.OPEN;
            this.nextAttempt = Date.now() + this.resetTimeout;
            circuitBreakerMetrics.inc({ route: 'dynamic_route' });
            console.log(`Circuit Tripped! Pausing traffic.`);
        } else if (this.state === CircuitState.HALF_OPEN) {
            this.state = CircuitState.OPEN;
            this.nextAttempt = Date.now() + this.resetTimeout;
            console.log(`Circuit test failed. Re-opening.`);
        }
    }
}

const CACHE_TTL = 30;

const cacheMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if(req.method !== 'GET') {
        return next();
    }

    const cacheKey = `cache:${req.originalUrl}`;

    try {
        const cachedData = await redisClient.get(cacheKey);

        if(cachedData) {
            console.log(`[Cache Hit] Serving ${req.originalUrl} from Redis`);
            cacheMetrics.inc({ result: 'hit' });
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Content-Type', 'application/json');
            res.send(cachedData);
            return;
        }

        console.log(`[Cache Miss] Fetching ${req.originalUrl} from Backend`);
        cacheMetrics.inc({ result: 'miss' });
        res.setHeader('X-Cache', 'MISS');
        next();
    } catch (err) {
        console.error('Cache Error: ', err);
        next();
    }
};

const setupDynamicRoutes = () => {
    const routesRaw = fs.readFileSync('./routes.json', 'utf-8');
    const routes = JSON.parse(routesRaw);

    for (const [path, config] of Object.entries(routes)) {
        const routeConfig = config as { targets: string[], rewritePrefix: string };
        const breaker = new CircuitBreaker();

        let currentIndex = 0;
        
        // V3 Migration is a task and a half, keeping it this way for the time being.
        const proxy = legacyCreateProxyMiddleware({
            target: routeConfig.targets[0],
            changeOrigin: true,
            pathRewrite: { [`^${path}`]: routeConfig.rewritePrefix },
            router: (req) => {
                const target = routeConfig.targets[currentIndex];
                currentIndex = (currentIndex + 1) % routeConfig.targets.length;
                console.log(`[Load Balancer] Routing Request to: ${target}`);
                return target;
            },
            selfHandleResponse: true,
            onError: (err, req, res) => {
                breaker.onFailure();
                const altRes = res as Response; // Courtesy http-proxy-middleware version 3.x
                altRes.status(502).json({ error: 'I have consulted the gateway. It has failed us.' });
            },
            onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req: Request, res) => {
                if (proxyRes.statusCode && proxyRes.statusCode >= 500) {
                    breaker.onFailure();
                } else {
                    breaker.onSuccess();
                }

                if (proxyRes.statusCode === 200 && req.method === 'GET') {
                    const responseString = responseBuffer.toString('utf8');
                    const cacheKey = `cache:${req.originalUrl}`;

                    await redisClient.setEx(cacheKey, CACHE_TTL, responseString);
                    console.log(`[Cache Stored] Saved Response for ${req.originalUrl}`);
                }
                return responseBuffer;
            })
        });

        app.use(path, breaker.middleware, proxy);
        console.log(`Mapped ${path} -> Load Balancing across ${routeConfig.targets.length} targets`);
    }
}

const startGateway = async () => {
    await redisClient.connect();
    console.log('Connected to Redis');

    

    app.use(metricsMiddleware);
    app.get('/metric', async (req: Request, res: Response) => {
        res.set('Content-Type', client.register.contentType);
        res.send(await client.register.metrics());
    })

    app.use(authMiddleware);
    app.use(redisRateLimiter);
    app.use(cacheMiddleware);

    setupDynamicRoutes();

    app.listen(PORT, () => {
        console.log(`UntitledAPIGateway running on http://localhost:${PORT}`);
        console.log(`Metrics available at http://localhost:${PORT}/metrics`);
    });

};

startGateway();