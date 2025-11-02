import path from 'node:path';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import type { Event as ElectronEvent, Rectangle, IpcMainInvokeEvent } from 'electron';
import { loadState, saveState, getCachedState } from './stateManager';
import { AppState } from '../shared/types';

let mainWindow: BrowserWindow | null = null;

const isDev = () => process.env.NODE_ENV === 'development' || !app.isPackaged;

const createMainWindow = async () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const maxWidth = Math.max(320, Math.floor(screenWidth / 4));
  const maxHeight = Math.max(320, Math.floor(screenHeight / 4));
  const defaultWidth = Math.min(400, maxWidth);
  const defaultHeight = Math.min(560, maxHeight);

  mainWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth: 280,
    minHeight: 320,
    maxWidth,
    maxHeight,
    resizable: true,
    maximizable: false,
    alwaysOnTop: true,
    title: 'TimeBound',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.on('will-resize', (event: ElectronEvent, newBounds: Rectangle) => {
    if (!mainWindow) {
      return;
    }
    const width = Math.min(newBounds.width, maxWidth);
    const height = Math.min(newBounds.height, maxHeight);
    if (width !== newBounds.width || height !== newBounds.height) {
      event.preventDefault();
      mainWindow.setSize(width, height);
    }
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    await mainWindow.loadURL(devServer);
    if (isDev()) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
};

const registerIpc = () => {
  ipcMain.handle('state:load', async (_event: IpcMainInvokeEvent) => {
    const cached = getCachedState();
    if (cached) {
      return cached;
    }
    return loadState();
  });

  ipcMain.handle('state:save', async (_event: IpcMainInvokeEvent, state: AppState) => {
    return saveState(state);
  });

  ipcMain.handle('app:quit', () => {
    app.quit();
  });
};

const setupApp = () => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    registerIpc();
    await loadState();
    await createMainWindow();
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
};

setupApp();
