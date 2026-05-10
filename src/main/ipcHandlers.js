const bcrypt = require('bcryptjs');
const { ipcMain } = require('electron');

module.exports = function registerHandlers({ getDb }) {

  // ─── AUTH ────────────────────────────────────────────────────────────────
  ipcMain.handle('auth:login', async (_, { username, password }) => {
    const db = getDb();
    const user = db.prepare(
      `SELECT * FROM users WHERE (name = ? OR mobile = ?) AND is_active = 1`
    ).get(username, username);
    if (!user) return { success: false, error: 'Invalid username or password.' };
    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) return { success: false, error: 'Invalid username or password.' };
    const { password: _pw, ...safeUser } = user;
    return { success: true, user: safeUser };
  });

  // Get all roles that have at least one active user (for login dropdown)
  ipcMain.handle('auth:getRoles', async () => {
    const db = getDb();
    return db.prepare(`SELECT DISTINCT role FROM users WHERE is_active = 1 ORDER BY role`).all().map(r => r.role);
  });

  // Get active users for a given role (for login dropdown)
  ipcMain.handle('auth:getUsersByRole', async (_, { role }) => {
    const db = getDb();
    return db.prepare(`SELECT id, name, mobile FROM users WHERE role = ? AND is_active = 1 ORDER BY name`).all(role);
  });

  // ─── USER ROLES MANAGEMENT ────────────────────────────────────────────────
  ipcMain.handle('roles:getAll', async () => {
    return getDb().prepare(`SELECT * FROM user_roles ORDER BY is_system DESC, name ASC`).all();
  });

  ipcMain.handle('roles:create', async (_, { name }) => {
    try {
      getDb().prepare(`INSERT INTO user_roles (name, is_system) VALUES (?, 0)`).run(name.trim());
      return { success: true };
    } catch (e) {
      return { success: false, error: 'Role already exists' };
    }
  });

  ipcMain.handle('roles:delete', async (_, { id }) => {
    const db = getDb();
    const role = db.prepare(`SELECT * FROM user_roles WHERE id = ?`).get(id);
    if (!role) return { success: false, error: 'Role not found' };
    if (role.is_system) return { success: false, error: 'Cannot delete a system role' };
    const inUse = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = ?`).get(role.name).c;
    if (inUse > 0) return { success: false, error: `Role is assigned to ${inUse} user(s)` };
    db.prepare(`DELETE FROM user_roles WHERE id = ?`).run(id);
    return { success: true };
  });

  // ─── PERMISSIONS ─────────────────────────────────────────────────────────
  ipcMain.handle('permissions:getForUser', async (_, { userId, role }) => {
    const db = getDb();
    if (role === 'Owner') return null; // Owner has all
    const overrides = db.prepare(
      `SELECT p.module, p.action, up.granted FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = ?`
    ).all(userId);
    const rolePerms = db.prepare(
      `SELECT p.module, p.action, rp.granted FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id WHERE rp.role = ?`
    ).all(role);
    const map = {};
    for (const rp of rolePerms) {
      if (!map[rp.module]) map[rp.module] = {};
      map[rp.module][rp.action] = rp.granted === 1;
    }
    for (const up of overrides) {
      if (!map[up.module]) map[up.module] = {};
      map[up.module][up.action] = up.granted === 1;
    }
    return map;
  });

  ipcMain.handle('permissions:saveForUser', async (_, { userId, permissions }) => {
    const db = getDb();
    db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(userId);
    const getPerm = db.prepare('SELECT id FROM permissions WHERE module = ? AND action = ?');
    const ins = db.prepare('INSERT INTO user_permissions (user_id, permission_id, granted) VALUES (?,?,?)');
    for (const [module, actions] of Object.entries(permissions)) {
      for (const [action, granted] of Object.entries(actions)) {
        const perm = getPerm.get(module, action);
        if (perm) ins.run(userId, perm.id, granted ? 1 : 0);
      }
    }
    return { success: true };
  });

  // ─── DASHBOARD ────────────────────────────────────────────────────────────
  ipcMain.handle('dashboard:getStats', async (_, { branch_id } = {}) => {
    const db = getDb();
    const bFilter = branch_id ? `AND branch_id = ${parseInt(branch_id)}` : '';
    const totalSale = db.prepare(`SELECT COALESCE(SUM(grand_total),0) as val FROM invoices WHERE status NOT IN ('Draft') ${bFilter}`).get().val;
    const totalProfit = db.prepare(`SELECT COALESCE(SUM(ii.qty * (ii.rate - p.purchase_price)),0) as val FROM invoice_items ii JOIN products p ON p.id = ii.product_id JOIN invoices i ON i.id = ii.invoice_id WHERE i.status NOT IN ('Draft') ${bFilter.replace('branch_id','i.branch_id')}`).get().val;
    const pendingPayment = db.prepare(`SELECT COALESCE(SUM(grand_total - paid_amount),0) as val FROM invoices WHERE is_credit_sale = 1 AND status NOT IN ('Draft') ${bFilter}`).get().val;
    const cashBalance = db.prepare(`SELECT COALESCE(SUM(current_balance),0) as val FROM accounts WHERE account_type = 'Cash'`).get().val;
    const bankBalance = db.prepare(`SELECT COALESCE(SUM(current_balance),0) as val FROM accounts WHERE account_type = 'Bank'`).get().val;
    const lowStock = db.prepare(`SELECT COUNT(*) as val FROM products WHERE status IN ('Low','Critical') AND is_active = 1`).get().val;
    const monthlySales = db.prepare(`SELECT strftime('%m', invoice_date) as month, COALESCE(SUM(grand_total),0) as total FROM invoices WHERE status NOT IN ('Draft') AND strftime('%Y', invoice_date) = strftime('%Y','now') ${bFilter} GROUP BY month ORDER BY month`).all();
    const recentInvoices = db.prepare(`SELECT * FROM invoices WHERE 1=1 ${bFilter} ORDER BY created_at DESC LIMIT 5`).all();
    const topItems = db.prepare(`SELECT ii.product_name, SUM(ii.qty) as units_sold, SUM(ii.amount) as revenue FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.status NOT IN ('Draft') ${bFilter.replace('branch_id','i.branch_id')} GROUP BY ii.product_name ORDER BY units_sold DESC LIMIT 7`).all();
    const branchRevenue = db.prepare(`SELECT b.name, COALESCE(SUM(i.grand_total),0) as revenue FROM branches b LEFT JOIN invoices i ON i.branch_id = b.id AND i.status NOT IN ('Draft') WHERE b.is_active=1 GROUP BY b.id, b.name ORDER BY revenue DESC`).all();
    return { totalSale, totalProfit, pendingPayment, cashBalance, bankBalance, lowStock, monthlySales, recentInvoices, topItems, branchRevenue };
  });

  // ─── INVOICES ─────────────────────────────────────────────────────────────
  ipcMain.handle('invoices:getAll', async (_, { status, search, branch_id } = {}) => {
    const db = getDb();
    let q = `SELECT i.*, u.name as seller_name,
      (SELECT COUNT(*) FROM invoice_items WHERE invoice_id=i.id) as item_count,
      (SELECT COALESCE(SUM(qty),0) FROM invoice_items WHERE invoice_id=i.id) as total_qty,
      (SELECT COALESCE(SUM(items_returned),0) FROM return_exchange WHERE original_invoice_id=i.id) as returned_qty
      FROM invoices i LEFT JOIN users u ON u.id = i.seller_id WHERE 1=1`;
    const params = [];
    if (status && status !== 'All') { q += ` AND i.status = ?`; params.push(status); }
    if (search) { q += ` AND (i.invoice_no LIKE ? OR i.customer_name LIKE ? OR i.customer_phone LIKE ?)`; const s = `%${search}%`; params.push(s, s, s); }
    if (branch_id) { q += ` AND i.branch_id = ?`; params.push(branch_id); }
    q += ` ORDER BY i.created_at DESC`;
    return db.prepare(q).all(...params);
  });

  ipcMain.handle('invoices:getById', async (_, { id }) => {
    const db = getDb();
    const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(id);
    if (!invoice) return null;
    invoice.items = db.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).all(id);
    return invoice;
  });

  ipcMain.handle('invoices:create', async (_, data) => {
    const db = getDb();
    const year = new Date().getFullYear().toString().slice(-2);
    const last = db.prepare(`SELECT invoice_no FROM invoices ORDER BY id DESC LIMIT 1`).get();
    let seq = 1;
    if (last) {
      const num = parseInt(last.invoice_no.replace(`ETS-${year}`, ''), 10);
      seq = isNaN(num) ? 1 : num + 1;
    }
    const invoice_no = `ETS-${year}${String(seq).padStart(3, '0')}`;
    const insert = db.prepare(`
      INSERT INTO invoices (invoice_no, invoice_date, customer_name, customer_phone, seller_id, branch_id,
        subtotal, tax_amount, grand_total, payment_mode, cash_amount, online_amount, internal_notes,
        status, type, is_credit_sale, paid_amount, created_by)
      VALUES (@invoice_no,@invoice_date,@customer_name,@customer_phone,@seller_id,@branch_id,
        @subtotal,@tax_amount,@grand_total,@payment_mode,@cash_amount,@online_amount,@internal_notes,
        @status,@type,@is_credit_sale,@paid_amount,@created_by)
    `);
    const result = insert.run({
      invoice_no,
      invoice_date: data.invoice_date,
      customer_name: data.customer_name || '',
      customer_phone: data.customer_phone || '',
      seller_id: data.seller_id || null,
      branch_id: data.branch_id || null,
      subtotal: data.subtotal || 0,
      tax_amount: data.tax_amount || 0,
      grand_total: data.grand_total || 0,
      payment_mode: data.payment_mode || 'Cash',
      cash_amount: data.split_cash || data.cash_amount || null,
      online_amount: data.split_card || data.online_amount || null,
      internal_notes: data.notes || data.internal_notes || '',
      status: data.status || 'Paid',
      type: data.type || 'Sale',
      is_credit_sale: data.is_credit_sale || 0,
      paid_amount: data.is_credit_sale ? 0 : data.grand_total,
      created_by: data.created_by || null,
    });
    const invoiceId = result.lastInsertRowid;

    // Insert items & update stock
    if (data.items && data.items.length) {
      const insItem = db.prepare(`INSERT INTO invoice_items (invoice_id, product_id, product_code, product_name, qty, rate, amount) VALUES (?,?,?,?,?,?,?)`);
      const updStock = db.prepare(`UPDATE products SET current_stock = current_stock - ?, status = CASE WHEN current_stock - ? <= 5 THEN 'Critical' WHEN current_stock - ? <= reorder_level THEN 'Low' ELSE 'Good' END WHERE id = ?`);
      for (const item of data.items) {
        insItem.run(invoiceId, item.product_id, item.product_code || item.sku || '', item.product_name || item.name || '', item.qty, item.rate, item.amount);
        if (data.status !== 'Draft') updStock.run(item.qty, item.qty, item.qty, item.product_id);
      }
    }
    // Auto-create banking transaction for paid invoices
    if (data.status !== 'Draft' && !data.is_credit_sale) {
      const year2 = new Date().getFullYear().toString().slice(-2);
      const lastTxn = db.prepare(`SELECT txn_id FROM banking_transactions ORDER BY id DESC LIMIT 1`).get();
      let txnSeq = 1;
      if (lastTxn) { const n = parseInt(lastTxn.txn_id.replace(`TXN-${year2}`,''),10); txnSeq = isNaN(n)?1:n+1; }
      const txn_id = `TXN-${year2}${String(txnSeq).padStart(3,'0')}`;
      const acct = db.prepare(`SELECT id FROM accounts WHERE account_type='Cash' AND is_primary=1 LIMIT 1`).get() ||
                   db.prepare(`SELECT id FROM accounts WHERE account_type='Cash' LIMIT 1`).get();
      if (acct) {
        db.prepare(`INSERT INTO banking_transactions (txn_id,account_id,account_name,date,description,type,amount) VALUES (?,?,?,?,?,?,?)`)
          .run(txn_id, acct.id, 'Cash Account', data.invoice_date, `Sale: ${invoice_no}`, 'Credit', data.grand_total);
        db.prepare(`UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?`).run(data.grand_total, acct.id);
      }
    }
    // Notify on credit sale
    if (data.is_credit_sale) {
      db.prepare(`INSERT INTO notifications (type,title,message,link) VALUES (?,?,?,?)`)
        .run('credit_due', 'Credit Sale Created',
          `Invoice ${invoice_no} for ${data.customer_name || 'Walk-in'} (₹${data.grand_total}) recorded as credit sale`,
          '/billing');
    }
    return { success: true, invoice_no, id: invoiceId };
  });

  ipcMain.handle('invoices:updateStatus', async (_, { id, status, paid_amount }) => {
    const db = getDb();
    if (status === 'Paid') {
      db.prepare(`
        UPDATE invoices
        SET status = ?,
            paid_amount = COALESCE(?, paid_amount),
            invoice_date = date('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(status, paid_amount, id);
    } else {
      db.prepare(`UPDATE invoices SET status = ?, paid_amount = COALESCE(?, paid_amount), updated_at = datetime('now') WHERE id = ?`).run(status, paid_amount, id);
    }
    return { success: true };
  });

  ipcMain.handle('invoices:delete', async (_, { id }) => {
    const db = getDb();
    db.prepare(`DELETE FROM invoices WHERE id = ?`).run(id);
    return { success: true };
  });

  ipcMain.handle('invoices:update', async (_, { id, data }) => {
    const db = getDb();
    db.prepare(`
      UPDATE invoices SET
        invoice_date=@invoice_date, customer_name=@customer_name, customer_phone=@customer_phone,
        seller_id=@seller_id, branch_id=@branch_id, subtotal=@subtotal, tax_amount=@tax_amount,
        grand_total=@grand_total, payment_mode=@payment_mode, cash_amount=@cash_amount,
        online_amount=@online_amount, internal_notes=@internal_notes, status=@status,
        type=@type, is_credit_sale=@is_credit_sale, paid_amount=@paid_amount,
        updated_at=datetime('now')
      WHERE id=@id
    `).run({
      id,
      invoice_date: data.invoice_date,
      customer_name: data.customer_name || '',
      customer_phone: data.customer_phone || '',
      seller_id: data.seller_id || null,
      branch_id: data.branch_id || null,
      subtotal: data.subtotal || 0,
      tax_amount: data.tax_amount || 0,
      grand_total: data.grand_total || 0,
      payment_mode: data.payment_mode || 'Cash',
      cash_amount: data.cash_amount || null,
      online_amount: data.online_amount || null,
      internal_notes: data.notes || data.internal_notes || '',
      status: data.status || 'Draft',
      type: data.type || 'Sale',
      is_credit_sale: data.is_credit_sale || 0,
      paid_amount: data.paid_amount || 0,
    });
    // Replace items
    if (data.items && data.items.length) {
      db.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).run(id);
      const insItem = db.prepare(`INSERT INTO invoice_items (invoice_id, product_id, product_code, product_name, qty, rate, amount) VALUES (?,?,?,?,?,?,?)`);
      for (const item of data.items) {
        insItem.run(id, item.product_id, item.product_code || '', item.product_name || item.name || '', item.qty, item.rate, item.amount);
      }
    }
    return { success: true };
  });

  // ─── RETURN & EXCHANGE ────────────────────────────────────────────────────
  ipcMain.handle('returns:getAll', async () => {
    const db = getDb();
    return db.prepare(`SELECT * FROM return_exchange ORDER BY date DESC`).all();
  });

  ipcMain.handle('returns:getById', async (_, { id }) => {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM return_exchange WHERE id = ?`).get(id);
    if (!row) return null;
    row.items = db.prepare(`SELECT * FROM return_exchange_items WHERE return_id = ? ORDER BY id ASC`).all(id);
    return row;
  });

  ipcMain.handle('returns:getEligibleInvoices', async () => {
    const db = getDb();
    return db.prepare(`
      SELECT
        i.*,
        (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = i.id) as item_count,
        (SELECT COALESCE(SUM(qty), 0) FROM invoice_items WHERE invoice_id = i.id) as total_qty,
        (SELECT COALESCE(SUM(items_returned), 0) FROM return_exchange WHERE original_invoice_id = i.id) as returned_qty
      FROM invoices i
      WHERE i.status = 'Paid'
        AND CAST(julianday('now') - julianday(i.invoice_date) AS INTEGER) <= 15
        AND (SELECT COALESCE(SUM(items_returned), 0) FROM return_exchange WHERE original_invoice_id = i.id)
            < (SELECT COALESCE(SUM(qty), 0) FROM invoice_items WHERE invoice_id = i.id)
      ORDER BY i.invoice_date DESC, i.id DESC
    `).all();
  });

  ipcMain.handle('returns:create', async (_, data) => {
    const db = getDb();
    // Validate 15-day return window
    if (data.original_invoice_id) {
      const origInv = db.prepare(`SELECT invoice_date, status FROM invoices WHERE id=?`).get(data.original_invoice_id);
      if (origInv) {
        const daysSince = db.prepare(`SELECT CAST(julianday('now') - julianday(?) AS INTEGER) as days`).get(origInv.invoice_date).days;
        if (daysSince > 15) return { success: false, error: 'Return period of 15 days has expired for this invoice.' };
        if (origInv.status === 'Completed') return { success: false, error: 'This invoice is completed and cannot be returned.' };
      }
    }
    const soldQty = db.prepare(`SELECT COALESCE(SUM(qty),0) as v FROM invoice_items WHERE invoice_id = ?`).get(data.original_invoice_id)?.v || Number(data.total_items_sold || 0);
    const prevReturnedQty = db.prepare(`SELECT COALESCE(SUM(items_returned),0) as v FROM return_exchange WHERE original_invoice_id = ?`).get(data.original_invoice_id)?.v || 0;
    const returnItems = Array.isArray(data.items) ? data.items.filter(it => Number(it.returned_qty || 0) > 0) : [];
    const exchangeItems = Array.isArray(data.exchange_items) ? data.exchange_items.filter(it => Number(it.qty || 0) > 0) : [];
    const currentReturnedQty = returnItems.reduce((s, it) => s + Number(it.returned_qty || 0), 0);
    const returnAmount = returnItems.reduce((s, it) => s + (Number(it.returned_qty || 0) * Number(it.rate || 0)), 0);
    const exchangeAmount = exchangeItems.reduce((s, it) => s + (Number(it.qty || 0) * Number(it.rate || 0)), 0);
    if (currentReturnedQty <= 0) return { success: false, error: 'No return quantity selected' };
    if ((prevReturnedQty + currentReturnedQty) > soldQty) {
      return { success: false, error: 'Return quantity exceeds sold quantity for this invoice' };
    }
    if (String(data.type || 'Return') === 'Exchange' && exchangeItems.length === 0) {
      return { success: false, error: 'Select at least one exchange item' };
    }

    // Per-product validation: prevent returning more than sold for each SKU.
    for (const item of returnItems) {
      const soldForProduct = db.prepare(`SELECT COALESCE(SUM(qty),0) as v FROM invoice_items WHERE invoice_id = ? AND product_id = ?`).get(data.original_invoice_id, item.product_id)?.v || 0;
      const prevReturnedForProduct = db.prepare(`
        SELECT COALESCE(SUM(rei.returned_qty),0) as v
        FROM return_exchange_items rei
        JOIN return_exchange re ON re.id = rei.return_id
        WHERE re.original_invoice_id = ? AND rei.product_id = ?
      `).get(data.original_invoice_id, item.product_id)?.v || 0;
      if ((prevReturnedForProduct + Number(item.returned_qty || 0)) > soldForProduct) {
        return { success: false, error: `Return qty exceeds sold qty for product ${item.product_name || item.product_id}` };
      }
    }

    // Validate stock for exchange items.
    for (const ex of exchangeItems) {
      const p = db.prepare(`SELECT current_stock, name FROM products WHERE id = ?`).get(ex.product_id);
      if (!p) return { success: false, error: `Exchange product not found: ${ex.product_id}` };
      if (Number(p.current_stock || 0) < Number(ex.qty || 0)) {
        return { success: false, error: `Insufficient stock for ${p.name}` };
      }
    }

    const computedStatus = (prevReturnedQty + currentReturnedQty) >= soldQty ? 'Completed' : 'Partial';
    const netAmount = exchangeAmount - returnAmount; // +ve customer pays more, -ve refund owed.

    const tx = db.transaction(() => {
      const ins = db.prepare(`INSERT INTO return_exchange (original_invoice_id, invoice_no, customer_name, type, total_items_sold, items_returned, return_amount, exchange_amount, net_amount, status, created_by) VALUES (@original_invoice_id,@invoice_no,@customer_name,@type,@total_items_sold,@items_returned,@return_amount,@exchange_amount,@net_amount,@status,@created_by)`);
      const payload = {
        ...data,
        total_items_sold: soldQty,
        items_returned: currentReturnedQty,
        return_amount: returnAmount,
        exchange_amount: exchangeAmount,
        net_amount: netAmount,
        status: computedStatus,
      };
      const r = ins.run(payload);
      const returnId = r.lastInsertRowid;

      const insItem = db.prepare(`INSERT INTO return_exchange_items (return_id, product_id, product_name, returned_qty, exchange_qty, rate) VALUES (?,?,?,?,?,?)`);
      const updStockIn = db.prepare(`UPDATE products SET current_stock = current_stock + ? WHERE id = ?`);
      const updStockOut = db.prepare(`UPDATE products SET current_stock = current_stock - ? WHERE id = ?`);

      for (const item of returnItems) {
        insItem.run(returnId, item.product_id, item.product_name || item.name || '', Number(item.returned_qty || 0), 0, Number(item.rate || 0));
        updStockIn.run(Number(item.returned_qty || 0), item.product_id);
      }
      for (const ex of exchangeItems) {
        insItem.run(returnId, ex.product_id, ex.product_name || ex.name || '', 0, Number(ex.qty || 0), Number(ex.rate || 0));
        updStockOut.run(Number(ex.qty || 0), ex.product_id);
      }

      // Accounting impact: cash/bank movement by net difference.
      if (netAmount !== 0) {
        const year2 = new Date().getFullYear().toString().slice(-2);
        const lastTxn = db.prepare(`SELECT txn_id FROM banking_transactions ORDER BY id DESC LIMIT 1`).get();
        let txnSeq = 1;
        if (lastTxn) {
          const n = parseInt(String(lastTxn.txn_id || '').replace(`TXN-${year2}`, ''), 10);
          txnSeq = isNaN(n) ? 1 : n + 1;
        }
        const txnId = `TXN-${year2}${String(txnSeq).padStart(3,'0')}`;
        const acct = db.prepare(`SELECT id, account_name FROM accounts WHERE account_type='Cash' AND is_primary=1 LIMIT 1`).get()
          || db.prepare(`SELECT id, account_name FROM accounts WHERE account_type='Cash' LIMIT 1`).get();
        if (acct) {
          const isCustomerPayingMore = netAmount > 0;
          const movementType = isCustomerPayingMore ? 'Credit' : 'Debit';
          const movementAmount = Math.abs(netAmount);
          const movementDesc = isCustomerPayingMore
            ? `Exchange Difference Received: ${data.invoice_no || data.original_invoice_id}`
            : `Return Refund Paid: ${data.invoice_no || data.original_invoice_id}`;
          db.prepare(`INSERT INTO banking_transactions (txn_id,account_id,account_name,date,description,type,amount) VALUES (?,?,?,?,?,?,?)`)
            .run(txnId, acct.id, acct.account_name || 'Cash Account', new Date().toISOString().slice(0,10), movementDesc, movementType, movementAmount);
          const delta = isCustomerPayingMore ? movementAmount : -movementAmount;
          db.prepare(`UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?`).run(delta, acct.id);
        }
      }
      return returnId;
    });

    const returnId = tx();
    return { success: true, id: returnId };
  });

  // ─── INVENTORY / PRODUCTS ─────────────────────────────────────────────────
  ipcMain.handle('products:getAll', async (_, { search, category, status, branch_id } = {}) => {
    const db = getDb();
    let q = `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.is_active = 1`;
    const params = [];
    if (search) { q += ` AND (p.name LIKE ? OR p.sku LIKE ?)`; const s = `%${search}%`; params.push(s, s); }
    if (category && category !== 'All Categories') { q += ` AND c.name = ?`; params.push(category); }
    if (status && status !== 'All Status') { q += ` AND p.status = ?`; params.push(status); }
    if (branch_id) { q += ` AND p.branch_id = ?`; params.push(branch_id); }
    return db.prepare(q).all(...params);
  });

  ipcMain.handle('products:findByBarcode', async (_, data) => {
    const db = getDb();
    const barcode = typeof data === 'string' ? data : data?.barcode;
    return db.prepare(`SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.barcode = ? AND p.is_active = 1`).get(barcode);
  });

  ipcMain.handle('products:create', async (_, data) => {
    const db = getDb();
    const last = db.prepare(`SELECT sku FROM products ORDER BY id DESC LIMIT 1`).get();
    let seq = 1;
    if (last) { const n = parseInt(last.sku.replace('ITM-', ''), 10); seq = isNaN(n) ? 1 : n + 1; }
    const sku = `ITM-${String(seq).padStart(3, '0')}`;
    const initStock = data.current_stock || data.opening_stock || 0;
    const reorderLvl = data.low_stock_threshold || data.reorder_level || 10;
    db.prepare(`INSERT INTO products (sku, name, category_id, unit, hsn_code, purchase_price, selling_price, opening_stock, current_stock, reorder_level, barcode, description, branch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(sku, data.name, data.category_id || null, data.unit || 'pcs', data.hsn_code || '', data.purchase_price || 0, data.selling_price || 0, initStock, initStock, reorderLvl, data.barcode || '', data.description || '', data.branch_id || null);
    return { success: true, sku };
  });

  ipcMain.handle('products:update', async (_, { id, ...data }) => {
    const db = getDb();
    const reorderLvl = data.low_stock_threshold || data.reorder_level || 10;
    db.prepare(`UPDATE products SET name=?,category_id=?,unit=?,hsn_code=?,purchase_price=?,selling_price=?,current_stock=?,reorder_level=?,barcode=?,description=?,branch_id=? WHERE id=?`)
      .run(data.name, data.category_id || null, data.unit || 'pcs', data.hsn_code || '', data.purchase_price || 0, data.selling_price || 0, data.current_stock || 0, reorderLvl, data.barcode || '', data.description || '', data.branch_id || null, id);
    return { success: true };
  });

  ipcMain.handle('products:delete', async (_, { id }) => {
    const db = getDb();
    db.prepare(`UPDATE products SET is_active = 0 WHERE id = ?`).run(id);
    return { success: true };
  });

  ipcMain.handle('customers:getAll', async (_, { search } = {}) => {
    const db = getDb();
    if (search) return db.prepare(`SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ?`).all(`%${search}%`, `%${search}%`);
    return db.prepare(`SELECT * FROM customers ORDER BY name`).all();
  });

  ipcMain.handle('products:getInventoryStats', async (_, { category, status, branch_id } = {}) => {
    const db = getDb();
    let where = ` WHERE p.is_active=1`;
    const params = [];
    if (category && category !== 'All Categories') { where += ` AND c.name = ?`; params.push(category); }
    if (status && status !== 'All Status') { where += ` AND p.status = ?`; params.push(status); }
    if (branch_id) { where += ` AND p.branch_id = ?`; params.push(branch_id); }

    const total = db.prepare(`SELECT COUNT(*) as val FROM products p LEFT JOIN categories c ON c.id = p.category_id ${where}`).get(...params).val;
    const lowAlert = db.prepare(`SELECT COUNT(*) as val FROM products p LEFT JOIN categories c ON c.id = p.category_id ${where} AND p.status IN ('Low','Critical')`).get(...params).val;
    const costVal = db.prepare(`SELECT COALESCE(SUM(p.current_stock*p.purchase_price),0) as val FROM products p LEFT JOIN categories c ON c.id = p.category_id ${where}`).get(...params).val;
    const sellVal = db.prepare(`SELECT COALESCE(SUM(p.current_stock*p.selling_price),0) as val FROM products p LEFT JOIN categories c ON c.id = p.category_id ${where}`).get(...params).val;
    return { total, lowAlert, costVal, sellVal };
  });

  ipcMain.handle('categories:getAll', async () => {
    const db = getDb();
    return db.prepare(`SELECT * FROM categories ORDER BY name`).all();
  });

  ipcMain.handle('categories:create', async (_, { name }) => {
    const db = getDb();
    const normalized = String(name || '').trim();
    if (!normalized) return { success: false, error: 'Category name is required' };
    try {
      const result = db.prepare(`INSERT INTO categories (name) VALUES (?)`).run(normalized);
      return { success: true, id: result.lastInsertRowid };
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE')) {
        return { success: false, error: 'Category already exists' };
      }
      return { success: false, error: error.message || 'Failed to create category' };
    }
  });

  ipcMain.handle('categories:delete', async (_, { id }) => {
    const db = getDb();
    const categoryId = Number(id);
    if (!categoryId) return { success: false, error: 'Invalid category id' };
    const inUse = db.prepare(`SELECT COUNT(*) as c FROM products WHERE category_id = ?`).get(categoryId)?.c || 0;
    if (inUse > 0) {
      return { success: false, error: 'Cannot delete category in use by products' };
    }
    db.prepare(`DELETE FROM categories WHERE id = ?`).run(categoryId);
    return { success: true };
  });

  // ─── VENDORS ──────────────────────────────────────────────────────────────
  ipcMain.handle('vendors:getAll', async (_, { search } = {}) => {
    const db = getDb();
    if (search) return db.prepare(`SELECT * FROM vendors WHERE vendor_name LIKE ? OR company_name LIKE ?`).all(`%${search}%`, `%${search}%`);
    return db.prepare(`SELECT * FROM vendors ORDER BY created_at DESC`).all();
  });

  ipcMain.handle('vendors:create', async (_, data) => {
    const db = getDb();
    const r = db.prepare(`INSERT INTO vendors (vendor_name,company_name,email,phone,street_address,city,province_state,postal_code,account_name,account_number) VALUES (@vendor_name,@company_name,@email,@phone,@street_address,@city,@province_state,@postal_code,@account_name,@account_number)`).run(data);
    return { success: true, id: r.lastInsertRowid };
  });

  ipcMain.handle('vendors:update', async (_, { id, ...data }) => {
    const db = getDb();
    db.prepare(`UPDATE vendors SET vendor_name=?,company_name=?,email=?,phone=?,street_address=?,city=?,province_state=?,postal_code=?,account_name=?,account_number=? WHERE id=?`)
      .run(data.vendor_name, data.company_name||'', data.email||'', data.phone||'', data.street_address||'', data.city||'', data.province_state||'', data.postal_code||'', data.account_name||'', data.account_number||'', id);
    return { success: true };
  });

  ipcMain.handle('vendors:delete', async (_, { id }) => {
    const db = getDb();
    db.prepare(`DELETE FROM vendors WHERE id = ?`).run(id);
    return { success: true };
  });

  // ─── PURCHASE INVOICES ────────────────────────────────────────────────────
  ipcMain.handle('purchases:getAll', async (_, { search } = {}) => {
    const db = getDb();
    let q = `SELECT pi.*, v.vendor_name, (SELECT COUNT(*) FROM purchase_invoice_items WHERE purchase_invoice_id=pi.id) as product_count, (SELECT COALESCE(SUM(qty),0) FROM purchase_invoice_items WHERE purchase_invoice_id=pi.id) as total_qty FROM purchase_invoices pi LEFT JOIN vendors v ON v.id = pi.vendor_id WHERE 1=1`;
    const params = [];
    if (search) { q += ` AND (pi.po_number LIKE ? OR v.vendor_name LIKE ?)`; const s = `%${search}%`; params.push(s, s); }
    q += ` ORDER BY pi.created_at DESC`;
    return db.prepare(q).all(...params);
  });

  ipcMain.handle('purchases:create', async (_, data) => {
    const db = getDb();
    const year = new Date().getFullYear();
    const last = db.prepare(`SELECT po_number FROM purchase_invoices ORDER BY id DESC LIMIT 1`).get();
    let seq = 1;
    if (last) { const n = parseInt(last.po_number.split('-')[2], 10); seq = isNaN(n) ? 1 : n + 1; }
    const po_number = `PO-${year}-${String(seq).padStart(6, '0')}`;
    const vendor = db.prepare(`SELECT vendor_name FROM vendors WHERE id = ?`).get(data.vendor_id);
    const vendorName = vendor?.vendor_name || data.vendor_name || '';
    const r = db.prepare(`INSERT INTO purchase_invoices (po_number,vendor_id,vendor_name,purchase_date,subtotal,grand_total,purchase_note,status,pending_amount) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(po_number, data.vendor_id, vendorName, data.purchase_date, data.subtotal, data.grand_total, data.notes || '', data.status || 'Pending', data.grand_total);
    const piId = r.lastInsertRowid;
    if (data.items) {
      const ins = db.prepare(`INSERT INTO purchase_invoice_items (purchase_invoice_id,product_id,product_name,product_code,qty,price,total) VALUES (?,?,?,?,?,?,?)`);
      const upd = db.prepare(`UPDATE products SET current_stock = current_stock + ? WHERE id = ?`);
      for (const item of data.items) {
        ins.run(piId, item.product_id, item.name || item.product_name, item.sku || item.product_code || '', item.qty, item.rate || item.price, item.amount || item.total);
        if (data.status === 'Received') upd.run(item.qty, item.product_id);
      }
    }
    return { success: true, po_number, id: piId };
  });

  ipcMain.handle('purchases:delete', async (_, { id }) => {
    const db = getDb();
    db.prepare(`DELETE FROM purchase_invoice_items WHERE purchase_invoice_id = ?`).run(id);
    db.prepare(`DELETE FROM purchase_invoices WHERE id = ?`).run(id);
    return { success: true };
  });

  ipcMain.handle('purchases:updateStatus', async (_, { id, status }) => {
    const db = getDb();
    const pi = db.prepare(`SELECT status FROM purchase_invoices WHERE id = ?`).get(id);
    if (!pi) return { success: false, error: 'Not found' };
    db.prepare(`UPDATE purchase_invoices SET status = ? WHERE id = ?`).run(status, id);
    // When marking as Received, update stock for all items
    if (status === 'Received' && pi.status !== 'Received') {
      const items = db.prepare(`SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = ?`).all(id);
      const updStock = db.prepare(`UPDATE products SET current_stock = current_stock + ?, status = CASE WHEN current_stock + ? <= 5 THEN 'Critical' WHEN current_stock + ? <= reorder_level THEN 'Low' ELSE 'Good' END WHERE id = ?`);
      for (const item of items) updStock.run(item.qty, item.qty, item.qty, item.product_id);
    }
    return { success: true };
  });

  ipcMain.handle('purchases:createReturn', async (_, data) => {
    const db = getDb();
    const r = db.prepare(`INSERT INTO purchase_returns (po_number,vendor_id,vendor_name,original_invoice_id,purchased_qty,return_qty,return_total,return_reason,status,order_date) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(data.po_number||'', data.vendor_id||null, data.vendor_name||'', data.original_invoice_id||null,
          data.purchased_qty||0, data.return_qty||0, data.return_total||0, data.return_reason||'', 'Pending',
          new Date().toISOString().slice(0,10));
    const returnId = r.lastInsertRowid;
    if (data.items && data.items.length) {
      const ins = db.prepare(`INSERT INTO purchase_return_items (purchase_return_id,product_id,item_name,sku,purchased_qty,return_qty,purchase_price,total) VALUES (?,?,?,?,?,?,?,?)`);
      const updStock = db.prepare(`UPDATE products SET current_stock = current_stock - ?, status = CASE WHEN current_stock - ? <= 5 THEN 'Critical' WHEN current_stock - ? <= reorder_level THEN 'Low' ELSE 'Good' END WHERE id=?`);
      for (const item of data.items) {
        if (item.return_qty > 0) {
          ins.run(returnId, item.product_id, item.item_name||'', item.sku||'', item.purchased_qty||0, item.return_qty, item.purchase_price||0, item.return_qty * (item.purchase_price||0));
          updStock.run(item.return_qty, item.return_qty, item.return_qty, item.product_id);
        }
      }
    }
    return { success: true, id: returnId };
  });
  ipcMain.handle('purchases:getReturns', async () => {
    return getDb().prepare(`SELECT pr.*, v.vendor_name as vname FROM purchase_returns pr LEFT JOIN vendors v ON v.id=pr.vendor_id ORDER BY pr.order_date DESC`).all();
  });
  ipcMain.handle('purchases:updateReturnStatus', async (_, { id, resolution_type, notes } = {}) => {
    const db = getDb();
    const ret = db.prepare(`SELECT * FROM purchase_returns WHERE id = ?`).get(id);
    if (!ret) return { success: false, error: 'Return not found' };
    if (ret.status === 'Completed') return { success: false, error: 'Return already resolved' };
    if (!['refund', 'replacement'].includes(String(resolution_type || '').toLowerCase())) {
      return { success: false, error: 'Invalid resolution type' };
    }

    const items = db.prepare(`SELECT * FROM purchase_return_items WHERE purchase_return_id = ?`).all(id);
    const mode = String(resolution_type).toLowerCase();

    const tx = db.transaction(() => {
      if (mode === 'replacement') {
        // Vendor sends same items again: restore stock to reverse the prior return-out.
        const updStock = db.prepare(`
          UPDATE products
          SET current_stock = current_stock + ?,
              status = CASE
                WHEN current_stock + ? <= 5 THEN 'Critical'
                WHEN current_stock + ? <= reorder_level THEN 'Low'
                ELSE 'Good'
              END
          WHERE id = ?
        `);
        for (const item of items) {
          const qty = Number(item.return_qty || 0);
          if (qty > 0) updStock.run(qty, qty, qty, item.product_id);
        }
      } else if (mode === 'refund') {
        const refundAmount = Number(ret.return_total || 0);
        if (refundAmount > 0) {
          const year2 = new Date().getFullYear().toString().slice(-2);
          const lastTxn = db.prepare(`SELECT txn_id FROM banking_transactions ORDER BY id DESC LIMIT 1`).get();
          let txnSeq = 1;
          if (lastTxn) {
            const n = parseInt(String(lastTxn.txn_id || '').replace(`TXN-${year2}`, ''), 10);
            txnSeq = isNaN(n) ? 1 : n + 1;
          }
          const txnId = `TXN-${year2}${String(txnSeq).padStart(3,'0')}`;
          const acct = db.prepare(`SELECT id, account_name FROM accounts WHERE account_type='Cash' AND is_primary=1 LIMIT 1`).get()
            || db.prepare(`SELECT id, account_name FROM accounts WHERE account_type='Cash' LIMIT 1`).get();
          if (acct) {
            db.prepare(`INSERT INTO banking_transactions (txn_id,account_id,account_name,date,description,type,amount) VALUES (?,?,?,?,?,?,?)`)
              .run(txnId, acct.id, acct.account_name || 'Cash Account', new Date().toISOString().slice(0,10), `Vendor Refund: ${ret.po_number || ret.id}`, 'Credit', refundAmount);
            db.prepare(`UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?`).run(refundAmount, acct.id);
          }
        }
      }

      db.prepare(`
        UPDATE purchase_returns
        SET status = 'Completed',
            resolution_type = ?,
            resolution_notes = ?,
            resolved_at = datetime('now')
        WHERE id = ?
      `).run(mode, notes || '', id);
    });

    tx();
    return { success: true };
  });

  ipcMain.handle('purchases:getItems', async (_, { id }) => {
    return getDb().prepare(`SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = ?`).all(id);
  });

  // ─── PAY BILLS ────────────────────────────────────────────────────────────
  ipcMain.handle('paybills:getAll', async () => {
    const db = getDb();
    return db.prepare(`SELECT pb.*, v.vendor_name FROM pay_bills pb LEFT JOIN vendors v ON v.id = pb.vendor_id ORDER BY pb.created_at DESC`).all();
  });

  ipcMain.handle('paybills:create', async (_, data) => {
    const db = getDb();
    const payingAmount = data.paying_amount || 0;
    const paymentDate = data.payment_date || data.last_payment_date || new Date().toISOString().slice(0, 10);
    db.prepare(`INSERT INTO pay_bills (vendor_id,purchase_invoice_id,outstanding_amount,total_payable,last_payment_date,payment_mode,due_date,paying_amount,payment_status) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(data.vendor_id, data.purchase_invoice_id || null, data.outstanding_amount || 0, data.total_payable || payingAmount, paymentDate, data.payment_mode || 'Cash', data.due_date || null, payingAmount, 'Paid');
    if (data.purchase_invoice_id) {
      db.prepare(`UPDATE purchase_invoices SET paid_amount = paid_amount + ?, pending_amount = pending_amount - ?, status = CASE WHEN paid_amount + ? >= grand_total THEN 'Received' ELSE 'Partial' END WHERE id = ?`)
        .run(payingAmount, payingAmount, payingAmount, data.purchase_invoice_id);
    }
    // Auto banking transaction for vendor payment
    if (payingAmount > 0) {
      const year2p = new Date().getFullYear().toString().slice(-2);
      const lastTxnP = db.prepare(`SELECT txn_id FROM banking_transactions ORDER BY id DESC LIMIT 1`).get();
      let txnSeqP = 1;
      if (lastTxnP) { const n = parseInt(lastTxnP.txn_id.replace(`TXN-${year2p}`,''),10); txnSeqP = isNaN(n)?1:n+1; }
      const txn_id_p = `TXN-${year2p}${String(txnSeqP).padStart(3,'0')}`;
      const acctP = db.prepare(`SELECT id, account_name FROM accounts WHERE account_type='Cash' AND is_primary=1 LIMIT 1`).get() ||
                    db.prepare(`SELECT id, account_name FROM accounts WHERE account_type='Cash' LIMIT 1`).get();
      if (acctP) {
        db.prepare(`INSERT INTO banking_transactions (txn_id,account_id,account_name,date,description,type,amount) VALUES (?,?,?,?,?,?,?)`)
          .run(txn_id_p, acctP.id, acctP.account_name, paymentDate, `Vendor Payment: ${data.vendor_id}`, 'Debit', payingAmount);
        db.prepare(`UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?`).run(payingAmount, acctP.id);
      }
    }
    return { success: true };
  });

  // ─── BANKING ──────────────────────────────────────────────────────────────
  ipcMain.handle('banking:getAccounts', async () => {
    const db = getDb();
    return db.prepare(`SELECT * FROM accounts WHERE account_type IN ('Cash','Bank') AND is_active = 1`).all();
  });

  ipcMain.handle('banking:getTransactions', async () => {
    const db = getDb();
    return db.prepare(`SELECT * FROM banking_transactions ORDER BY date DESC LIMIT 50`).all();
  });

  ipcMain.handle('banking:addTransaction', async (_, data) => {
    const db = getDb();
    const year = new Date().getFullYear().toString().slice(-2);
    const last = db.prepare(`SELECT txn_id FROM banking_transactions ORDER BY id DESC LIMIT 1`).get();
    let seq = 1;
    if (last) { const n = parseInt(last.txn_id.replace(`TXN-${year}`, ''), 10); seq = isNaN(n) ? 1 : n + 1; }
    const txn_id = `TXN-${year}${String(seq).padStart(3, '0')}`;
    db.prepare(`INSERT INTO banking_transactions (txn_id,account_id,account_name,date,description,type,amount) VALUES (?,?,?,?,?,?,?)`)
      .run(txn_id, data.account_id, data.account_name, data.date, data.description, data.type, data.amount);
    const delta = data.type === 'Credit' ? data.amount : -data.amount;
    db.prepare(`UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?`).run(delta, data.account_id);
    return { success: true, txn_id };
  });

  // ─── EXPENSES ─────────────────────────────────────────────────────────────
  ipcMain.handle('expenses:getAll', async () => {
    const db = getDb();
    return db.prepare(`SELECT * FROM expenses ORDER BY expense_date DESC`).all();
  });

  ipcMain.handle('expenses:getStats', async () => {
    const db = getDb();
    const month = new Date().toISOString().slice(0, 7);
    const total = db.prepare(`SELECT COALESCE(SUM(amount),0) as val FROM expenses WHERE expense_date LIKE ?`).get(`${month}%`).val;
    const byCategory = db.prepare(`SELECT category, COALESCE(SUM(amount),0) as total FROM expenses WHERE expense_date LIKE ? GROUP BY category`).all(`${month}%`);
    return { total, byCategory };
  });

  ipcMain.handle('expenses:create', async (_, data) => {
    const db = getDb();
    const year = new Date().getFullYear().toString().slice(-2);
    const last = db.prepare(`SELECT expense_id FROM expenses ORDER BY id DESC LIMIT 1`).get();
    let seq = 1;
    if (last) { const n = parseInt((last.expense_id || '').replace(`EXP-${year}`, ''), 10); seq = isNaN(n) ? 1 : n + 1; }
    const expense_id = `EXP-${year}${String(seq).padStart(3, '0')}`;
    db.prepare(`INSERT INTO expenses (expense_id,title,amount,expense_date,category,account_id,paid_from) VALUES (?,?,?,?,?,?,?)`)
      .run(expense_id, data.title, data.amount, data.expense_date, data.category, data.account_id, data.paid_from);
    if (data.account_id) db.prepare(`UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?`).run(data.amount, data.account_id);
    // Auto banking transaction
    if (data.account_id) {
      const year2e = new Date().getFullYear().toString().slice(-2);
      const lastTxnE = db.prepare(`SELECT txn_id FROM banking_transactions ORDER BY id DESC LIMIT 1`).get();
      let txnSeqE = 1;
      if (lastTxnE) { const n = parseInt(lastTxnE.txn_id.replace(`TXN-${year2e}`,''),10); txnSeqE = isNaN(n)?1:n+1; }
      const txn_id_e = `TXN-${year2e}${String(txnSeqE).padStart(3,'0')}`;
      const acctE = db.prepare(`SELECT account_name FROM accounts WHERE id=?`).get(data.account_id);
      db.prepare(`INSERT INTO banking_transactions (txn_id,account_id,account_name,date,description,type,amount) VALUES (?,?,?,?,?,?,?)`)
        .run(txn_id_e, data.account_id, acctE?.account_name||'', data.expense_date, `Expense: ${data.title}`, 'Debit', data.amount);
    }
    return { success: true, expense_id };
  });

  // ─── REPORTS ──────────────────────────────────────────────────────────────
  ipcMain.handle('reports:sales', async (_, { from, to, branch_id }) => {
    const db = getDb();
    let q = `
      SELECT
        i.invoice_date as date,
        i.invoice_no as bill_no,
        i.customer_name,
        COALESCE(SUM(ii.qty), 0) as qty,
        COALESCE(i.grand_total, SUM(ii.amount), 0) as amount,
        i.status as payment_status,
        i.payment_mode,
        COALESCE(SUM(ii.qty * (ii.rate - COALESCE(p.purchase_price, 0))), 0) as profit,
        GROUP_CONCAT(
          ii.product_name || ' x' || ii.qty || ' @ ' || ii.rate,
          ' | '
        ) as items
      FROM invoices i
      JOIN invoice_items ii ON ii.invoice_id = i.id
      LEFT JOIN products p ON p.id = ii.product_id
      WHERE i.status != 'Draft' AND i.invoice_date BETWEEN ? AND ?
    `;
    const params = [from, to];
    if (branch_id) {
      q += ` AND i.branch_id = ?`;
      params.push(branch_id);
    }
    q += `
      GROUP BY i.id, i.invoice_date, i.invoice_no, i.customer_name, i.grand_total, i.status, i.payment_mode
      ORDER BY i.invoice_date DESC, i.id DESC
    `;
    const rows = db.prepare(q).all(...params);
    return rows;
  });

  ipcMain.handle('reports:stock', async () => {
    const db = getDb();
    return db.prepare(`
      SELECT p.name as item_name, c.name as category, p.opening_stock,
             COALESCE((SELECT SUM(qty) FROM purchase_invoice_items WHERE product_id = p.id),0) as purchase_qty,
             COALESCE((SELECT SUM(qty) FROM invoice_items WHERE product_id = p.id),0) as sales_qty,
             p.current_stock, p.purchase_price, p.selling_price,
             ROUND(((p.selling_price - p.purchase_price) / NULLIF(p.selling_price,0)) * 100, 2) as profit_margin
      FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.is_active = 1
    `).all();
  });

  ipcMain.handle('reports:customerOutstanding', async () => {
    const db = getDb();
    return db.prepare(`
      SELECT customer_name, invoice_no, invoice_date, grand_total as total_amount,
             paid_amount, (grand_total - paid_amount) as balance
      FROM invoices WHERE is_credit_sale = 1 AND status != 'Draft' ORDER BY invoice_date DESC
    `).all();
  });

  ipcMain.handle('reports:vendorOutstanding', async () => {
    const db = getDb();
    return db.prepare(`
      SELECT v.vendor_name, pi.po_number as bill_no, pi.purchase_date as bill_date,
             pi.grand_total as total_amount, pi.paid_amount,
             (pi.grand_total - pi.paid_amount) as balance
      FROM purchase_invoices pi JOIN vendors v ON v.id = pi.vendor_id
      WHERE pi.status != 'Received' ORDER BY pi.purchase_date DESC
    `).all();
  });

  ipcMain.handle('reports:profitLoss', async (_, { from, to }) => {
    const db = getDb();
    return db.prepare(`
      SELECT ii.product_name as product,
             SUM(ii.qty) as units_sold, p.purchase_price as cost_price,
             p.selling_price as sales_price,
             SUM(ii.qty * (ii.rate - p.purchase_price)) as total_profit,
             ROUND(((p.selling_price - p.purchase_price) / NULLIF(p.selling_price,0)) * 100, 2) as margin
      FROM invoice_items ii JOIN products p ON p.id = ii.product_id
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.status != 'Draft' AND i.invoice_date BETWEEN ? AND ?
      GROUP BY ii.product_name ORDER BY total_profit DESC
    `).all(from, to);
  });

  ipcMain.handle('reports:balanceSheet', async () => {
    const db = getDb();
    const cashAccounts = db.prepare(`SELECT account_name, current_balance, is_primary FROM accounts WHERE account_type IN ('Cash','Bank') AND is_active=1`).all();
    const closingStock = db.prepare(`SELECT COALESCE(SUM(current_stock*purchase_price),0) as val FROM products WHERE is_active=1`).get().val;
    const customerOutstanding = db.prepare(`SELECT COALESCE(SUM(grand_total-paid_amount),0) as val FROM invoices WHERE is_credit_sale=1`).get().val;
    const vendorOutstanding = db.prepare(`SELECT COALESCE(SUM(grand_total-paid_amount),0) as val FROM purchase_invoices WHERE status != 'Received'`).get().val;
    const ownerCapital = db.prepare(`SELECT COALESCE(SUM(opening_balance),0) as val FROM accounts WHERE account_type='Capital'`).get().val;
    const totalRevenue = db.prepare(`SELECT COALESCE(SUM(grand_total),0) as val FROM invoices WHERE status!='Draft'`).get().val;
    const totalCost = db.prepare(`SELECT COALESCE(SUM(grand_total),0) as val FROM purchase_invoices WHERE status!='Pending'`).get().val;
    const totalExpenses = db.prepare(`SELECT COALESCE(SUM(amount),0) as val FROM expenses`).get().val;
    const retainedEarnings = totalRevenue - totalCost - totalExpenses;
    return { cashAccounts, closingStock, customerOutstanding, vendorOutstanding, ownerCapital, retainedEarnings };
  });

  ipcMain.handle('reports:expenses', async (_, { from, to, branch_id, category } = {}) => {
    const db = getDb();
    let q = `SELECT e.expense_id, e.title, e.category, e.amount, e.expense_date, e.paid_from, b.name as branch_name
             FROM expenses e LEFT JOIN branches b ON b.id = e.branch_id WHERE 1=1`;
    const params = [];
    if (from && to) { q += ` AND e.expense_date BETWEEN ? AND ?`; params.push(from, to); }
    if (branch_id) { q += ` AND e.branch_id = ?`; params.push(branch_id); }
    if (category && category !== 'All') { q += ` AND e.category = ?`; params.push(category); }
    q += ` ORDER BY e.expense_date DESC`;
    const rows = db.prepare(q).all(...params);
    const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
    return { rows, total };
  });

  // ─── GLOBAL SEARCH ────────────────────────────────────────────────────────
  ipcMain.handle('search:global', async (_, { query }) => {
    const db = getDb();
    const q = `%${query}%`;
    const invoices = db.prepare(`SELECT 'invoice' as type, id, invoice_no, customer_name, grand_total, status, invoice_date as date FROM invoices WHERE invoice_no LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ? LIMIT 5`).all(q, q, q);
    const products = db.prepare(`SELECT 'product' as type, id, sku, name, current_stock, selling_price, status FROM products WHERE name LIKE ? OR sku LIKE ? OR barcode LIKE ? AND is_active=1 LIMIT 5`).all(q, q, q);
    const vendors = db.prepare(`SELECT 'vendor' as type, id, vendor_name as name, company_name, phone FROM vendors WHERE vendor_name LIKE ? OR company_name LIKE ? LIMIT 3`).all(q, q);
    const users = db.prepare(`SELECT 'user' as type, id, name, mobile, role, is_active FROM users WHERE name LIKE ? OR mobile LIKE ? LIMIT 3`).all(q, q);
    const expenses = db.prepare(`SELECT 'expense' as type, id, expense_id, title as name, amount, expense_date as date FROM expenses WHERE title LIKE ? OR expense_id LIKE ? LIMIT 3`).all(q, q);
    return { invoices, products, vendors, users, expenses };
  });

  // ─── SETTINGS ─────────────────────────────────────────────────────────────
  ipcMain.handle('settings:getCompany', async () => getDb().prepare(`SELECT * FROM company_profile WHERE id=1`).get());
  ipcMain.handle('settings:saveCompany', async (_, data) => {
    getDb().prepare(`UPDATE company_profile SET company_name=?,mobile=?,email=?,address=?,logo_path=? WHERE id=1`).run(
      data.company_name,
      data.mobile,
      data.email,
      data.address,
      data.logo_path || ''
    );
    return { success: true };
  });

  ipcMain.handle('accounts:getAll', async () => getDb().prepare(`SELECT * FROM accounts ORDER BY created_at`).all());
  ipcMain.handle('accounts:create', async (_, data) => {
    const db = getDb();
    db.prepare(`INSERT INTO accounts (account_name,account_type,opening_balance,current_balance,as_of_date) VALUES (?,?,?,?,?)`)
      .run(data.account_name, data.account_type, data.opening_balance, data.opening_balance, data.as_of_date);
    return { success: true };
  });
  ipcMain.handle('accounts:update', async (_, { id, ...data }) => {
    getDb().prepare(`UPDATE accounts SET account_name=?,account_type=?,opening_balance=? WHERE id=?`).run(data.account_name, data.account_type, data.opening_balance, id);
    return { success: true };
  });

  ipcMain.handle('settings:getAll', async () => {
    const rows = getDb().prepare(`SELECT key, value FROM app_settings`).all();
    return rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
  });
  ipcMain.handle('settings:saveAll', async (_, data) => {
    const db = getDb();
    const ups = db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`);
    for (const [key, value] of Object.entries(data)) ups.run(key, String(value));
    return { success: true };
  });

  ipcMain.handle('settings:uploadLogo', async (_, { filePath }) => {
    const { app } = require('electron');
    const fs = require('fs');
    const pathMod = require('path');
    try {
      if (!filePath) return { success: false, error: 'No file selected' };
      const dest = pathMod.join(app.getPath('userData'), 'company_logo' + pathMod.extname(filePath));
      fs.copyFileSync(filePath, dest);
      getDb().prepare(`UPDATE company_profile SET logo_path=? WHERE id=1`).run(dest);
      return { success: true, logo_path: dest };
    } catch (error) {
      return { success: false, error: error.message || 'Failed to upload logo' };
    }
  });

  ipcMain.handle('settings:getLogoDataUrl', async (_, { filePath } = {}) => {
    const fs = require('fs');
    const pathMod = require('path');
    try {
      if (!filePath || !fs.existsSync(filePath)) return { success: false, dataUrl: '' };
      const ext = pathMod.extname(filePath).toLowerCase();
      const mime = ext === '.png'
        ? 'image/png'
        : (ext === '.jpg' || ext === '.jpeg')
        ? 'image/jpeg'
        : ext === '.gif'
        ? 'image/gif'
        : ext === '.webp'
        ? 'image/webp'
        : null;
      if (!mime) return { success: false, dataUrl: '' };
      const base64 = fs.readFileSync(filePath).toString('base64');
      return { success: true, dataUrl: `data:${mime};base64,${base64}` };
    } catch (error) {
      return { success: false, dataUrl: '', error: error.message || 'Failed to load logo' };
    }
  });

  ipcMain.handle('settings:chooseLogoFile', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png','jpg','jpeg','gif','webp'] }] });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('settings:chooseRestoreFile', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'SQLite DB', extensions: ['db','sqlite'] }] });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('settings:restoreBackup', async (_, { filePath }) => {
    const { app } = require('electron');
    const fs = require('fs');
    const pathMod = require('path');
    const dest = pathMod.join(app.getPath('userData'), 'invoicing.db');
    fs.copyFileSync(filePath, dest);
    getDb().prepare(`INSERT INTO backups (type,date_time,size_mb,status) VALUES ('Restore',?,0.0,'Success')`).run(new Date().toISOString());
    return { success: true };
  });

  ipcMain.handle('products:importCSV', async (_, { rows }) => {
    const db = getDb();
    const catMap = {};
    db.prepare(`SELECT id, name FROM categories`).all().forEach(c => { catMap[c.name.toLowerCase()] = c.id; });
    const lastProd = db.prepare(`SELECT sku FROM products ORDER BY id DESC LIMIT 1`).get();
    let seq = 1;
    if (lastProd) { const n = parseInt(lastProd.sku.replace('ITM-',''), 10); seq = isNaN(n) ? 1 : n + 1; }
    const ins = db.prepare(`INSERT OR IGNORE INTO products (sku,name,category_id,purchase_price,selling_price,opening_stock,current_stock,reorder_level,barcode,unit,hsn_code) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const upd = db.prepare(`UPDATE products SET purchase_price=?,selling_price=?,current_stock=?,reorder_level=?,barcode=?,unit=?,hsn_code=? WHERE name=?`);
    let inserted = 0, updated = 0;
    for (const row of rows) {
      const catId = catMap[(row.category||'').toLowerCase()] || null;
      const stock = parseInt(row.current_stock||row.stock||0, 10);
      const existing = db.prepare(`SELECT id FROM products WHERE name=?`).get(row.name);
      if (existing) {
        upd.run(parseFloat(row.purchase_price||0), parseFloat(row.selling_price||0), stock, parseInt(row.reorder_level||10,10), row.barcode||'', row.unit||'pcs', row.hsn_code||'', row.name);
        updated++;
      } else {
        const sku = `ITM-${String(seq).padStart(3,'0')}`; seq++;
        ins.run(sku, row.name, catId, parseFloat(row.purchase_price||0), parseFloat(row.selling_price||0), stock, stock, parseInt(row.reorder_level||10,10), row.barcode||'', row.unit||'pcs', row.hsn_code||'');
        inserted++;
      }
    }
    db.prepare(`UPDATE products SET status = CASE WHEN current_stock <= 5 THEN 'Critical' WHEN current_stock <= reorder_level THEN 'Low' ELSE 'Good' END WHERE is_active=1`).run();
    return { success: true, inserted, updated };
  });
  ipcMain.handle('products:exportCSV', async () => {
    return getDb().prepare(`SELECT p.sku,p.name,c.name as category,p.unit,p.hsn_code,p.purchase_price,p.selling_price,p.current_stock,p.reorder_level,p.barcode FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.is_active=1 ORDER BY p.sku`).all();
  });
  ipcMain.handle('products:chooseImportFile', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Import Files', extensions: ['csv','xlsx','xls','json'] }] });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('products:parseImportFile', async (_, { filePath }) => {
    const fs = require('fs');
    const path = require('path');
    const XLSX = require('xlsx');

    function normalizeRow(row) {
      const map = {};
      for (const [k, v] of Object.entries(row || {})) {
        if (!k) continue;
        const nk = String(k).trim().toLowerCase().replace(/\s+/g, '_');
        map[nk] = typeof v === 'string' ? v.trim() : v;
      }
      return map;
    }

    function parseCsv(content) {
      const lines = content
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter(line => line.trim().length > 0);
      if (lines.length < 2) return [];

      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase().replace(/\s+/g, '_'));
      const rows = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const row = {};
        headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
        rows.push(normalizeRow(row));
      }
      return rows;
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.csv') {
      const content = fs.readFileSync(filePath, 'utf8');
      return parseCsv(content);
    }
    if (ext === '.json') {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeRow).filter(r => Object.keys(r).length > 0);
    }
    if (ext === '.xlsx' || ext === '.xls') {
      const wb = XLSX.readFile(filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      return rows.map(normalizeRow).filter(r => Object.keys(r).length > 0);
    }
    return [];
  });
  ipcMain.handle('products:chooseTemplatePath', async (_, { format }) => {
    const { dialog } = require('electron');
    const optionsByFormat = {
      csv: { defaultPath: 'products_import_template.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] },
      xlsx: { defaultPath: 'products_import_template.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] },
      json: { defaultPath: 'products_import_template.json', filters: [{ name: 'JSON', extensions: ['json'] }] },
    };
    const opts = optionsByFormat[format] || optionsByFormat.csv;
    const result = await dialog.showSaveDialog(opts);
    if (result.canceled) return null;
    return result.filePath;
  });
  ipcMain.handle('products:chooseSaveFile', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showSaveDialog({ defaultPath: 'products.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (result.canceled) return null;
    return result.filePath;
  });

  ipcMain.handle('invoices:autoComplete', async () => {
    const db = getDb();
    const result = db.prepare(`UPDATE invoices SET status='Completed', updated_at=datetime('now') WHERE status IN ('Paid','Credit','Active') AND CAST(julianday('now') - julianday(invoice_date) AS INTEGER) > 15`).run();
    return { success: true, updated: result.changes };
  });

  ipcMain.handle('users:getAll', async () => {
    const users = getDb().prepare(`SELECT id,name,mobile,email,role,is_active,avatar_path,branch_id,created_at FROM users ORDER BY created_at`).all();
    return users;
  });
  ipcMain.handle('users:create', async (_, data) => {
    const hash = bcrypt.hashSync(data.password, 10);
    getDb().prepare(`INSERT INTO users (name,mobile,email,password,role,branch_id) VALUES (?,?,?,?,?,?)`).run(data.name, data.mobile, data.email, hash, data.role, data.branch_id||null);
    return { success: true };
  });
  ipcMain.handle('users:update', async (_, { id, ...data }) => {
    const db = getDb();
    if (data.password) {
      const hash = bcrypt.hashSync(data.password, 10);
      db.prepare(`UPDATE users SET name=?,mobile=?,email=?,role=?,branch_id=?,password=? WHERE id=?`).run(data.name, data.mobile, data.email, data.role, data.branch_id||null, hash, id);
    } else {
      db.prepare(`UPDATE users SET name=?,mobile=?,email=?,role=?,branch_id=? WHERE id=?`).run(data.name, data.mobile, data.email, data.role, data.branch_id||null, id);
    }
    return { success: true };
  });
  ipcMain.handle('users:updatePassword', async (_, { id, password }) => {
    if (!password || password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters.' };
    }
    const db = getDb();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`UPDATE users SET password=? WHERE id=?`).run(hash, id);
    return { success: true };
  });
  ipcMain.handle('users:toggleActive', async (_, { id, is_active }) => {
    getDb().prepare(`UPDATE users SET is_active=? WHERE id=?`).run(is_active, id);
    return { success: true };
  });
  ipcMain.handle('users:delete', async (_, { id }) => {
    getDb().prepare(`DELETE FROM users WHERE id=?`).run(id);
    return { success: true };
  });

  ipcMain.handle('branches:getAll', async () => getDb().prepare(`SELECT * FROM branches WHERE is_active=1 ORDER BY id`).all());
  ipcMain.handle('branches:create', async (_, data) => {
    const db = getDb();
    const r = db.prepare(`INSERT INTO branches (name, code, address, contact, is_active) VALUES (?,?,?,?,1)`)
      .run(data.name, data.code||'', data.address||'', data.contact||'');
    return { success: true, id: r.lastInsertRowid };
  });
  ipcMain.handle('branches:update', async (_, { id, ...data }) => {
    getDb().prepare(`UPDATE branches SET name=?,code=?,address=?,contact=? WHERE id=?`)
      .run(data.name, data.code||'', data.address||'', data.contact||'', id);
    return { success: true };
  });
  ipcMain.handle('branches:delete', async (_, { id }) => {
    const db = getDb();
    const hasInvoices = db.prepare(`SELECT id FROM invoices WHERE branch_id=? LIMIT 1`).get(id);
    if (hasInvoices) return { success: false, error: 'Branch has linked invoices and cannot be deleted.' };
    db.prepare(`UPDATE branches SET is_active=0 WHERE id=?`).run(id);
    return { success: true };
  });

  // ─── BACKUP ───────────────────────────────────────────────────────────────
  function getBackupPaths() {
    const { app } = require('electron');
    const pathMod = require('path');
    const userDataDir = app.getPath('userData');
    const dbPath = pathMod.join(userDataDir, 'invoicing.db');
    const backupsDir = pathMod.join(userDataDir, 'backups');
    return { dbPath, backupsDir };
  }

  function makeBackupFilename(prefix = 'invoicing_backup') {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `${prefix}_${stamp}.db`;
  }

  function createDatabaseBackup(typeLabel) {
    const db = getDb();
    const fs = require('fs');
    const pathMod = require('path');
    const { dbPath, backupsDir } = getBackupPaths();

    try {
      fs.mkdirSync(backupsDir, { recursive: true });

      // Ensure WAL pages are checkpointed into the main DB file before copy.
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}

      const filename = makeBackupFilename('invoicing_backup');
      const backupPath = pathMod.join(backupsDir, filename);
      fs.copyFileSync(dbPath, backupPath);

      const stats = fs.statSync(backupPath);
      const sizeMb = Number((stats.size / (1024 * 1024)).toFixed(2));
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO backups (type,date_time,size_mb,status) VALUES (?,?,?,?)`).run(typeLabel, now, sizeMb, 'Success');

      return { success: true, filePath: backupPath, size_mb: sizeMb };
    } catch (error) {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO backups (type,date_time,size_mb,status) VALUES (?,?,?,?)`).run(typeLabel, now, 0.0, 'Failed');
      return { success: false, error: error.message || 'Backup failed' };
    }
  }

  ipcMain.handle('backup:getLogs', async () => getDb().prepare(`SELECT * FROM backups ORDER BY id DESC LIMIT 20`).all());

  ipcMain.handle('backup:now', async () => {
    return createDatabaseBackup('Manual Backup (Admin)');
  });

  ipcMain.handle('backup:runDailyCheck', async () => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const alreadyDone = db.prepare(`SELECT id FROM backups WHERE type = 'Auto Backup' AND substr(date_time,1,10) = ? LIMIT 1`).get(today);
    if (alreadyDone) return { success: true, skipped: true, reason: 'already-backed-up-today' };
    return createDatabaseBackup('Auto Backup');
  });

  ipcMain.handle('backup:getFolderPath', async () => {
    const fs = require('fs');
    const { backupsDir } = getBackupPaths();
    try {
      fs.mkdirSync(backupsDir, { recursive: true });
      return { success: true, path: backupsDir };
    } catch (error) {
      return { success: false, error: error.message || 'Failed to resolve backup folder' };
    }
  });

  ipcMain.handle('backup:openFolder', async () => {
    const fs = require('fs');
    const { shell } = require('electron');
    const { pathToFileURL } = require('url');
    const { backupsDir } = getBackupPaths();
    try {
      fs.mkdirSync(backupsDir, { recursive: true });

      // Electron shell.openPath returns '' on success, or an error string on failure.
      const openResult = await shell.openPath(backupsDir);
      if (!openResult) {
        return { success: true, path: backupsDir };
      }

      // Fallback for environments where openPath fails.
      await shell.openExternal(pathToFileURL(backupsDir).href);
      return { success: true, path: backupsDir };
    } catch (error) {
      return { success: false, error: error.message || 'Failed to open backup folder' };
    }
  });

  // ─── NOTIFICATIONS ────────────────────────────────────────────────────────
  // Generate system notifications from live DB state (low stock, credit sales, overdue bills)
  function generateNotifications(db) {
    // Low/Critical stock alerts
    const lowStock = db.prepare(`SELECT id, name, current_stock, status FROM products WHERE status IN ('Low','Critical') AND is_active=1`).all();
    for (const p of lowStock) {
      const key = `stock-${p.id}`;
      const exists = db.prepare(`SELECT id FROM notifications WHERE type=? AND message LIKE ?`).get('low_stock', `%${p.name}%`);
      if (!exists) {
        db.prepare(`INSERT INTO notifications (type,title,message,link) VALUES (?,?,?,?)`)
          .run('low_stock',
            p.status === 'Critical' ? 'Critical Stock Alert' : 'Low Stock Alert',
            `${p.name} has only ${p.current_stock} unit(s) remaining`,
            '/inventory');
      }
    }

    // Unpaid credit invoices overdue by 3+ days
    const creditInvoices = db.prepare(`SELECT id, invoice_no, customer_name, grand_total, invoice_date FROM invoices WHERE is_credit_sale=1 AND status='Credit' AND date(invoice_date) <= date('now','-3 days')`).all();
    for (const inv of creditInvoices) {
      const exists = db.prepare(`SELECT id FROM notifications WHERE type='credit_due' AND message LIKE ?`).get(`%${inv.invoice_no}%`);
      if (!exists) {
        db.prepare(`INSERT INTO notifications (type,title,message,link) VALUES (?,?,?,?)`)
          .run('credit_due', 'Payment Overdue',
            `Invoice ${inv.invoice_no} from ${inv.customer_name} (₹${inv.grand_total}) is past due`,
            '/billing');
      }
    }

    // Pending purchase invoices with due date passed
    const overdueBills = db.prepare(`SELECT id, po_number, vendor_name, grand_total FROM purchase_invoices WHERE status NOT IN ('Received','Paid') AND due_date IS NOT NULL AND date(due_date) < date('now')`).all();
    for (const bill of overdueBills) {
      const exists = db.prepare(`SELECT id FROM notifications WHERE type='bill_due' AND message LIKE ?`).get(`%${bill.po_number}%`);
      if (!exists) {
        db.prepare(`INSERT INTO notifications (type,title,message,link) VALUES (?,?,?,?)`)
          .run('bill_due', 'Bill Payment Due',
            `Purchase ${bill.po_number} from ${bill.vendor_name} (₹${bill.grand_total}) is overdue`,
            '/vendors');
      }
    }
  }

  ipcMain.handle('notifications:getAll', async () => {
    const db = getDb();
    generateNotifications(db);
    const notifications = db.prepare(`SELECT * FROM notifications ORDER BY is_read ASC, created_at DESC LIMIT 50`).all();
    const unread = db.prepare(`SELECT COUNT(*) as count FROM notifications WHERE is_read=0`).get().count;
    return { notifications, unread };
  });

  ipcMain.handle('notifications:markRead', async (_, { id } = {}) => {
    const db = getDb();
    if (id) {
      db.prepare(`UPDATE notifications SET is_read=1 WHERE id=?`).run(id);
    } else {
      db.prepare(`UPDATE notifications SET is_read=1`).run();
    }
    return { success: true };
  });

  ipcMain.handle('notifications:delete', async (_, { id } = {}) => {
    const db = getDb();
    if (id) {
      db.prepare(`DELETE FROM notifications WHERE id=?`).run(id);
    } else {
      db.prepare(`DELETE FROM notifications WHERE is_read=1`).run();
    }
    return { success: true };
  });

  ipcMain.handle('notifications:add', async (_, { type, title, message, link } = {}) => {
    const db = getDb();
    const r = db.prepare(`INSERT INTO notifications (type,title,message,link) VALUES (?,?,?,?)`).run(type, title, message, link || null);
    return { success: true, id: r.lastInsertRowid };
  });

  // ─── INVOICE DESIGNER ────────────────────────────────────────────────────
  ipcMain.handle('invoiceSettings:get', async () => {
    const db = getDb();
    let row = db.prepare(`SELECT * FROM invoice_settings WHERE id = 1`).get();
    if (!row) {
      db.prepare(`INSERT INTO invoice_settings (id) VALUES (1)`).run();
      row = db.prepare(`SELECT * FROM invoice_settings WHERE id = 1`).get();
    }
    return { ...row, custom_fields: JSON.parse(row.custom_fields || '[]') };
  });

  ipcMain.handle('invoiceSettings:save', async (_, data) => {
    const db = getDb();
    const payload = { ...data, custom_fields: JSON.stringify(data.custom_fields || []) };
    const exists = db.prepare(`SELECT id FROM invoice_settings WHERE id = 1`).get();
    if (exists) {
      const cols = Object.keys(payload).filter(k => k !== 'id').map(k => `${k} = ?`).join(', ');
      const vals = Object.keys(payload).filter(k => k !== 'id').map(k => payload[k]);
      db.prepare(`UPDATE invoice_settings SET ${cols} WHERE id = 1`).run(...vals);
    } else {
      db.prepare(`INSERT INTO invoice_settings (id) VALUES (1)`).run();
      const cols = Object.keys(payload).filter(k => k !== 'id').map(k => `${k} = ?`).join(', ');
      const vals = Object.keys(payload).filter(k => k !== 'id').map(k => payload[k]);
      db.prepare(`UPDATE invoice_settings SET ${cols} WHERE id = 1`).run(...vals);
    }
    return { success: true };
  });

  // ─── CLEAR DATA ───────────────────────────────────────────────────────────
  // Each module maps to the tables that hold its transactional data.
  // Lookup/config tables (categories, vendors, products) are treated as
  // "inventory" and "vendors" scope respectively.
  const CLEAR_TABLES = {
    billing:   ['invoice_items', 'invoices', 'return_exchange_items', 'return_exchange'],
    inventory: ['products', 'categories'],
    vendors:   ['purchase_return_items', 'purchase_returns', 'purchase_invoice_items', 'purchase_invoices', 'pay_bills', 'vendors'],
    banking:   ['banking_transactions'],
    expenses:  ['expenses'],
    reports:   [],   // reports are derived — nothing to delete
    notifications: ['notifications'],
  };

  ipcMain.handle('settings:clearData', async (_, { modules } = {}) => {
    const db = getDb();
    const cleared = [];
    const errors = [];

    const clearAll = db.transaction((mods) => {
      for (const mod of mods) {
        const tables = CLEAR_TABLES[mod];
        if (!tables || tables.length === 0) continue;
        for (const tbl of tables) {
          try {
            db.prepare(`DELETE FROM ${tbl}`).run();
            cleared.push(tbl);
          } catch (e) {
            errors.push(`${tbl}: ${e.message}`);
          }
        }
      }
    });

    clearAll(modules || []);

    // Log to backup activity
    if (cleared.length > 0) {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO backups (type,date_time,size_mb,status) VALUES (?,?,0.0,'Success')`).run(`Data Cleared (${modules.join(', ')})`, now);
    }

    return { success: errors.length === 0, cleared, errors };
  });

  ipcMain.handle('settings:getTableCounts', async () => {
    const db = getDb();
    return {
      billing:   db.prepare(`SELECT COUNT(*) as c FROM invoices`).get().c,
      inventory: db.prepare(`SELECT COUNT(*) as c FROM products`).get().c,
      vendors:   db.prepare(`SELECT COUNT(*) as c FROM vendors`).get().c,
      banking:   db.prepare(`SELECT COUNT(*) as c FROM banking_transactions`).get().c,
      expenses:  db.prepare(`SELECT COUNT(*) as c FROM expenses`).get().c,
      notifications: db.prepare(`SELECT COUNT(*) as c FROM notifications`).get().c,
    };
  });
};
