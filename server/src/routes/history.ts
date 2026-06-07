import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { authMiddleware } from '../middlewares/auth-middleware';

const router = Router();
const currentCwd = process.cwd();
const baseCwd = path.basename(currentCwd) === 'server' ? path.dirname(currentCwd) : currentCwd;
const HISTORY_PATH = path.join(baseCwd, 'chat_history.json');

// チャット履歴を取得するエンドポイント
router.get('/history', authMiddleware, (req, res) => {
    try {
        console.log('[Server] Load chat history request received');
        if (fs.existsSync(HISTORY_PATH)) {
            const data = fs.readFileSync(HISTORY_PATH, 'utf8');
            return res.json({ success: true, history: JSON.parse(data) });
        } else {
            console.log('[Server] chat_history.json does not exist. Returning empty object.');
            return res.json({ success: true, history: {} });
        }
    } catch (error: any) {
        console.error('[Server] Failed to load chat history:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// チャット履歴を保存するエンドポイント
router.post('/history', authMiddleware, (req, res) => {
    try {
        console.log('[Server] Save chat history request received');
        const history = req.body;
        fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 4), 'utf8');
        console.log('[Server] chat_history.json saved successfully');
        return res.json({ success: true });
    } catch (error: any) {
        console.error('[Server] Failed to save chat history:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
