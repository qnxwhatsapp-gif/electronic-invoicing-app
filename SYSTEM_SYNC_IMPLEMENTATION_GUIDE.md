# Multi-System Sync Implementation Guide (Local First + Server)

This document explains how to sync data between multiple installed desktop systems when each system first saves data locally.

Context for this project:

- Desktop app: Electron + React
- Local DB: SQLite (`better-sqlite3`)
- You already have a server
- Goal: both systems stay in sync with correct inventory/accounting

---

## 1) Target Architecture

Use **offline-first with server sync**:

1. Every write (create/update/delete) is saved to local SQLite immediately.
2. The same write is added to a local `sync_queue`.
3. Background sync worker sends queued operations to server API.
4. Each client also pulls remote changes regularly (or via websocket signal).
5. Remote changes are applied to local SQLite in order.

This gives:

- Fast UI and offline support
- Eventual consistency across systems
- Clear recovery if internet/server is down

---

## 2) High-Level Data Flow

### Write flow (on System A)

1. User creates invoice locally.
2. App saves invoice in SQLite.
3. App inserts sync event into `sync_queue` (`pending`).
4. Worker posts event to server `/sync/push`.
5. Server writes to central DB and returns `ack`.
6. Client marks event `acked`.

### Read sync flow (on System B)

1. Worker calls `/sync/pull?since=<cursor>`.
2. Server returns all events newer than cursor.
3. Client applies events to local DB transactionally.
4. Client updates local cursor.

---

## 3) Required Local Schema Additions (SQLite)

Add these columns to all transactional tables (`invoices`, `invoice_items`, `products`, `purchase_invoices`, `purchase_returns`, `expenses`, `banking_transactions`, etc.):

- `uuid TEXT` (global record id; stable across systems)
- `updated_at TEXT` (ISO timestamp)
- `deleted_at TEXT` (nullable soft delete marker)
- `version INTEGER DEFAULT 1` (increment on every update)
- `origin_device_id TEXT` (who created/updated)

Create local metadata tables:

### `sync_queue`

- `id INTEGER PK`
- `event_uuid TEXT UNIQUE`
- `entity_type TEXT` (invoice, product, return, etc.)
- `entity_uuid TEXT`
- `operation TEXT` (`upsert` | `delete`)
- `payload_json TEXT`
- `version INTEGER`
- `status TEXT` (`pending` | `acked` | `failed`)
- `retry_count INTEGER DEFAULT 0`
- `last_error TEXT`
- `created_at TEXT`
- `sent_at TEXT`

### `sync_state`

- `key TEXT PRIMARY KEY`
- `value TEXT`

Keys:

- `device_id`
- `last_pulled_cursor`
- `last_successful_sync_at`

---

## 4) Server-Side Requirements

Your server should maintain:

- Central relational DB (recommended PostgreSQL)
- `change_log` table for ordered sync events
- Idempotency check on `event_uuid`

### `change_log` (server)

- `id BIGSERIAL PK`
- `cursor BIGINT UNIQUE` (or use `id`)
- `event_uuid TEXT UNIQUE`
- `entity_type TEXT`
- `entity_uuid TEXT`
- `operation TEXT`
- `payload_json JSONB`
- `version INTEGER`
- `origin_device_id TEXT`
- `created_at TIMESTAMPTZ`

---

## 5) API Contract (Minimum)

### `POST /sync/push`

Request:

- `device_id`
- `events: []` (batch from `sync_queue`)

Behavior:

- Validate auth + tenant/company scope
- Ignore duplicate `event_uuid` (idempotent)
- Apply event to central DB in transaction
- Append to `change_log`
- Return ack per event

Response:

- `acked_event_uuids`
- `failed: [{ event_uuid, reason }]`
- `server_cursor`

### `GET /sync/pull?since=<cursor>&limit=500`

Behavior:

- Return all change_log entries after cursor
- Ordered ascending by cursor

Response:

- `events`
- `next_cursor`
- `has_more`

---

## 6) Conflict Resolution Rules

Use deterministic rules to avoid silent data corruption.

### Recommended base rule

- Compare `version` first (higher version wins).
- If same version, compare `updated_at` (latest wins).
- If still same, server wins.

### Domain-specific safeguards

- **Inventory**: do not directly overwrite stock values from remote snapshots. Prefer operation/event-based stock deltas.
- **Accounting**: treat financial entries as immutable ledger rows where possible (append-only), not overwrite-in-place.
- **Delete vs update**: if `deleted_at` exists and update is older, ignore update.

