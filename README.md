# 🧾 Electronic Invoicing Desktop App

Built with **Electron + React + SQLite** (better-sqlite3)

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Run in development mode
```bash
npm run dev
```
This starts React on `localhost:3000` and opens Electron automatically.

### 3. Seed with test data (first time only)
After first launch the DB is auto-created. To add realistic test data:
```bash
npm run seed
```

---

## 🔑 Default Login Credentials

| Role               | Username        | Password         |
|--------------------|-----------------|------------------|
| Owner              | admin           | admin123         |
| Accountant         | priya           | accountant123    |
| Billing Operator   | raj             | billing123       |
| Inventory Manager  | meena           | inventory123     |

---

## 📁 Project Structure

```
src/
  main/
    main.js          ← Electron entry point
    preload.js       ← contextBridge (IPC exposure)
    database.js      ← SQLite init + all table creation + default seed
    ipcHandlers.js   ← All IPC handlers (auth, invoices, products, etc.)
    seed.js          ← Rich test data seed script
  renderer/
    context/
      AuthContext.jsx      ← Login state + permissions
    hooks/
      useBarcodeGun.js     ← USB barcode gun detection
      useSearch.js         ← Global search with debounce
    components/
      Sidebar.jsx          ← Navigation (permission-filtered)
      TopBar.jsx           ← Search bar + user avatar + logout
      AccessDenied.jsx     ← 403 page
    pages/
      Login.jsx
      Dashboard.jsx
      BillingInvoice.jsx
      InventoryServices.jsx
      VendorsPurchases.jsx
      Banking.jsx
      Expenses.jsx
      Reports.jsx
      Settings.jsx
    styles/
      global.css           ← Full design system CSS
    App.jsx                ← Router + protected routes
    index.jsx
public/
  index.html
SKILL.md                   ← Full app specification for Claude
```

---

## 🏗️ Build for Production

```bash
# Windows installer (.exe)
npm run build

# Output: dist/Invoicing App Setup x.x.x.exe
```

---

## 🔧 Using with Claude Code

Open this folder in Claude Code and use SKILL.md as your reference:

```bash
claude
```

Example prompts:
```
Read SKILL.md and complete the Create Invoice form (Section 5 & 6)
with full barcode gun + webcam support.

Build the complete Purchase Return modal per SKILL.md Section 14.

Add Excel export to the Sales Report per SKILL.md Section 21.
```

---

## 📊 Database Location

SQLite DB is stored at:
- **Windows:** `%APPDATA%\electronic-invoicing-app\invoicing.db`
- **Mac:** `~/Library/Application Support/electronic-invoicing-app/invoicing.db`
- **Linux:** `~/.config/electronic-invoicing-app/invoicing.db`

---

## ✅ Features Implemented

- [x] Login screen with role-based access
- [x] JWT-free session (localStorage)
- [x] Permission matrix (module × action)
- [x] Per-user permission overrides
- [x] Sidebar filtered by permissions
- [x] Dashboard with live stats + charts
- [x] Billing & Invoice list
- [x] Inventory with stock status
- [x] Vendors & Purchases
- [x] Banking transactions
- [x] Expenses with category breakdown
- [x] Reports (7 types) with Excel export
- [x] Settings (Company, Accounts, Users, Backup)
- [x] Global search bar (Ctrl+K)
- [x] Barcode gun hook (useBarcodeGun)
- [x] SQLite schema (17 tables)
- [x] Seed data (35 products, 20 customers, 30 invoices...)

## 🚧 Complete with Claude Code

- [ ] Create Invoice form (full flow)
- [ ] Barcode webcam scanner modal
- [ ] Product info popup on scan
- [ ] Return & Exchange flow
- [ ] Purchase Invoice create modal
- [ ] Purchase Return modal
- [ ] Pay Bill modal
- [ ] Print invoice as PDF
- [ ] Receive Payment on credit sale
