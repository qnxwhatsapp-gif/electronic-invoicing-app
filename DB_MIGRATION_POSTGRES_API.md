# Database Migration Guide (SQLite -> PostgreSQL + Server API)

This document helps migrate the current Electron + SQLite app to a server-based API architecture using PostgreSQL.

## 1) Current Architecture (Source)

- Database: local SQLite (`better-sqlite3`)
- Access pattern: Renderer -> `window.electron.invoke(...)` -> `ipcMain.handle(...)` -> SQL
- Schema definition and seed: `src/main/database.js`
- Query/business logic: `src/main/ipcHandlers.js`

## 2) Target Architecture (Destination)

- Database: PostgreSQL (hosted)
- Backend: REST API (Node.js/Express or NestJS)
- Frontend: React calls HTTP API (or React Query) instead of Electron IPC
- Auth: JWT/session tokens on backend
- Migrations: SQL files or ORM migrations (Prisma/Knex/TypeORM)

Recommended target flow:

`React UI -> API Client -> Auth Middleware -> Service Layer -> PostgreSQL`

## 3) Core Migration Strategy

1. Freeze schema contract in one place (this doc + migration SQL).
2. Build PostgreSQL schema and constraints.
3. Export existing SQLite data.
4. Transform data types and IDs where needed.
5. Import into PostgreSQL.
6. Replace IPC handlers with API endpoints.
7. Run dual verification (old IPC outputs vs new API outputs).
8. Cut over clients to API.

## 4) SQLite to PostgreSQL Type Mapping

- `INTEGER PRIMARY KEY AUTOINCREMENT` -> `BIGSERIAL PRIMARY KEY`
- `INTEGER` flags (`0/1`) -> `BOOLEAN` (preferred) or `SMALLINT`
- `REAL` -> `NUMERIC(14,2)` for money
- `TEXT` dates -> `DATE` (if date only) or `TIMESTAMPTZ`
- `TEXT` enums/status -> `TEXT` + `CHECK` or PostgreSQL enum type

Money fields should use `NUMERIC`, not float.

## 5) Table Inventory to Migrate

Main business tables from current project:

- `company_profile`
- `branches`
- `user_roles`
- `users`
- `permissions`
- `role_permissions`
- `user_permissions`
- `categories`
- `products`
- `customers`
- `accounts`
- `invoices`
- `invoice_items`
- `return_exchange`
- `return_exchange_items`
- `vendors`
- `purchase_invoices`
- `purchase_invoice_items`
- `purchase_returns`
- `purchase_return_items`
- `pay_bills`
- `banking_transactions`
- `expenses`
- `backups`
- `invoice_settings`
- `notifications`
- `app_settings`

## 6) Suggested PostgreSQL DDL Pattern (Example)

Example for a few critical tables:

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  mobile TEXT,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Billing Operator',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  avatar_path TEXT,
  branch_id BIGINT REFERENCES branches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  category_id BIGINT REFERENCES categories(id),
  unit TEXT DEFAULT 'Piece',
  hsn_code TEXT,
  purchase_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  selling_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  opening_stock INTEGER NOT NULL DEFAULT 0,
  current_stock INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 10,
  barcode TEXT,
  status TEXT NOT NULL DEFAULT 'Good',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  branch_id BIGINT REFERENCES branches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id BIGSERIAL PRIMARY KEY,
  invoice_no TEXT UNIQUE NOT NULL,
  invoice_date DATE NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  seller_id BIGINT REFERENCES users(id),
  branch_id BIGINT REFERENCES branches(id),
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_mode TEXT NOT NULL DEFAULT 'Cash',
  cash_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  online_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  internal_notes TEXT,
  status TEXT NOT NULL DEFAULT 'Draft',
  type TEXT NOT NULL DEFAULT 'Sale',
  is_credit_sale BOOLEAN NOT NULL DEFAULT FALSE,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 7) Data Export from SQLite

Use one of these approaches:

- Scripted export (`better-sqlite3` + Node) to JSON/CSV per table
- SQLite shell dumps

Recommended: JSON export script preserving IDs and FK values.

