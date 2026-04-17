-- PostgreSQL schema for migrating from SQLite desktop app
-- Generated for electronic-invoicing-app

BEGIN;

CREATE TABLE IF NOT EXISTS company_profile (
  id BIGINT PRIMARY KEY,
  company_name TEXT NOT NULL DEFAULT 'My Company',
  mobile TEXT,
  email TEXT,
  address TEXT,
  logo_path TEXT
);

CREATE TABLE IF NOT EXISTS branches (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  store_id TEXT UNIQUE,
  code TEXT,
  address TEXT,
  contact TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS permissions (
  id BIGSERIAL PRIMARY KEY,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  UNIQUE(module, action)
);

CREATE TABLE IF NOT EXISTS user_roles (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS role_permissions (
  id BIGSERIAL PRIMARY KEY,
  role TEXT NOT NULL,
  permission_id BIGINT REFERENCES permissions(id) ON DELETE CASCADE,
  granted BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(role, permission_id)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  permission_id BIGINT REFERENCES permissions(id) ON DELETE CASCADE,
  granted BOOLEAN NOT NULL,
  UNIQUE(user_id, permission_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
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

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  branch_id BIGINT REFERENCES branches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  as_of_date DATE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id BIGSERIAL PRIMARY KEY,
  invoice_no TEXT UNIQUE NOT NULL,
  invoice_date DATE NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
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

CREATE TABLE IF NOT EXISTS invoice_items (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT REFERENCES invoices(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id),
  product_code TEXT,
  product_name TEXT,
  qty INTEGER NOT NULL,
  rate NUMERIC(14,2) NOT NULL,
  amount NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS return_exchange (
  id BIGSERIAL PRIMARY KEY,
  original_invoice_id BIGINT REFERENCES invoices(id),
  invoice_no TEXT,
  customer_name TEXT,
  type TEXT NOT NULL,
  total_items_sold INTEGER,
  items_returned INTEGER NOT NULL DEFAULT 0,
  return_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  exchange_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'complete',
  created_by BIGINT REFERENCES users(id),
  date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS return_exchange_items (
  id BIGSERIAL PRIMARY KEY,
  return_id BIGINT REFERENCES return_exchange(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id),
  product_name TEXT,
  returned_qty INTEGER NOT NULL DEFAULT 0,
  exchange_qty INTEGER NOT NULL DEFAULT 0,
  rate NUMERIC(14,2)
);

CREATE TABLE IF NOT EXISTS vendors (
  id BIGSERIAL PRIMARY KEY,
  vendor_name TEXT NOT NULL,
  company_name TEXT,
  email TEXT,
  phone TEXT,
  street_address TEXT,
  city TEXT,
  province_state TEXT,
  postal_code TEXT,
  account_name TEXT,
  account_number TEXT,
  outstanding_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id BIGSERIAL PRIMARY KEY,
  po_number TEXT UNIQUE,
  vendor_id BIGINT REFERENCES vendors(id),
  vendor_name TEXT,
  purchase_date DATE,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  purchase_note TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  pending_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  due_date DATE,
  last_payment_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_invoice_items (
  id BIGSERIAL PRIMARY KEY,
  purchase_invoice_id BIGINT REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id),
  product_name TEXT,
  product_code TEXT,
  qty INTEGER NOT NULL,
  price NUMERIC(14,2) NOT NULL,
  total NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id BIGSERIAL PRIMARY KEY,
  po_number TEXT,
  vendor_id BIGINT REFERENCES vendors(id),
  vendor_name TEXT,
  original_invoice_id BIGINT REFERENCES purchase_invoices(id),
  purchased_qty INTEGER,
  return_qty INTEGER,
  return_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  restocking_fee_pct NUMERIC(8,2) NOT NULL DEFAULT 0,
  return_reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  order_date DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id BIGSERIAL PRIMARY KEY,
  purchase_return_id BIGINT REFERENCES purchase_returns(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id),
  item_name TEXT,
  sku TEXT,
  purchased_qty INTEGER,
  return_qty INTEGER NOT NULL DEFAULT 0,
  purchase_price NUMERIC(14,2),
  total NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pay_bills (
  id BIGSERIAL PRIMARY KEY,
  vendor_id BIGINT REFERENCES vendors(id),
  purchase_invoice_id BIGINT REFERENCES purchase_invoices(id),
  outstanding_amount NUMERIC(14,2),
  total_payable NUMERIC(14,2),
  last_payment_date DATE,
  payment_mode TEXT,
  due_date DATE,
  paying_amount NUMERIC(14,2),
  payment_status TEXT NOT NULL DEFAULT 'Unpaid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS banking_transactions (
  id BIGSERIAL PRIMARY KEY,
  txn_id TEXT UNIQUE,
  account_id BIGINT REFERENCES accounts(id),
  account_name TEXT,
  date DATE NOT NULL,
  description TEXT,
  type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  branch_id BIGINT REFERENCES branches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  expense_id TEXT UNIQUE,
  title TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  expense_date DATE NOT NULL,
  category TEXT,
  account_id BIGINT REFERENCES accounts(id),
  paid_from TEXT,
  branch_id BIGINT REFERENCES branches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backups (
  id BIGSERIAL PRIMARY KEY,
  type TEXT,
  date_time TIMESTAMPTZ,
  size_mb NUMERIC(12,2),
  status TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS invoice_settings (
  id BIGINT PRIMARY KEY DEFAULT 1,
  inv_prefix TEXT DEFAULT 'INV',
  inv_suffix TEXT DEFAULT '',
  inv_start_number INTEGER DEFAULT 1001,
  inv_padding INTEGER DEFAULT 4,
  seller_name TEXT DEFAULT '',
  seller_tagline TEXT DEFAULT '',
  seller_address TEXT DEFAULT '',
  seller_phone TEXT DEFAULT '',
  seller_email TEXT DEFAULT '',
  seller_website TEXT DEFAULT '',
  seller_gstin TEXT DEFAULT '',
  seller_pan TEXT DEFAULT '',
  seller_logo_path TEXT DEFAULT '',
  template_color TEXT DEFAULT '#111111',
  template_style TEXT DEFAULT 'classic',
  show_customer_phone BOOLEAN NOT NULL DEFAULT TRUE,
  show_customer_email BOOLEAN NOT NULL DEFAULT FALSE,
  show_customer_gstin BOOLEAN NOT NULL DEFAULT TRUE,
  show_due_date BOOLEAN NOT NULL DEFAULT TRUE,
  show_po_number BOOLEAN NOT NULL DEFAULT TRUE,
  show_hsn BOOLEAN NOT NULL DEFAULT TRUE,
  show_discount BOOLEAN NOT NULL DEFAULT TRUE,
  show_tax_breakdown BOOLEAN NOT NULL DEFAULT TRUE,
  show_bank_details BOOLEAN NOT NULL DEFAULT TRUE,
  bank_name TEXT DEFAULT '',
  bank_account_no TEXT DEFAULT '',
  bank_ifsc TEXT DEFAULT '',
  bank_branch TEXT DEFAULT '',
  footer_notes TEXT DEFAULT 'Thank you for your business!',
  terms_conditions TEXT DEFAULT 'Payment due within 30 days.',
  custom_fields JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
