import path from 'node:path';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import type { Event as ElectronEvent, Rectangle, IpcMainInvokeEvent } from 'electron';
import { loadState, saveState, getCachedState } from './stateManager';
import { AppState } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let currentAlwaysOnTop = true;

const isDev = () => process.env.NODE_ENV === 'development' || !app.isPackaged;

const getWorkAreaSize = () => screen.getPrimaryDisplay().workAreaSize;

const calculateMinimumSize = (alwaysOnTop: boolean) => {
  const { width, height } = getWorkAreaSize();
  const quarterWidth = Math.max(240, Math.floor(width / 4));
  const quarterHeight = Math.max(240, Math.floor(height / 4));
  const relaxedWidth = Math.max(240, Math.floor(width / 6));
  const relaxedHeight = Math.max(240, Math.floor(height / 6));
  return alwaysOnTop
    ? { width: quarterWidth, height: quarterHeight }
    : { width: relaxedWidth, height: relaxedHeight };
};

const applyAlwaysOnTopState = (enabled: boolean) => {
  currentAlwaysOnTop = enabled;
  if (!mainWindow) {
    return;
  }

  const { width: minWidth, height: minHeight } = calculateMinimumSize(enabled);
  mainWindow.setAlwaysOnTop(enabled, 'screen-saver');
  mainWindow.setMinimumSize(minWidth, minHeight);

  if (enabled) {
    const [currentWidth, currentHeight] = mainWindow.getSize();
    const clampedWidth = Math.max(currentWidth, minWidth);
    const clampedHeight = Math.max(currentHeight, minHeight);
    if (clampedWidth !== currentWidth || clampedHeight !== currentHeight) {
      mainWindow.setSize(clampedWidth, clampedHeight);
    }
  }
};

const broadcastWindowState = () => {
  if (!mainWindow) {
    return;
  }

  const state = {
    isMaximized: mainWindow.isMaximized()
  };

  mainWindow.webContents.send('window:state', state);
};

const createMainWindow = async () => {
  const { width: screenWidth, height: screenHeight } = getWorkAreaSize();
  const { width: minWidth, height: minHeight } = calculateMinimumSize(currentAlwaysOnTop);
  const maxWidth = screenWidth;
  const maxHeight = screenHeight;
  const defaultWidth = Math.min(Math.max(minWidth, Math.floor(screenWidth / 3)), maxWidth);
  const defaultHeight = Math.min(Math.max(minHeight, Math.floor(screenHeight / 2)), maxHeight);

  mainWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    alwaysOnTop: currentAlwaysOnTop,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    transparent: true,
    backgroundColor: '#00000000',
    title: 'TimeBound',
    webPreferences: {
      preload: path.join(__dirname, '../../preload/main/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  applyAlwaysOnTopState(currentAlwaysOnTop);

  mainWindow.on('will-resize', (event: ElectronEvent, newBounds: Rectangle) => {
    if (!mainWindow) {
      return;
    }
    const { width: screenMaxWidth, height: screenMaxHeight } = getWorkAreaSize();
    const width = Math.min(newBounds.width, screenMaxWidth);
    const height = Math.min(newBounds.height, screenMaxHeight);
    if (width !== newBounds.width || height !== newBounds.height) {
      event.preventDefault();
      mainWindow.setSize(width, height);
    }
  });

  mainWindow.on('maximize', broadcastWindowState);
  mainWindow.on('unmaximize', broadcastWindowState);
  mainWindow.on('enter-full-screen', broadcastWindowState);
  mainWindow.on('leave-full-screen', broadcastWindowState);

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    await mainWindow.loadURL(devServer);
    if (isDev()) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  mainWindow.webContents.once('did-finish-load', () => {
    broadcastWindowState();
  });
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

  ipcMain.handle('window:setAlwaysOnTop', async (_event: IpcMainInvokeEvent, enabled: boolean) => {
    applyAlwaysOnTopState(Boolean(enabled));
  });

  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    broadcastWindowState();
  });

  ipcMain.handle('window:close', () => {
    if (mainWindow) {
      mainWindow.close();
    }
  });

  ipcMain.handle('window:getState', () => {
    return {
      isMaximized: mainWindow?.isMaximized() ?? false
    };
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
    const initialState = await loadState();
    currentAlwaysOnTop = initialState.preferences?.alwaysOnTop ?? true;
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
