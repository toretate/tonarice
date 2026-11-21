import { BrowserWindow } from 'electron';
import { attachRendererConsoleLogger } from './renderer-console-logger';
import * as path from 'path';

let tasksWindow: BrowserWindow | null = null;
let appConfig: any = null;
let isDevMode = false;

export function initTasksWindow(config: any, isDev: boolean) {
    appConfig = config;
    isDevMode = isDev;
}

export function getTasksWindow(): BrowserWindow | null {
    return tasksWindow;
}

export function createTasksWindow(): BrowserWindow {
    if (tasksWindow && !tasksWindow.isDestroyed()) {
        return tasksWindow;
    }

    const defaultWidth = 360;
    const defaultHeight = 550;

    tasksWindow = new BrowserWindow({
        width: defaultWidth,
        height: defaultHeight,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        resizable: true,
        hasShadow: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    attachRendererConsoleLogger(tasksWindow.webContents, 'Tasks');

    tasksWindow.setAlwaysOnTop(true, 'screen-saver');

    if (isDevMode) {
        const devUrl = process.env.VITE_DEV_SERVER_URL!;
        tasksWindow.loadURL(`${devUrl}#tasks`);
    } else {
        const port = process.env.PORT || '3000';
        tasksWindow.loadURL(`http://localhost:${port}/#tasks`);
    }

    tasksWindow.on('closed', () => {
        tasksWindow = null;
    });

    return tasksWindow;
}

export function toggleTasksWindow() {
    if (tasksWindow && !tasksWindow.isDestroyed()) {
        if (tasksWindow.isVisible()) {
            tasksWindow.hide();
        } else {
            tasksWindow.show();
            tasksWindow.focus();
        }
    } else {
        const win = createTasksWindow();
        win.once('ready-to-show', () => {
            win.show();
            win.focus();
        });
    }
}
