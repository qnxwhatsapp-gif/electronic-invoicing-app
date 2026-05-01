const { app, BrowserWindow } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * Packaged builds often do not set NODE_ENV=production. Using only NODE_ENV
 * makes isDev true and loads localhost:3000 → blank window in MSI/win-unpacked.
 */
function getStartURL() {
  if (app.isPackaged) {
    const indexPath = path.join(__dirname, '../../build/index.html');
    return pathToFileURL(indexPath).href;
  }
  return 'http://localhost:3000';
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: true,
    show: false,
    titleBarStyle: 'default',
  });

  const startURL = getStartURL();

  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('[did-fail-load]', { code, desc, url });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[render-process-gone]', details);
  });

  mainWindow.loadURL(startURL);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (!app.isPackaged && process.env.OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  // Initialize DB
  const db = require('./database');
  db.initialize();

  // Register all IPC handlers
  require('./ipcHandlers')(db);

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