---

## 7) Sync Worker Behavior (Desktop)

Run worker every 3-10 seconds (configurable):

1. If no internet/server unreachable:
   - keep queue pending
   - show small offline indicator
2. Push pending queue in batches (e.g. 50 events).
3. Pull remote events since cursor.
4. Apply pulled events inside SQLite transaction.
5. Update sync cursor and UI status.

Retry policy:

- Exponential backoff: 2s, 4s, 8s, 16s, max 60s.
- Move repeated hard failures to `failed` with visible admin alert.

---

## 8) Electron Integration Points (Current Codebase)

### Files to extend

- `src/main/database.js`
  - add migration columns + sync tables
- `src/main/ipcHandlers.js`
  - wrap write handlers to enqueue sync events
- New file: `src/main/syncService.js`
  - background push/pull worker
  - event apply logic
- `src/main/main.js`
  - start `syncService` after DB init
- `src/preload.js`
  - expose `sync:getStatus` API to renderer
- UI pages (`TopBar` or status area)
  - show sync status and pending count

### Write handlers that must enqueue events first

- `invoices:create`, `invoices:update`, `invoices:delete`, `invoices:updateStatus`
- `products:create`, `products:update`, `products:delete`
- `returns:create`
- `purchases:create`, `purchases:updateStatus`, `purchases:createReturn`
- `paybills:create`, `expenses:create`
- banking and settings handlers that impact shared business data

---

## 9) Security + Multi-Tenant Requirements

- Authenticate each sync request (JWT/API token).
- Include `company_id` / tenant scope in every event.
- Reject cross-tenant access server-side.
- Encrypt traffic (HTTPS only).
- Sign installer and secure API keys/token storage.

---

## 10) Rollout Plan (Safe)

### Phase 1: Foundation

- Add UUID/version columns + sync tables locally.
- Add server `change_log` and `/sync/push`, `/sync/pull`.

### Phase 2: Read-only pull

- Pull remote events and apply to local (no local push yet).
- Validate consistency in staging.

### Phase 3: Full push + pull

- Enable queue push from selected write paths.
- Start with invoices + products first.

### Phase 4: Complete modules

- Add returns, purchases, banking, expenses, notifications.
- Add sync health dashboard in Settings.

### Phase 5: Hardening

- Conflict analytics
- Dead-letter queue for failed events
- Backup + replay tooling

---

## 11) Testing Checklist

### Functional

- Create invoice on PC-A appears on PC-B.
- Edit same product on A and B concurrently -> deterministic winner.
- Return/exchange on A updates stock and accounting on B.

### Offline

- Disconnect A, create multiple records, reconnect -> all sync.
- Server down during push -> queue retries and recovers.

### Data integrity

- No duplicate invoices after repeated retries.
- Ledger totals match before and after sync replay.
- Inventory never goes negative due to out-of-order apply.

### Performance

- 10k events initial sync acceptable time.
- Pull pagination stable.

---

## 12) Operational Runbook

Monitor:

- Pending queue count per device
- Failed events count
- Last successful sync time
- Cursor lag per device

Recovery steps:

1. Pause writes on problematic client.
2. Export failed events and inspect `last_error`.
3. Fix payload/schema issue.
4. Replay failed events.
5. Run reconciliation report (inventory + ledger + invoice totals).

---

## 13) Recommended Defaults

- Batch size: 50 push / 500 pull
- Push interval: 5 sec
- Pull interval: 5 sec
- Full reconciliation job: nightly
- Soft delete retention: permanent for audit (or >= 180 days)

---

## 14) What Not To Do

- Do not share one SQLite file over network drive.
- Do not sync raw `.db` file via OneDrive/Dropbox while app is open.
- Do not rely only on timestamp without version/event ordering.

---

## 15) Minimal First Sprint Plan (1 week)

1. Add local sync schema + migrations.
2. Build server endpoints `/sync/push` and `/sync/pull`.
3. Implement queue enqueue in:
   - product create/update/delete
   - invoice create/update
4. Build simple sync worker + status indicator.
5. Test with two systems and conflict scenarios.

---

## 16) Example Status UI (recommended)

Display in top bar:

- `Sync: Online`
- `Pending: 0`
- `Last sync: 09:02:14`

If issue:

- `Sync: Degraded (12 pending)` with tooltip showing last error.

---

If you want, next step I can create:

- `syncService.js` skeleton
- exact SQLite migration SQL
- API payload JSON examples for your server stack (Node/Express or your current backend).