Export order (parent -> child):

1. branches, user_roles, permissions
2. users, role_permissions, user_permissions
3. categories, products, customers, accounts, vendors
4. invoices -> invoice_items
5. return_exchange -> return_exchange_items
6. purchase_invoices -> purchase_invoice_items
7. purchase_returns -> purchase_return_items
8. pay_bills, banking_transactions, expenses
9. settings/support tables

## 8) Import into PostgreSQL

- Disable/deferrable FK checks during bulk load if needed.
- Insert in the same parent-child order.
- Reset sequences after manual ID inserts:

```sql
SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 1) FROM users), true);
```

Run for each serial table.

## 9) IPC to API Endpoint Mapping

Current IPC channels in `src/main/ipcHandlers.js` should become API endpoints.

Examples:

- `auth:login` -> `POST /api/auth/login`
- `users:getAll` -> `GET /api/users`
- `users:create` -> `POST /api/users`
- `users:update` -> `PATCH /api/users/:id`
- `users:updatePassword` -> `PATCH /api/users/:id/password`
- `products:getAll` -> `GET /api/products`
- `products:create` -> `POST /api/products`
- `products:importCSV` -> `POST /api/products/import`
- `invoices:create` -> `POST /api/invoices`
- `invoices:getAll` -> `GET /api/invoices`
- `reports:*` -> `GET /api/reports/...`
- `settings:saveAll` -> `PUT /api/settings`

## 10) Business Rules to Keep During Migration

Must preserve:

- Invoice number generation format
- Stock update side effects on sales/purchases/returns
- Credit sale logic and paid_amount handling
- Permission resolution order (user overrides role defaults)
- Return window/Completed behavior (where implemented)
- Backup/audit logging behavior

Move these rules from renderer/Electron to backend service layer.

## 11) Security and Auth Upgrades

- Store password hashes only (`bcrypt`)
- Use backend-side authorization checks for every write endpoint
- Enforce row-level/branch-level filtering in API (not only UI)
- Add request validation (Zod/Joi/class-validator)
- Add rate limits on auth endpoints

## 12) Recommended Backend Stack

- Node.js + Express (or NestJS)
- PostgreSQL
- Query layer:
  - Prisma (fast to iterate), or
  - Knex/SQL if you need SQL-level control
- Validation: Zod
- Auth: JWT + refresh strategy
- Tests: Jest + Supertest

## 13) Migration Execution Plan (Phased)

### Phase A - Database

1. Create PostgreSQL schema migration files.
2. Generate a data export script for SQLite.
3. Load into PostgreSQL staging.
4. Validate row counts and FK integrity.

### Phase B - API

1. Implement auth/users/products/invoices endpoints.
2. Port reporting queries.
3. Port settings and invoice designer endpoints.
4. Add branch/user permission enforcement in backend.

### Phase C - Frontend Cutover

1. Introduce API client abstraction.
2. Replace `window.electron.invoke` calls module by module.
3. Add error handling/retry for network failures.
4. Remove old IPC-only logic when stable.

### Phase D - Verification and Rollout

1. Compare key reports (sales/profit/stock) old vs new.
2. Run UAT with real workflows.
3. Roll out with backups and rollback plan.

## 14) Data Validation Checklist

After import, verify:

- Counts per table match SQLite
- Sum checks:
  - `SUM(invoices.grand_total)`
  - `SUM(invoice_items.amount)`
  - stock quantity totals
  - account balances
- Random sample invoice integrity (header/items/totals)
- Login works for all roles
- Permission matrix behavior is identical

## 15) Notes About Existing Project

- Some fields are stored as text dates in SQLite; normalize to `DATE`/`TIMESTAMPTZ`.
- Some status/payment values include legacy options (`UPI`, `EFT`) in existing data. Keep compatibility in migration scripts even if UI is now restricted.
- `app_settings` is key-value text; consider typed settings tables later.

---

If needed, next step is to create:

- `server/schema.sql` (PostgreSQL DDL)
- `scripts/export-sqlite.js`
- `scripts/import-postgres.js`
- `docs/api-contract.md` (full endpoint request/response contracts)
