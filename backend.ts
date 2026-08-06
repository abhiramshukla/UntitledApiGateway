import express, { type Request, type Response } from "express";

const app = express();
const PORT = 5001;

app.get('/', (req: Request, res: Response) => {
    console.log(`[Backend] Received request at ${new Date().toISOString()}`);

    res.json({
        message: 'Hello! This is the barebones backend!',
        status: 'ok',
        receivedHeaders: req.headers,
    });
});

app.listen(PORT, () => {
    console.log(`Barebones backend server running on http://localhost:${PORT}`);
})