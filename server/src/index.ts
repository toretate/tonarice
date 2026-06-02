import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 疎通確認(ping)用エンドポイント
app.get('/api/ping', (req, res) => {
    console.log('[Server] Ping request received');
    res.json({
        success: true,
        message: 'pong',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(` Desktop AI Mascot Server is running!`);
    console.log(` URL: http://localhost:${PORT}`);
    console.log(`=========================================`);
});
