/*
  Import exported SQLite JSON files into PostgreSQL.

  Usage:
    node scripts/import-postgres.js --dir "./exports/sqlite-export-<timestamp>"

  Connection:
    Uses DATABASE_URL environment variable, e.g.
    postgresql://user:password@localhost:5432/invoicing
*/

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function parseArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function readJson(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function inferLatestExportDir() {
  const root = path.join(process.cwd(), 'exports');
  if (!fs.existsSync(root)) return null;
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('sqlite-export-'))
    .map(d => ({ name: d.name, full: path.join(root, d.name), ts: fs.statSync(path.join(root, d.name)).mtimeMs }))
    .sort((a, b) => b.ts - a.ts);
  return dirs[0]?.full || null;
}

function sqliteIntToBool(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  return Number(value) === 1;
}

async function insertRows(client, table, rows, transformRow) {
  if (!rows || rows.length === 0) {
    console.log(`${table}: 0 row(s)`);
    return;
  }

  for (const original of rows) {
    const row = transformRow ? transformRow(original) : original;
    const cols = Object.keys(row);
    const values = Object.values(row);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
    await client.query(sql, values);
  }

  console.log(`${table}: ${rows.length} row(s)`);
}

async function resetSequences(client, tables) {
  for (const table of tables) {
    const seqResult = await client.query(
      `SELECT pg_get_serial_sequence($1, 'id') AS seq_name`,
      [table]
    );
    const seqName = seqResult.rows[0]?.seq_name;
    if (!seqName) continue;
    await client.query(
      `SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`,
      [seqName]
    );
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  const importDir = parseArg('--dir', inferLatestExportDir());
  if (!importDir || !fs.existsSync(importDir)) {
    throw new Error('Export directory not found. Pass --dir with a valid path.');
  }

  const manifestPath = path.join(importDir, 'manifest.json');
  const manifest = readJson(manifestPath, null);
  if (!manifest) {
    throw new Error(`manifest.json not found in ${importDir}`);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('BEGIN');

    // Parent/master tables
    await insertRows(client, 'company_profile', readJson(path.join(importDir, 'company_profile.json')));
    await insertRows(client, 'branches', readJson(path.join(importDir, 'branches.json')), row => ({ ...row, is_active: sqliteIntToBool(row.is_active) }));
    await insertRows(client, 'permissions', readJson(path.join(importDir, 'permissions.json')));
    await insertRows(client, 'user_roles', readJson(path.join(importDir, 'user_roles.json')), row => ({ ...row, is_system: sqliteIntToBool(row.is_system) }));
    await insertRows(client, 'users', readJson(path.join(importDir, 'users.json')), row => {
      const out = { ...row };
      out.password_hash = out.password;
      delete out.password;
      out.is_active = sqliteIntToBool(out.is_active);
      return out;
    });
    await insertRows(client, 'role_permissions', readJson(path.join(importDir, 'role_permissions.json')), row => ({ ...row, granted: sqliteIntToBool(row.granted) }));
    await insertRows(client, 'user_permissions', readJson(path.join(importDir, 'user_permissions.json')), row => ({ ...row, granted: sqliteIntToBool(row.granted) }));
    await insertRows(client, 'categories', readJson(path.join(importDir, 'categories.json')));
    await insertRows(client, 'products', readJson(path.join(importDir, 'products.json')), row => ({ ...row, is_active: sqliteIntToBool(row.is_active) }));
    await insertRows(client, 'customers', readJson(path.join(importDir, 'customers.json')));
    await insertRows(client, 'accounts', readJson(path.join(importDir, 'accounts.json')), row => ({
      ...row,
      is_primary: sqliteIntToBool(row.is_primary),
      is_active: sqliteIntToBool(row.is_active),
    }));
    await insertRows(client, 'vendors', readJson(path.join(importDir, 'vendors.json')));

    // Core transaction tables
    await insertRows(client, 'invoices', readJson(path.join(importDir, 'invoices.json')), row => ({
      ...row,
      is_credit_sale: sqliteIntToBool(row.is_credit_sale),
    }));
    await insertRows(client, 'invoice_items', readJson(path.join(importDir, 'invoice_items.json')));
    await insertRows(client, 'return_exchange', readJson(path.join(importDir, 'return_exchange.json')));
    await insertRows(client, 'return_exchange_items', readJson(path.join(importDir, 'return_exchange_items.json')));
    await insertRows(client, 'purchase_invoices', readJson(path.join(importDir, 'purchase_invoices.json')));
    await insertRows(client, 'purchase_invoice_items', readJson(path.join(importDir, 'purchase_invoice_items.json')));
    await insertRows(client, 'purchase_returns', readJson(path.join(importDir, 'purchase_returns.json')));
    await insertRows(client, 'purchase_return_items', readJson(path.join(importDir, 'purchase_return_items.json')));
    await insertRows(client, 'pay_bills', readJson(path.join(importDir, 'pay_bills.json')));
    await insertRows(client, 'banking_transactions', readJson(path.join(importDir, 'banking_transactions.json')));
    await insertRows(client, 'expenses', readJson(path.join(importDir, 'expenses.json')));
    await insertRows(client, 'backups', readJson(path.join(importDir, 'backups.json')));
    await insertRows(client, 'notifications', readJson(path.join(importDir, 'notifications.json')), row => ({ ...row, is_read: sqliteIntToBool(row.is_read) }));

    // Settings tables
    await insertRows(client, 'app_settings', readJson(path.join(importDir, 'app_settings.json')));
    await insertRows(client, 'invoice_settings', readJson(path.join(importDir, 'invoice_settings.json')), row => ({
      ...row,
      show_customer_phone: sqliteIntToBool(row.show_customer_phone),
      show_customer_email: sqliteIntToBool(row.show_customer_email),
      show_customer_gstin: sqliteIntToBool(row.show_customer_gstin),
      show_due_date: sqliteIntToBool(row.show_due_date),
      show_po_number: sqliteIntToBool(row.show_po_number),
      show_hsn: sqliteIntToBool(row.show_hsn),
      show_discount: sqliteIntToBool(row.show_discount),
      show_tax_breakdown: sqliteIntToBool(row.show_tax_breakdown),
      show_bank_details: sqliteIntToBool(row.show_bank_details),
      custom_fields: row.custom_fields ? JSON.parse(row.custom_fields) : [],
    }));

    await resetSequences(client, [
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
      'notifications',
    ]);

    await client.query('COMMIT');
    console.log('\nImport complete.');
    console.log(`Source folder: ${importDir}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(`Import failed: ${err.message}`);
  process.exit(1);
});
