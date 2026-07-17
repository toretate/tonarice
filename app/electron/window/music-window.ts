import { BrowserWindow, screen, shell } from 'electron';
import * as path from 'path';

let musicWindow: BrowserWindow | null = null;

export function initMusicWindow() {
    if (musicWindow) return;

    const workArea = screen.getPrimaryDisplay().workArea;
    musicWindow = new BrowserWindow({
        width: 340,
        height: 440,
        x: workArea.x + workArea.width - 360,
        y: workArea.y + 80,
        type: 'toolbar',
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs')
        },
        skipTaskbar: true
    });

    musicWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev && process.env.VITE_DEV_SERVER_URL) {
        musicWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#music`);
    } else {
        const port = process.env.PORT || '3000';
        musicWindow.loadURL(`http://localhost:${port}/#music`);
    }

    musicWindow.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url);
        return { action: 'deny' };
    });

    musicWindow.on('closed', () => {
        musicWindow = null;
    });
}
export function toggleMusicWindow() {
    if (!musicWindow) initMusicWindow();
    if (!musicWindow) return;

    if (musicWindow.isVisible()) {
        musicWindow.hide();
    } else {
        musicWindow.show();
        musicWindow.focus();
    }
}
