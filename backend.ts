import express, { type Request, type Response } from "express";

const app = express();
const PORT = process.env.PORT || 5001;

app.get('/', (req: Request, res: Response) => {
    console.log(`[Backend ${PORT}] Received request at ${new Date().toISOString()}`);

    res.json({
        message: `Hello! This is the barebones backend! Running on port ${PORT}`,
        status: 'ok',
        servedBy: `localhost: ${PORT}`,
        receivedHeaders: req.headers,
    });
});

app.listen(PORT, () => {
    console.log(`Barebones backend server running on http://localhost:${PORT}`);
})