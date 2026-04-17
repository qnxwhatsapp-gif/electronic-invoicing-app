/*
  Export SQLite data to JSON files for PostgreSQL migration.

  Usage:
    node scripts/export-sqlite.js
    node scripts/export-sqlite.js --db "C:/path/to/invoicing.db"
    node scripts/export-sqlite.js --out "./exports/sqlite-export"
*/

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

function parseArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function defaultDbPath() {
  const appName = 'electronic-invoicing-app';
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, appName, 'invoicing.db');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName, 'invoicing.db');
  }
  return path.join(os.homedir(), '.config', appName, 'invoicing.db');
}

const dbPath = parseArg('--db', defaultDbPath());
const outRoot = parseArg('--out', path.join(process.cwd(), 'exports', `sqlite-export-${Date.now()}`));

const tables = [
  'company_profile',
  'branches',
  'permissions',
  'user_roles',
  'users',
  'role_permissions',
  'user_permissions',
  'categories',
  'products',
  'customers',
  'accounts',
  'vendors',
  'invoices',
  'invoice_items',
  'return_exchange',
  'return_exchange_items',
  'purchase_invoices',
  'purchase_invoice_items',
  'purchase_returns',
  'purchase_return_items',
  'pay_bills',
  'banking_transactions',
  'expenses',
  'backups',
  'app_settings',
  'invoice_settings',
  'notifications',
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function tableExists(db, table) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table);
  return !!row;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function main() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite file not found: ${dbPath}`);
  }

  ensureDir(outRoot);
  const db = new Database(dbPath, { readonly: true });

  const manifest = {
    exported_at: new Date().toISOString(),
    sqlite_db_path: dbPath,
    tables: {},
  };

  for (const table of tables) {
    if (!tableExists(db, table)) {
      manifest.tables[table] = { exists: false, rows: 0, file: null };
      continue;
    }

    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    const fileName = `${table}.json`;
    const filePath = path.join(outRoot, fileName);
    writeJson(filePath, rows);

    manifest.tables[table] = {
      exists: true,
      rows: rows.length,
      file: fileName,
    };

    console.log(`${table}: ${rows.length} row(s)`);
  }

  writeJson(path.join(outRoot, 'manifest.json'), manifest);
  db.close();

  console.log('\nExport complete.');
  console.log(`Output folder: ${outRoot}`);
}

try {
  main();
} catch (err) {
  console.error(`Export failed: ${err.message}`);
  process.exit(1);
}
