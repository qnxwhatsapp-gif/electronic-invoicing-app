import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { useBarcodeGun } from '../hooks/useBarcodeGun';
import BarcodeScanner from '../components/BarcodeScanner';

// -- Print Invoice ----------------------------------------------------------
async function printInvoice(invoice) {
  if (!invoice) return;
  const invoiceSettings = await window.electron.invoke('invoiceSettings:get', {}).catch(() => null);
  const companyProfile = await window.electron.invoke('settings:getCompany', {}).catch(() => null);
  const toBool = (v, fallback = false) => {
    if (v === undefined || v === null) return fallback;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = String(v).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'off'].includes(s)) return false;
    return fallback;
  };

  const footerNote = invoiceSettings?.footer_notes || '';
  const termsAndConditions = invoiceSettings?.terms_conditions || '';
  const companyName = invoiceSettings?.seller_name || companyProfile?.company_name || 'Invoicing App';
  const sellerTagline = invoiceSettings?.seller_tagline || '';
  const templateColor = invoiceSettings?.template_color || '#111111';
  const showCustomerPhone = toBool(invoiceSettings?.show_customer_phone, true);
  const showDueDate = toBool(invoiceSettings?.show_due_date, true);
  const showBankDetails = toBool(invoiceSettings?.show_bank_details, true);
  const customFields = Array.isArray(invoiceSettings?.custom_fields) ? invoiceSettings.custom_fields : [];
  const companyContact = [
    invoiceSettings?.seller_address || companyProfile?.address || '',
    [invoiceSettings?.seller_phone || companyProfile?.mobile, invoiceSettings?.seller_email || companyProfile?.email].filter(Boolean).join(' | '),
    invoiceSettings?.seller_website || '',
    [invoiceSettings?.seller_gstin ? `GSTIN: ${invoiceSettings.seller_gstin}` : '', invoiceSettings?.seller_pan ? `PAN: ${invoiceSettings.seller_pan}` : ''].filter(Boolean).join(' | ')
  ].filter(Boolean).join('<br>');
  const logoPath = companyProfile?.logo_path || invoiceSettings?.seller_logo_path || '';
  let logoUrl = '';
  if (logoPath) {
    const logoRes = await window.electron.invoke('settings:getLogoDataUrl', { filePath: logoPath }).catch(() => null);
    logoUrl = logoRes?.success ? (logoRes.dataUrl || '') : '';
  }
  const printedAt = new Date();
  const printedDate = printedAt.toISOString().slice(0, 10);
  const printedTime = printedAt.toLocaleTimeString();
  const items = invoice.items || [];
  const rows = items.map((it, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${it.product_name || it.name || ''}</td>
      <td>${it.product_code || it.sku || ''}</td>
      <td style="text-align:center">${it.qty}</td>
      <td style="text-align:right">Rs.${Number(it.rate).toLocaleString('en-IN', {minimumFractionDigits:2})}</td>
      <td style="text-align:right">Rs.${Number(it.amount).toLocaleString('en-IN', {minimumFractionDigits:2})}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><title>Invoice ${invoice.invoice_no}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; font-size: 13px; color: #111; padding: 32px; }
    .preview-toolbar { display:flex; justify-content:flex-end; gap:8px; margin-bottom:14px; }
    .preview-btn { padding:8px 14px; border:1px solid #d1d5db; border-radius:8px; background:#fff; cursor:pointer; font-size:12px; font-weight:600; }
    .preview-btn.primary { background:${templateColor}; color:#fff; border-color:${templateColor}; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; padding-bottom:16px; border-bottom:2px solid ${templateColor}; }
    .company-header { display:flex; align-items:center; gap:10px; }
    .company-logo { width:52px; height:52px; object-fit:contain; border:1px solid #e5e7eb; border-radius:8px; padding:4px; background:#fff; }
    .company-name { font-size:22px; font-weight:700; }
    .company-info { font-size:12px; color:#555; margin-top:4px; line-height:1.6; }
    .invoice-title { font-size:28px; font-weight:700; color:${templateColor}; text-align:right; }
    .invoice-meta { font-size:12px; text-align:right; color:#555; margin-top:4px; line-height:1.8; }
    .bill-to { margin:20px 0; display:flex; justify-content:space-between; }
    .bill-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:14px 18px; flex:1; margin-right:12px; }
    .bill-box:last-child { margin-right:0; }
    .bill-box label { font-size:10px; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px; }
    table { width:100%; border-collapse:collapse; margin:20px 0; }
    th { background:${templateColor}; color:#fff; padding:10px 12px; text-align:left; font-size:12px; }
    td { padding:9px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; }
    tr:nth-child(even) td { background:#f8fafc; }
    .totals { margin-left:auto; width:260px; }
    .totals-row { display:flex; justify-content:space-between; padding:5px 0; font-size:13px; }
    .totals-row.grand { font-weight:700; font-size:16px; border-top:2px solid ${templateColor}; padding-top:8px; margin-top:4px; }
    .custom-fields { margin-top:12px; border:1px dashed #e2e8f0; border-radius:8px; padding:10px 12px; font-size:12px; color:#475569; }
    .status-badge { display:inline-block; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:700; }
    .status-Paid { background:#d1fae5; color:#065f46; }
    .status-Credit { background:#dbeafe; color:#1e40af; }
    .status-Draft { background:#f1f5f9; color:#475569; }
    .footer { margin-top:32px; padding-top:16px; border-top:1px solid #e2e8f0; font-size:12px; color:#64748b; }
    .payment-badge { font-size:12px; background:#f1f5f9; padding:4px 10px; border-radius:6px; display:inline-block; margin-top:4px; }
    @media print { body { padding:16px; } .preview-toolbar { display:none; } }
  </style></head><body>
  <div class="preview-toolbar">
    <button class="preview-btn" onclick="window.close()">Close</button>
    <button class="preview-btn primary" onclick="window.print()">Print (Ctrl/Cmd+P)</button>
  </div>
  <div class="header">
    <div>
      <div class="company-header">
        ${logoUrl ? `<img class="company-logo" src="${logoUrl}" alt="Company Logo" />` : ''}
        <div>
          <div class="company-name">${companyName}</div>
          ${sellerTagline ? `<div style="font-size:12px;color:#64748b;margin-top:2px">${sellerTagline}</div>` : ''}
          <div class="company-info">${companyContact || '-'}</div>
        </div>
      </div>
    </div>
    <div>
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-meta">
        <b>${invoice.invoice_no}</b><br>
        Date: ${invoice.invoice_date}<br>
        Printed: ${printedDate} ${printedTime}<br>
        ${(showDueDate && invoice.due_date) ? `Due: ${invoice.due_date}<br>` : ''}
        Status: <span class="status-badge status-${invoice.status}">${invoice.status}</span>
      </div>
    </div>
  </div>

  <div class="bill-to">
    <div class="bill-box">
      <label>Bill To</label>
      <div style="font-weight:600;font-size:14px">${invoice.customer_name || 'Walk-in Customer'}</div>
      ${(showCustomerPhone && invoice.customer_phone) ? `<div style="color:#555;margin-top:3px">Ph: ${invoice.customer_phone}</div>` : ''}
      ${invoice.customer_address ? `<div style="color:#555;margin-top:3px">${invoice.customer_address}</div>` : ''}
    </div>
    <div class="bill-box">
      <label>Payment Details</label>
      <div class="payment-badge">${invoice.payment_mode || 'Cash'}</div>
      ${invoice.is_credit_sale ? '<div style="color:#b45309;margin-top:6px;font-size:12px">Credit Sale - Payment Pending</div>' : ''}
    </div>
  </div>

  <table>
    <thead><tr><th>#</th><th>Product</th><th>SKU</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    ${invoice.subtotal > 0 ? `<div class="totals-row"><span>Subtotal</span><span>Rs.${Number(invoice.subtotal).toLocaleString('en-IN',{minimumFractionDigits:2})}</span></div>` : ''}
    ${invoice.tax_amount > 0 ? `<div class="totals-row"><span>Tax</span><span>Rs.${Number(invoice.tax_amount).toLocaleString('en-IN',{minimumFractionDigits:2})}</span></div>` : ''}
    <div class="totals-row grand"><span>Grand Total</span><span>Rs.${Number(invoice.grand_total).toLocaleString('en-IN',{minimumFractionDigits:2})}</span></div>
  </div>

  ${(showBankDetails && (invoiceSettings?.bank_name || invoiceSettings?.bank_account_no || invoiceSettings?.bank_ifsc || invoiceSettings?.bank_branch)) ? `
  <div class="custom-fields">
    <div style="font-weight:700; margin-bottom:6px;">Bank Details</div>
    ${invoiceSettings?.bank_name ? `<div><strong>Bank:</strong> ${invoiceSettings.bank_name}</div>` : ''}
    ${invoiceSettings?.bank_account_no ? `<div><strong>A/C No:</strong> ${invoiceSettings.bank_account_no}</div>` : ''}
    ${invoiceSettings?.bank_ifsc ? `<div><strong>IFSC:</strong> ${invoiceSettings.bank_ifsc}</div>` : ''}
    ${invoiceSettings?.bank_branch ? `<div><strong>Branch:</strong> ${invoiceSettings.bank_branch}</div>` : ''}
  </div>` : ''}

  ${customFields.length ? `
  <div class="custom-fields">
    <div style="font-weight:700; margin-bottom:6px;">Custom Fields</div>
    ${customFields.map(f => `<div><strong>${f.label || 'Field'}:</strong> ${f.value || ''}</div>`).join('')}
  </div>` : ''}

  ${(invoice.internal_notes || footerNote || termsAndConditions) ? `
  <div class="footer">
    ${invoice.internal_notes ? `<div><strong>Notes:</strong> ${invoice.internal_notes}</div>` : ''}
    ${footerNote ? `<div style="margin-top:${invoice.internal_notes ? '8px' : '0'}"><strong>Footer Note:</strong> ${footerNote}</div>` : ''}
    ${termsAndConditions ? `<div style="margin-top:${(invoice.internal_notes || footerNote) ? '8px' : '0'}"><strong>Terms & Conditions:</strong> ${termsAndConditions}</div>` : ''}
  </div>` : ''}
  <script>
    function returnToApp() {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.focus();
        }
      } catch (e) {}
      try { window.close(); } catch (e) {}
    }

    window.addEventListener('afterprint', function() {
      // After print dialog closes (print or cancel), return to app screen.
      returnToApp();
    });

    document.addEventListener('keydown', function(e) {
      const k = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'p') {
        e.preventDefault();
        window.print();
      }
      if (k === 'escape') {
        e.preventDefault();
        returnToApp();
      }
    });
  </script>
  </body></html>`;

  const win = window.open('', '_blank', 'width=800,height=700');
  win.document.write(html);
  win.document.close();
  // Preview-first flow: user can inspect, then print via button or Ctrl/Cmd+P.
}

// -- Print Return/Exchange --------------------------------------------------
async function printReturnExchange(invoice, payload) {
  const invoiceSettings = await window.electron.invoke('invoiceSettings:get', {}).catch(() => null);
  const companyProfile = await window.electron.invoke('settings:getCompany', {}).catch(() => null);

  const companyName = invoiceSettings?.seller_name || companyProfile?.company_name || 'Invoicing App';
  const companyContact = [
    invoiceSettings?.seller_address || companyProfile?.address || '',
    [invoiceSettings?.seller_phone || companyProfile?.mobile, invoiceSettings?.seller_email || companyProfile?.email].filter(Boolean).join(' | '),
  ].filter(Boolean).join('<br>');
  const templateColor = invoiceSettings?.template_color || '#111111';
  const printedAt = new Date();
  const printedDate = printedAt.toISOString().slice(0, 10);
  const printedTime = printedAt.toLocaleTimeString();

  const returnRows = (payload.returnItems || []).map((it, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${it.product_name || it.name || ''}</td>
      <td style="text-align:center">${Number(it.returned_qty || 0)}</td>
      <td style="text-align:right">Rs.${Number(it.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
      <td style="text-align:right">Rs.${Number((it.returned_qty || 0) * (it.rate || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    </tr>
  `).join('');

  const exchangeRows = (payload.exchangeItems || []).map((it, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${it.product_name || it.name || ''}</td>
      <td style="text-align:center">${Number(it.qty || 0)}</td>
      <td style="text-align:right">Rs.${Number(it.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
      <td style="text-align:right">Rs.${Number((it.qty || 0) * (it.rate || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html><html><head><title>${payload.type} ${payload.returnId || ''}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; font-size: 13px; color: #111; padding: 32px; }
    .preview-toolbar { display:flex; justify-content:flex-end; gap:8px; margin-bottom:14px; }
    .preview-btn { padding:8px 14px; border:1px solid #d1d5db; border-radius:8px; background:#fff; cursor:pointer; font-size:12px; font-weight:600; }
    .preview-btn.primary { background:${templateColor}; color:#fff; border-color:${templateColor}; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; padding-bottom:14px; border-bottom:2px solid ${templateColor}; }
    .company-name { font-size:22px; font-weight:700; }
    .company-info { font-size:12px; color:#555; margin-top:4px; line-height:1.6; }
    .doc-title { font-size:24px; font-weight:700; color:${templateColor}; text-align:right; }
    .meta { font-size:12px; text-align:right; color:#555; margin-top:4px; line-height:1.8; }
    .box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 14px; margin-bottom:12px; }
    table { width:100%; border-collapse:collapse; margin:12px 0 16px; }
    th { background:${templateColor}; color:#fff; padding:10px 12px; text-align:left; font-size:12px; }
    td { padding:9px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; }
    .summary { margin-left:auto; width:320px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; }
    .row { display:flex; justify-content:space-between; padding:4px 0; }
    .grand { font-weight:700; font-size:15px; border-top:2px solid ${templateColor}; margin-top:6px; padding-top:8px; }
    .green { color:#16a34a; } .red { color:#ef4444; }
    @media print { body { padding:16px; } .preview-toolbar { display:none; } }
  </style></head><body>
  <div class="preview-toolbar">
    <button class="preview-btn" onclick="window.close()">Close</button>
    <button class="preview-btn primary" onclick="window.print()">Print (Ctrl/Cmd+P)</button>
  </div>
  <div class="header">
    <div>
      <div class="company-name">${companyName}</div>
      <div class="company-info">${companyContact || '-'}</div>
    </div>
    <div>
      <div class="doc-title">${payload.type === 'Exchange' ? 'EXCHANGE MEMO' : 'RETURN MEMO'}</div>
      <div class="meta">
        Ref: RE-${payload.returnId || '-'}<br>
        Printed: ${printedDate} ${printedTime}<br>
        Original Invoice: ${invoice.invoice_no || '-'}
      </div>
    </div>
  </div>
  <div class="box">
    <div><strong>Customer:</strong> ${invoice.customer_name || 'Walk-in Customer'}</div>
    <div><strong>Phone:</strong> ${invoice.customer_phone || '-'}</div>
    <div><strong>Invoice Date:</strong> ${invoice.invoice_date || '-'}</div>
  </div>

  <div style="font-weight:700; margin-top:2px;">Returned Items</div>
  <table>
    <thead><tr><th>#</th><th>Product</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Value</th></tr></thead>
    <tbody>${returnRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">No returned items</td></tr>'}</tbody>
  </table>

  ${payload.type === 'Exchange' ? `
    <div style="font-weight:700; margin-top:2px;">Exchange Items</div>
    <table>
      <thead><tr><th>#</th><th>Product</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Value</th></tr></thead>
      <tbody>${exchangeRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">No exchange items</td></tr>'}</tbody>
    </table>
  ` : ''}

  <div class="summary">
    <div class="row"><span>Return Value</span><span class="red">Rs.${Number(payload.returnTotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
    ${payload.type === 'Exchange' ? `<div class="row"><span>Exchange Value</span><span>Rs.${Number(payload.exchangeTotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>` : ''}
    <div class="row grand"><span>${payload.type === 'Exchange' ? 'Net Difference' : 'Refund Due'}</span>
      <span class="${Number(payload.netDifference || 0) > 0 ? 'green' : 'red'}">
        ${payload.type === 'Exchange'
          ? (Number(payload.netDifference || 0) > 0
              ? `+Rs.${Number(payload.netDifference || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} (customer paid)`
              : Number(payload.netDifference || 0) < 0
              ? `-Rs.${Math.abs(Number(payload.netDifference || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })} (refund)`
              : 'Rs.0.00')
          : `Rs.${Number(payload.returnTotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
        }
      </span>
    </div>
  </div>
  <script>
    document.addEventListener('keydown', function(e) {
      const k = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'p') { e.preventDefault(); window.print(); }
      if (k === 'escape') { e.preventDefault(); window.close(); }
    });
  </script>
  </body></html>`;

  const win = window.open('', '_blank', 'width=900,height=740');
  win.document.write(html);
  win.document.close();
}

// -- KebabMenu --------------------------------------------------------------
function KebabMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  return (
    <div ref={ref} style={{ position:'relative', display:'inline-block' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ background:'none', border:'1px solid #e2e8f0', cursor:'pointer', padding:'4px 10px', borderRadius:6, color:'#374151', fontSize:16, lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center', gap:2 }}
        title="Actions"
      >
        <svg width="14" height="14" viewBox="0 0 4 16" fill="currentColor">
          <circle cx="2" cy="2" r="1.5"/>
          <circle cx="2" cy="8" r="1.5"/>
          <circle cx="2" cy="14" r="1.5"/>
        </svg>
      </button>
      {open && (
        <div style={{ position:'absolute', right:0, top:'100%', background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, boxShadow:'0 4px 16px rgba(0,0,0,0.12)', zIndex:200, minWidth:180 }}>
          {items.map((item, i) => (
            <div key={i} onClick={() => { item.action(); setOpen(false); }}
              style={{ padding:'10px 16px', cursor:'pointer', fontSize:13, color:item.danger?'#ef4444':'#1e293b', borderBottom:i<items.length-1?'1px solid #f1f5f9':'none', display:'flex', alignItems:'center', gap:8 }}
              onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
              onMouseLeave={e => e.currentTarget.style.background='transparent'}>
              {item.icon && <span style={{fontSize:13, fontWeight:600, color:'#64748b', minWidth:20}}>{item.icon}</span>}{item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -- ViewInvoiceModal -------------------------------------------------------
function ViewInvoiceModal({ invoiceId, onClose, onReturn, onMarkPaid }) {
  const [inv, setInv] = useState(null);
  useEffect(() => {
    window.electron.invoke('invoices:getById', { id: invoiceId }).then(setInv);
  }, [invoiceId]);

  if (!inv) return (
    <div className="modal-overlay"><div className="modal-card" style={{textAlign:'center',padding:40}}>Loading...</div></div>
  );

  const statusColor = { Paid:'#16a34a', Credit:'#2563eb', Draft:'#64748b', Completed:'#64748b' }[inv.status] || '#64748b';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:16, width:680, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 24px 80px rgba(0,0,0,0.2)', display:'flex', flexDirection:'column' }}>
        {/* Header */}
        <div style={{ padding:'20px 24px', borderBottom:'1px solid #f1f5f9', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontWeight:700, fontSize:18 }}>{inv.invoice_no}</div>
            <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>{inv.invoice_date} &middot; <span style={{ color:statusColor, fontWeight:600 }}>{inv.status}</span></div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {inv.status === 'Draft' ? (
              <button
                className="btn btn-outline btn-sm"
                style={{ color:'#16a34a', borderColor:'#16a34a' }}
                onClick={() => { onClose(); onMarkPaid(inv); }}
              >
                Mark as Paid
              </button>
            ) : (
              <button className="btn btn-outline btn-sm" onClick={() => printInvoice(inv)}>Print</button>
            )}
            {(inv.status === 'Paid' || inv.status === 'Credit') && (
              <button className="btn btn-outline btn-sm" style={{ color:'#f97316', borderColor:'#f97316' }} onClick={() => { onClose(); onReturn(inv); }}>Return / Exchange</button>
            )}
            <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
          </div>
        </div>

        {/* Customer & Invoice Info */}
        <div style={{ padding:'16px 24px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, borderBottom:'1px solid #f1f5f9' }}>
          <div style={{ background:'#f8fafc', borderRadius:10, padding:'12px 16px' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', marginBottom:8 }}>Bill To</div>
            <div style={{ fontWeight:700, fontSize:15 }}>{inv.customer_name || 'Walk-in Customer'}</div>
            {inv.customer_phone && <div style={{ fontSize:12, color:'#64748b', marginTop:4 }}>Ph: {inv.customer_phone}</div>}
            {inv.customer_address && <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>{inv.customer_address}</div>}
          </div>
          <div style={{ background:'#f8fafc', borderRadius:10, padding:'12px 16px' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', marginBottom:8 }}>Payment</div>
            <div style={{ fontWeight:600 }}>{inv.payment_mode}</div>
            {inv.is_credit_sale
              ? <div style={{ fontSize:12, color:'#f97316', marginTop:4 }}>Credit Sale &ndash; Payment Pending</div>
              : <div style={{ fontSize:12, color:'#16a34a', marginTop:4 }}>Paid</div>}
            {inv.due_date && <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>Due: {inv.due_date}</div>}
          </div>
        </div>

        {/* Items */}
        <div style={{ padding:'0 24px' }}>
          <table className="data-table" style={{ fontSize:13 }}>
            <thead><tr><th>#</th><th>Product</th><th>SKU</th><th style={{textAlign:'center'}}>Qty</th><th style={{textAlign:'right'}}>Rate</th><th style={{textAlign:'right'}}>Amount</th></tr></thead>
            <tbody>
              {(inv.items||[]).map((it, i) => (
                <tr key={it.id}>
                  <td>{i+1}</td>
                  <td>{it.product_name||it.name}</td>
                  <td style={{color:'#64748b'}}>{it.product_code||it.sku||'-'}</td>
                  <td style={{textAlign:'center'}}>{it.qty}</td>
                  <td style={{textAlign:'right'}}>Rs.{Number(it.rate).toLocaleString()}</td>
                  <td style={{textAlign:'right',fontWeight:600}}>Rs.{Number(it.amount).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div style={{ padding:'16px 24px', borderTop:'1px solid #f1f5f9' }}>
          <div style={{ marginLeft:'auto', width:260 }}>
            {[
              { label:'Subtotal', val: inv.subtotal },
              { label:'Tax', val: inv.tax_amount },
            ].filter(r => r.val > 0).map(r => (
              <div key={r.label} style={{ display:'flex', justifyContent:'space-between', fontSize:13, padding:'4px 0', color:'#64748b' }}>
                <span>{r.label}</span><span>Rs.{Number(r.val).toLocaleString('en-IN',{minimumFractionDigits:2})}</span>
              </div>
            ))}
            <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:17, borderTop:'2px solid #111', paddingTop:8, marginTop:4 }}>
              <span>Grand Total</span><span>Rs.{Number(inv.grand_total).toLocaleString('en-IN',{minimumFractionDigits:2})}</span>
            </div>
          </div>
        </div>

        {inv.internal_notes && (
          <div style={{ padding:'12px 24px', borderTop:'1px solid #f1f5f9', fontSize:12, color:'#64748b' }}>
            <strong>Notes:</strong> {inv.internal_notes}
          </div>
        )}
      </div>
    </div>
  );
}

// -- UpdatePaymentModal -----------------------------------------------------
function UpdatePaymentModal({ invoice, onClose, onUpdated }) {
  const [mode, setMode] = useState('Cash');
  const alreadyPaid = invoice.status === 'Draft' ? 0 : Number(invoice.paid_amount || 0);
  const outstanding = Math.max(0, Number(invoice.grand_total || 0) - alreadyPaid);
  const [amount, setAmount] = useState(outstanding);
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    try {
      const r = await window.electron.invoke('invoices:updateStatus', { id: invoice.id, status: 'Paid', paid_amount: invoice.grand_total });
      if (r.success) {
        const full = await window.electron.invoke('invoices:getById', { id: invoice.id }).catch(() => null);
        if (full) {
          printInvoice(full);
        }
        toast.success('Payment recorded - Invoice marked Paid');
        await onUpdated();
        onClose();
      } else {
        toast.error(r.error || 'Failed');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:14, width:440, padding:28, boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ fontWeight:700, fontSize:17, marginBottom:4 }}>Record Payment</div>
        <div style={{ fontSize:12, color:'#64748b', marginBottom:20 }}>Invoice {invoice.invoice_no} &middot; {invoice.customer_name}</div>
        <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:10, marginBottom:12, fontSize:12, color:'#334155', lineHeight:1.6 }}>
          <div><strong>Date:</strong> {invoice.invoice_date || '-'}</div>
          <div><strong>Total:</strong> Rs.{Number(invoice.grand_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
          <div><strong>Paid:</strong> Rs.{alreadyPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        </div>
        <div style={{ background:'#fef9c3', border:'1px solid #fde68a', borderRadius:8, padding:12, marginBottom:20, fontSize:13 }}>
          Outstanding: <strong>Rs.{outstanding.toLocaleString('en-IN', {minimumFractionDigits:2})}</strong>
        </div>
        <div className="form-group">
          <label className="form-label">Payment Mode</label>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {['Cash','Card'].map(m => (
              <button key={m} type="button" onClick={() => setMode(m)}
                style={{ padding:'6px 16px', borderRadius:20, border:'1px solid', fontSize:12, cursor:'pointer', fontWeight:500,
                  background: mode===m?'#111':'#fff', color: mode===m?'#fff':'#64748b', borderColor: mode===m?'#111':'#e2e8f0' }}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Amount Received (Rs.)</label>
          <input type="number" className="form-input" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-black" onClick={confirm} disabled={saving}>{saving?'Saving...':'Confirm Payment'}</button>
        </div>
      </div>
    </div>
  );
}

// -- ReturnExchangeModal ----------------------------------------------------
function ReturnExchangeModal({ invoice, onClose, onSaved }) {
  const [type, setType] = useState('Return');
  const [items, setItems] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [exchangeItems, setExchangeItems] = useState([]);
  const [exchangeSearch, setExchangeSearch] = useState('');
  const [exchangeSuggestions, setExchangeSuggestions] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.electron.invoke('invoices:getById', { id: invoice.id }).then(inv => {
      if (inv && inv.items) {
        setItems(inv.items.map(it => ({ ...it, returned_qty: 0, max_qty: it.qty })));
      }
    });
    window.electron.invoke('products:getAll', {}).then(d => setAllProducts(Array.isArray(d) ? d : []));
  }, [invoice.id]);

  function setQty(idx, val) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, returned_qty: Math.min(Math.max(0, parseInt(val)||0), it.max_qty) } : it));
  }

  const returnItems = items.filter(it => it.returned_qty > 0);
  const returnTotal = returnItems.reduce((s, it) => s + (it.returned_qty * it.rate), 0);
  const exchangeTotal = exchangeItems.reduce((s, it) => s + it.amount, 0);
  const netDifference = exchangeTotal - returnTotal; // +ve customer pays more, -ve refund.

  const daysSince = Math.floor((Date.now() - new Date(invoice.invoice_date).getTime()) / 86400000);
  const overdue = daysSince > 15;

  function onSearchExchange(val) {
    setExchangeSearch(val);
    if (!val.trim()) { setExchangeSuggestions([]); return; }
    const q = val.toLowerCase();
    setExchangeSuggestions(
      allProducts
        .filter(p => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q))
        .slice(0, 8)
    );
  }

  function addExchangeItem(product) {
    setExchangeItems(prev => {
      const idx = prev.findIndex(i => i.product_id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        const qty = next[idx].qty + 1;
        next[idx] = { ...next[idx], qty, amount: qty * next[idx].rate };
        return next;
      }
      const rate = Number(product.selling_price || 0);
      return [...prev, {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        qty: 1,
        rate,
        amount: rate,
      }];
    });
    setExchangeSearch('');
    setExchangeSuggestions([]);
  }

  function updateExchangeItem(idx, field, value) {
    setExchangeItems(prev => {
      const next = [...prev];
      const parsed = Math.max(0, parseFloat(value) || 0);
      next[idx] = { ...next[idx], [field]: parsed };
      next[idx].amount = (next[idx].qty || 0) * (next[idx].rate || 0);
      return next;
    });
  }

  function removeExchangeItem(idx) {
    setExchangeItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (returnItems.length === 0) { toast.error('Select at least one item to return'); return; }
    if (type === 'Exchange' && exchangeItems.length === 0) { toast.error('Add at least one exchange item'); return; }
    setSaving(true);
    const r = await window.electron.invoke('returns:create', {
      original_invoice_id: invoice.id,
      invoice_no: invoice.invoice_no,
      customer_name: invoice.customer_name,
      type,
      total_items_sold: items.reduce((s, it) => s + it.qty, 0),
      items_returned: returnItems.reduce((s, it) => s + it.returned_qty, 0),
      return_amount: returnTotal,
      exchange_amount: type === 'Exchange' ? exchangeTotal : 0,
      net_amount: type === 'Exchange' ? netDifference : -returnTotal,
      status: 'Completed',
      created_by: null,
      items: returnItems.map(it => ({ product_id: it.product_id, product_name: it.product_name||it.name, returned_qty: it.returned_qty, exchange_qty: 0, rate: it.rate })),
      exchange_items: type === 'Exchange' ? exchangeItems.map(it => ({
        product_id: it.product_id,
        product_name: it.product_name || it.name,
        qty: it.qty,
        rate: it.rate,
      })) : [],
    });
    setSaving(false);
    if (r.success) {
      await printReturnExchange(invoice, {
        type,
        returnId: r.id,
        returnItems,
        exchangeItems,
        returnTotal,
        exchangeTotal,
        netDifference,
      });
      toast.success(`${type} recorded successfully`);
      onSaved();
      onClose();
    }
    else toast.error(r.error || 'Failed to record return');
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:16, width:600, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 24px 80px rgba(0,0,0,0.2)' }}>
        <div style={{ padding:'20px 24px', borderBottom:'1px solid #f1f5f9' }}>
          <div style={{ fontWeight:700, fontSize:17 }}>Return / Exchange</div>
          <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>Invoice {invoice.invoice_no} &middot; {invoice.customer_name || 'Walk-in'} &middot; {daysSince} day(s) ago</div>
        </div>

        <div style={{ padding:'20px 24px' }}>
          {overdue && (
            <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:12, marginBottom:16, fontSize:13, color:'#dc2626' }}>
              Warning: This invoice is {daysSince} days old. The standard 15-day return window has expired.
            </div>
          )}

          <div style={{ marginBottom:20 }}>
            <label className="form-label">Type</label>
            <div style={{ display:'flex', gap:10 }}>
              {['Return','Exchange'].map(t => (
                <div key={t} onClick={() => setType(t)} style={{ flex:1, padding:'12px 16px', borderRadius:10, cursor:'pointer', border: type===t?'2px solid #111':'1.5px solid #e2e8f0', background: type===t?'#f8fafc':'#fff', textAlign:'center', fontWeight: type===t?700:400, fontSize:14 }}>
                  {t === 'Return' ? 'Return' : 'Exchange'}
                  <div style={{ fontSize:11, color:'#64748b', fontWeight:400, marginTop:3 }}>
                    {t==='Return'?'Customer gets refund':'Customer swaps item'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom:16 }}>
            <label className="form-label">Select Items to {type}</label>
            <table className="data-table" style={{ fontSize:13 }}>
              <thead><tr><th>Product</th><th style={{textAlign:'center'}}>Sold Qty</th><th style={{textAlign:'center'}}>Return Qty</th><th style={{textAlign:'right'}}>Rate</th><th style={{textAlign:'right'}}>Refund</th></tr></thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={5} style={{textAlign:'center',color:'#94a3b8',padding:20}}>Loading items...</td></tr>}
                {items.map((it, i) => (
                  <tr key={i}>
                    <td>{it.product_name || it.name}</td>
                    <td style={{textAlign:'center'}}>{it.max_qty}</td>
                    <td style={{textAlign:'center'}}>
                      <input type="number" min={0} max={it.max_qty} value={it.returned_qty}
                        onChange={e => setQty(i, e.target.value)}
                        style={{ width:60, padding:'4px 8px', border:'1px solid #e2e8f0', borderRadius:6, textAlign:'center', fontSize:13 }} />
                    </td>
                    <td style={{textAlign:'right'}}>Rs.{Number(it.rate).toLocaleString()}</td>
                    <td style={{textAlign:'right', fontWeight:600, color: it.returned_qty>0?'#ef4444':'#94a3b8'}}>
                      {it.returned_qty > 0 ? `-Rs.${(it.returned_qty*it.rate).toLocaleString()}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {type === 'Exchange' && (
            <div style={{ marginBottom:16, border:'1px solid #e2e8f0', borderRadius:10, padding:12 }}>
              <label className="form-label">Add Exchange Items</label>
              <div style={{ position:'relative', marginBottom:10 }}>
                <input
                  className="form-input"
                  placeholder="Search replacement product by name or SKU..."
                  value={exchangeSearch}
                  onChange={e => onSearchExchange(e.target.value)}
                />
                {exchangeSuggestions.length > 0 && (
                  <div style={{ position:'absolute', left:0, right:0, top:'100%', background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, zIndex:50, boxShadow:'0 4px 16px rgba(0,0,0,0.1)', maxHeight:220, overflowY:'auto' }}>
                    {exchangeSuggestions.map(p => (
                      <div key={p.id} onClick={() => addExchangeItem(p)}
                        style={{ padding:'10px 14px', cursor:'pointer', display:'flex', justifyContent:'space-between', borderBottom:'1px solid #f1f5f9', fontSize:13 }}
                        onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background='#fff'}>
                        <span>{p.name} <span style={{ color:'#94a3b8', fontSize:11 }}>{p.sku}</span></span>
                        <span style={{ fontWeight:600 }}>Rs.{Number(p.selling_price || 0).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <table className="data-table" style={{ fontSize:13 }}>
                <thead>
                  <tr><th>Product</th><th>SKU</th><th style={{width:90}}>Qty</th><th style={{width:110}}>Rate</th><th style={{textAlign:'right'}}>Amount</th><th></th></tr>
                </thead>
                <tbody>
                  {exchangeItems.length === 0 && <tr><td colSpan={6} style={{textAlign:'center', color:'#94a3b8', padding:16}}>No exchange items added</td></tr>}
                  {exchangeItems.map((it, idx) => (
                    <tr key={`${it.product_id}-${idx}`}>
                      <td>{it.product_name}</td>
                      <td style={{color:'#64748b'}}>{it.sku || '-'}</td>
                      <td><input type="number" min={1} className="form-input" style={{ width:70, padding:'4px 8px' }} value={it.qty} onChange={e => updateExchangeItem(idx, 'qty', e.target.value)} /></td>
                      <td><input type="number" min={0} className="form-input" style={{ width:90, padding:'4px 8px' }} value={it.rate} onChange={e => updateExchangeItem(idx, 'rate', e.target.value)} /></td>
                      <td style={{textAlign:'right', fontWeight:600}}>Rs.{Number(it.amount || 0).toLocaleString()}</td>
                      <td><button onClick={() => removeExchangeItem(idx)} style={{ background:'none', border:'none', cursor:'pointer', color:'#ef4444', fontSize:16, fontWeight:700 }}>x</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {returnTotal > 0 && (
            <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:'12px 16px', marginBottom:16 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                <span style={{ fontWeight:600, color:'#334155' }}>Return Value</span>
                <span style={{ fontWeight:700, color:'#ef4444' }}>Rs.{returnTotal.toLocaleString('en-IN', {minimumFractionDigits:2})}</span>
              </div>
              {type === 'Exchange' && (
                <>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                    <span style={{ fontWeight:600, color:'#334155' }}>Exchange Value</span>
                    <span style={{ fontWeight:700, color:'#111827' }}>Rs.{exchangeTotal.toLocaleString('en-IN', {minimumFractionDigits:2})}</span>
                  </div>
                  <div style={{ height:1, background:'#e2e8f0', margin:'8px 0' }} />
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ fontWeight:700 }}>Net Difference</span>
                    <span style={{ fontWeight:700, fontSize:17, color: netDifference > 0 ? '#16a34a' : netDifference < 0 ? '#ef4444' : '#111827' }}>
                      {netDifference > 0 ? `+Rs.${netDifference.toLocaleString('en-IN', {minimumFractionDigits:2})} (customer pays)`
                        : netDifference < 0 ? `-Rs.${Math.abs(netDifference).toLocaleString('en-IN', {minimumFractionDigits:2})} (refund)`
                        : 'Rs.0.00'}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ padding:'16px 24px', borderTop:'1px solid #f1f5f9', display:'flex', justifyContent:'space-between' }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-black" onClick={submit} disabled={saving || returnItems.length === 0}>
            {saving ? 'Processing...' : `Confirm ${type}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// -- InvoiceStartModal ------------------------------------------------------
function InvoiceStartModal({ onClose, onNew, onResume }) {
  const [drafts, setDrafts] = useState([]);
  useEffect(() => {
    window.electron.invoke('invoices:getAll', { status: 'Draft' }).then(d => setDrafts(Array.isArray(d) ? d : []));
  }, []);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:500 }}>
      <div style={{ background:'#fff', borderRadius:12, padding:32, width:520, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ fontWeight:700, fontSize:20, marginBottom:4 }}>Create Invoice</div>
        <div style={{ fontSize:13, color:'#6b7280', marginBottom:24 }}>Start a new invoice or continue a saved draft</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:24 }}>
          <div onClick={onNew} style={{ border:'2px solid #111', borderRadius:10, padding:20, cursor:'pointer', textAlign:'center' }}
               onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
               onMouseLeave={e => e.currentTarget.style.background='#fff'}>
            <div style={{ fontSize:28, marginBottom:8 }}>+</div>
            <div style={{ fontWeight:700, fontSize:15 }}>Create New</div>
            <div style={{ fontSize:12, color:'#6b7280' }}>Start a fresh invoice</div>
          </div>
          <div style={{ border:'2px solid #f97316', borderRadius:10, padding:20, textAlign:'center', opacity: drafts.length ? 1 : 0.4, cursor: drafts.length ? 'pointer' : 'default' }}>
            <div style={{ fontSize:28, marginBottom:8 }}>~</div>
            <div style={{ fontWeight:700, fontSize:15 }}>Continue Draft</div>
            <div style={{ fontSize:12, color:'#6b7280' }}>{drafts.length} draft(s) saved</div>
          </div>
        </div>
        {drafts.length > 0 && (
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8, color:'#374151' }}>Saved Drafts:</div>
            {drafts.map(d => (
              <div key={d.id} onClick={() => onResume(d)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', border:'1px solid #e5e7eb', borderRadius:8, marginBottom:6, cursor:'pointer' }}
                   onMouseEnter={e => e.currentTarget.style.background='#f9fafb'}
                   onMouseLeave={e => e.currentTarget.style.background='#fff'}>
                <div>
                  <div style={{ fontWeight:600, fontSize:13 }}>{d.invoice_no || 'Unsaved Draft'}</div>
                  <div style={{ fontSize:12, color:'#6b7280' }}>{d.customer_name || 'No customer'} &middot; {d.invoice_date}</div>
                </div>
                <div style={{ fontWeight:700, color:'#111' }}>Rs.{d.grand_total?.toLocaleString('en-IN')}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display:'flex', justifyContent:'flex-end' }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// -- CreateInvoiceForm ------------------------------------------------------
function CreateInvoiceForm({ onClose, onSaved, initialDraft }) {
  const { currentUser } = useAuth();
  const [products, setProducts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showScanner, setShowScanner] = useState(false);
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [isCreditSale, setIsCreditSale] = useState(false);
  const [taxPct, setTaxPct] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftId, setDraftId] = useState(null);
  const [autoSaveState, setAutoSaveState] = useState({ status: 'idle', lastSavedAt: null });
  const [recoverSnapshot, setRecoverSnapshot] = useState(null);

  const autosaveKey = `invoice_autosave_${currentUser?.id || 'guest'}`;

  function normalizeDraftItems(rawItems) {
    if (!Array.isArray(rawItems)) return [];
    return rawItems.map((it) => {
      const qty = Number(it.qty || 0);
      const rate = Number(it.rate || 0);
      const discountPct = Number(it.discount_pct || 0);
      const base = qty * rate;
      const amount = Number(it.amount ?? (base - ((base * discountPct) / 100)));
      return {
        ...it,
        product_id: it.product_id ?? null,
        name: it.name || it.product_name || '',
        sku: it.sku || it.product_code || '',
        qty,
        rate,
        discount_pct: discountPct,
        amount,
      };
    });
  }

  function applySnapshot(snapshot) {
    if (!snapshot) return;
    setInvoiceDate(snapshot.invoiceDate || new Date().toISOString().slice(0, 10));
    setBranchId(snapshot.branchId || '');
    setSellerId(snapshot.sellerId || '');
    setCustomerName(snapshot.customerName || '');
    setCustomerPhone(snapshot.customerPhone || '');
    setCustomerAddress(snapshot.customerAddress || '');
    setItems(normalizeDraftItems(snapshot.items));
    setPaymentMode(snapshot.paymentMode || 'Cash');
    setIsCreditSale(!!snapshot.isCreditSale);
    setTaxPct(snapshot.taxPct || 0);
    setDiscount(snapshot.discount || 0);
    setNotes(snapshot.notes || '');
  }

  function clearAutosave() {
    try { localStorage.removeItem(autosaveKey); } catch (e) {}
  }

  useEffect(() => {
    window.electron.invoke('products:getAll', {}).then(d => setProducts(Array.isArray(d) ? d : []));
    window.electron.invoke('branches:getAll', {}).then(d => setBranches(Array.isArray(d) ? d : []));
    window.electron.invoke('users:getAll', {}).then(d => setSellers(Array.isArray(d) ? d : []));
    window.electron.invoke('customers:getAll', {}).then(d => setCustomers(Array.isArray(d) ? d : []));
    if (initialDraft && initialDraft.id) {
      setDraftId(initialDraft.id);
      setInvoiceDate(initialDraft.invoice_date || new Date().toISOString().slice(0, 10));
      setBranchId(initialDraft.branch_id ? String(initialDraft.branch_id) : '');
      setSellerId(initialDraft.seller_id ? String(initialDraft.seller_id) : '');
      setCustomerName(initialDraft.customer_name || '');
      setCustomerPhone(initialDraft.customer_phone || '');
      setCustomerAddress(initialDraft.customer_address || '');
      setPaymentMode(initialDraft.payment_mode || 'Cash');
      setIsCreditSale(!!initialDraft.is_credit_sale);
      setTaxPct(initialDraft.tax_pct || 0);
      setDiscount(initialDraft.discount || 0);
      setNotes(initialDraft.notes || initialDraft.internal_notes || '');
      setItems(normalizeDraftItems(initialDraft.items));
    } else {
      setInvoiceDate(new Date().toISOString().slice(0, 10));
      if (currentUser?.branch_id) setBranchId(String(currentUser.branch_id));
      if (currentUser?.id) setSellerId(String(currentUser.id));

      try {
        const raw = localStorage.getItem(autosaveKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.items?.length || parsed?.customerName || parsed?.notes) {
            setRecoverSnapshot(parsed);
          }
        }
      } catch (e) {}
    }
  }, [initialDraft, currentUser, autosaveKey]);

  useEffect(() => {
    if (initialDraft && initialDraft.id) return;
    if (recoverSnapshot) return;

    const hasContent =
      items.length > 0 ||
      !!customerName ||
      !!customerPhone ||
      !!customerAddress ||
      !!notes ||
      Number(taxPct) > 0 ||
      Number(discount) > 0;
    if (!hasContent) return;

    setAutoSaveState(prev => ({ ...prev, status: 'saving' }));
    const timer = setTimeout(() => {
      try {
        const snapshot = {
          invoiceDate,
          branchId,
          sellerId,
          customerName,
          customerPhone,
          customerAddress,
          items,
          paymentMode,
          isCreditSale,
          taxPct,
          discount,
          notes,
          savedAt: new Date().toISOString(),
        };
        localStorage.setItem(autosaveKey, JSON.stringify(snapshot));
        setAutoSaveState({ status: 'saved', lastSavedAt: snapshot.savedAt });
      } catch (e) {
        setAutoSaveState(prev => ({ ...prev, status: 'error' }));
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [
    initialDraft,
    recoverSnapshot,
    autosaveKey,
    invoiceDate,
    branchId,
    sellerId,
    customerName,
    customerPhone,
    customerAddress,
    items,
    paymentMode,
    isCreditSale,
    taxPct,
    discount,
    notes,
  ]);

  const handleGunScan = useCallback(async (barcode) => {
    const p = await window.electron.invoke('products:findByBarcode', { barcode });
    if (p) { addItem(p); toast.success(`Added: ${p.name}`); }
    else toast.error('Barcode not found: ' + barcode);
  }, []);

  useBarcodeGun(handleGunScan, !showScanner);

  async function handleScanDetected(barcode) {
    setShowScanner(false);
    const p = await window.electron.invoke('products:findByBarcode', { barcode });
    if (p) { addItem(p); toast.success(`Added: ${p.name}`); }
    else toast.error('Product not found: ' + barcode);
  }

  function onSearch(val) {
    setSearch(val);
    if (!val.trim()) { setSuggestions([]); return; }
    const q = val.toLowerCase();
    setSuggestions(products.filter(p => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)).slice(0, 8));
  }

  function addItem(product) {
    setItems(prev => {
      const idx = prev.findIndex(i => i.product_id === product.id);
      if (idx >= 0) {
        const u = [...prev];
        const nextQty = u[idx].qty + 1;
        const lineBase = nextQty * u[idx].rate;
        const lineDiscount = (lineBase * (u[idx].discount_pct || 0)) / 100;
        u[idx] = { ...u[idx], qty: nextQty, amount: lineBase - lineDiscount };
        return u;
      }
      return [...prev, { product_id: product.id, name: product.name, sku: product.sku, qty: 1, rate: product.selling_price || 0, discount_pct: 0, amount: product.selling_price || 0 }];
    });
    setSearch(''); setSuggestions([]);
  }

  function updateItem(idx, field, val) {
    setItems(prev => {
      const u = [...prev];
      const parsed = parseFloat(val) || 0;
      const safeDiscount = field === 'discount_pct' ? Math.max(0, Math.min(100, parsed)) : (u[idx].discount_pct || 0);
      u[idx] = { ...u[idx], [field]: parsed, discount_pct: safeDiscount };
      const lineBase = u[idx].qty * u[idx].rate;
      const lineDiscount = (lineBase * (u[idx].discount_pct || 0)) / 100;
      u[idx].amount = lineBase - lineDiscount;
      return u;
    });
  }

  function getLineDiscountAmount(item) {
    const base = (item.qty || 0) * (item.rate || 0);
    return (base * (item.discount_pct || 0)) / 100;
  }

  function removeItem(idx) { setItems(prev => prev.filter((_, i) => i !== idx)); }

  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const taxAmt = subtotal * (taxPct / 100);
  const grandTotal = subtotal + taxAmt - (parseFloat(discount) || 0);

  function resetForNewInvoice() {
    clearAutosave();
    setDraftId(null);
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setBranchId(currentUser?.branch_id ? String(currentUser.branch_id) : '');
    setSellerId(currentUser?.id ? String(currentUser.id) : '');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setItems([]);
    setSearch('');
    setSuggestions([]);
    setPaymentMode('Cash');
    setIsCreditSale(false);
    setTaxPct(0);
    setDiscount(0);
    setNotes('');
  }

  async function save(status, { autoPrint = false, resetToNew = false } = {}) {
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    setSaving(true);
    try {
      const payload = {
        invoice_date: invoiceDate, branch_id: branchId ? parseInt(branchId, 10) : null, seller_id: sellerId ? parseInt(sellerId, 10) : null,
        customer_name: customerName, customer_phone: customerPhone, customer_address: customerAddress, items,
        payment_mode: paymentMode,
        is_credit_sale: isCreditSale ? 1 : 0, tax_pct: taxPct, discount: parseFloat(discount) || 0,
        subtotal, tax_amount: taxAmt, grand_total: grandTotal, notes, status,
      };
      const result = await window.electron.invoke(draftId ? 'invoices:update' : 'invoices:create', draftId ? { id: draftId, data: payload } : payload);
      if (result.success) {
        if (status === 'Draft') {
          toast.success('Saved as draft');
          clearAutosave();
          onSaved();
          onClose();
          return;
        }

        if (autoPrint) {
          const invoiceId = draftId || result.id;
          if (invoiceId) {
            const fullInvoice = await window.electron.invoke('invoices:getById', { id: invoiceId });
            if (fullInvoice) printInvoice(fullInvoice);
          }
        }

        toast.success('Invoice created!');
        onSaved();
        if (resetToNew) {
          resetForNewInvoice();
        } else {
          onClose();
        }
      } else { toast.error(result.error || 'Failed to save invoice'); }
    } finally { setSaving(false); }
  }

  function finalizeAndSave() {
    save(isCreditSale ? 'Credit' : 'Paid', { autoPrint: true, resetToNew: true });
  }

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (!saving) finalizeAndSave();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saving, isCreditSale, items, invoiceDate, branchId, sellerId, customerName, customerPhone, customerAddress, paymentMode, taxPct, discount, notes, draftId]);

  return (
    <div style={{ position:'fixed', inset:0, background:'#fff', zIndex:200, overflowY:'auto', display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'16px 24px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', gap:16, background:'#fff', position:'sticky', top:0, zIndex:10 }}>
        <button className="btn btn-outline" onClick={onClose}>&larr; Back</button>
        <div>
          <div style={{ fontWeight:700, fontSize:18 }}>Create Invoice</div>
          <div style={{ fontSize:12, color:'#64748b' }}>Fill in the details to generate a sales invoice</div>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', fontSize:12, color:'#6b7280', marginRight:8 }}>
            {autoSaveState.status === 'saving' && 'Saving...'}
            {autoSaveState.status === 'saved' && `Saved ${autoSaveState.lastSavedAt ? new Date(autoSaveState.lastSavedAt).toLocaleTimeString() : ''}`}
            {autoSaveState.status === 'error' && 'Auto-save failed'}
          </div>
          <button className="btn btn-outline" onClick={() => save('Draft')} disabled={saving}>Save Draft</button>
          <button className="btn btn-black" onClick={finalizeAndSave} disabled={saving}>
            {isCreditSale ? 'Save Credit Sale' : 'Finalize & Save'}
          </button>
        </div>
      </div>

      <div style={{ display:'flex', flex:1, gap:0 }}>
        <div style={{ flex:1, padding:24, overflowY:'auto', borderRight:'1px solid #f1f5f9' }}>
          {recoverSnapshot && (
            <div style={{ marginBottom:16, background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:10, padding:'12px 14px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
              <div style={{ fontSize:13, color:'#1e3a8a' }}>
                Unsaved invoice draft found from {recoverSnapshot.savedAt ? new Date(recoverSnapshot.savedAt).toLocaleString() : 'previous session'}.
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn btn-outline btn-sm" onClick={() => { clearAutosave(); setRecoverSnapshot(null); }}>Discard</button>
                <button className="btn btn-black btn-sm" onClick={() => { applySnapshot(recoverSnapshot); setRecoverSnapshot(null); }}>Resume</button>
              </div>
            </div>
          )}

          <div style={{ marginBottom:24 }}>
            <div style={{ fontWeight:600, marginBottom:12, fontSize:14 }}>Customer Details</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
              <div><label className="form-label">Customer Name</label>
                <input className="form-input" placeholder="Walk-in Customer" value={customerName} onChange={e => setCustomerName(e.target.value)} list="customer-list" />
                <datalist id="customer-list">{customers.map(c => <option key={c.id} value={c.name} />)}</datalist>
              </div>
              <div><label className="form-label">Phone Number</label><input className="form-input" placeholder="Phone" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} /></div>
              <div><label className="form-label">Address</label><input className="form-input" placeholder="Customer address (optional)" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} /></div>
            </div>
          </div>

          <div style={{ marginBottom:24 }}>
            <div style={{ fontWeight:600, marginBottom:12, fontSize:14 }}>Invoice Details</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
              <div><label className="form-label">Invoice Date *</label><input type="date" className="form-input" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></div>
              <div><label className="form-label">Branch</label>
                <select className="form-select" value={branchId} onChange={e => setBranchId(e.target.value)} disabled={!!currentUser?.branch_id}>
                  <option value="">Select Branch</option>
                  {branches.map(b => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
                </select>
              </div>
              <div><label className="form-label">Seller</label>
                <select className="form-select" value={sellerId} onChange={e => setSellerId(e.target.value)} disabled={!!currentUser?.id}>
                  <option value="">Select Seller</option>
                  {sellers.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div style={{ marginBottom:16 }}>
            <div style={{ fontWeight:600, marginBottom:8, fontSize:14 }}>Add Products</div>
            <div style={{ display:'flex', gap:8 }}>
              <div style={{ position:'relative', flex:1 }}>
                <input className="form-input" placeholder="Search product by name, SKU or barcode..." value={search} onChange={e => onSearch(e.target.value)} />
                {suggestions.length > 0 && (
                  <div style={{ position:'absolute', left:0, right:0, top:'100%', background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, zIndex:50, boxShadow:'0 4px 16px rgba(0,0,0,0.1)', maxHeight:260, overflowY:'auto' }}>
                    {suggestions.map(p => (
                      <div key={p.id} onClick={() => addItem(p)} style={{ padding:'10px 14px', cursor:'pointer', display:'flex', justifyContent:'space-between', borderBottom:'1px solid #f1f5f9', fontSize:13 }}
                        onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background='#fff'}>
                        <span>{p.name} <span style={{ color:'#94a3b8', fontSize:11 }}>{p.sku}</span></span>
                        <span style={{ fontWeight:600 }}>Rs.{p.selling_price?.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => setShowScanner(true)} title="Scan barcode"
                style={{ padding:'0 14px', background:'#1e293b', border:'none', borderRadius:8, cursor:'pointer', color:'#fff', fontSize:13, fontWeight:600, display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                [Scan]
              </button>
            </div>
            <div style={{ marginTop:5, fontSize:11, color:'#94a3b8' }}>Tip: USB barcode gun works anytime - just scan and product is added instantly</div>
          </div>

          {showScanner && <BarcodeScanner title="Scan Product Barcode" onDetected={handleScanDetected} onClose={() => setShowScanner(false)} />}

          <div style={{ marginBottom:24 }}>
            <table className="data-table" style={{ fontSize:13 }}>
              <thead><tr><th>#</th><th>Product</th><th>SKU</th><th style={{width:80}}>Qty</th><th style={{width:100}}>Rate (Rs.)</th><th style={{width:100}}>Discount %</th><th style={{width:130}}>Discount (Rs.)</th><th style={{width:120}}>Amount (Rs.)</th><th></th></tr></thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={9} style={{ textAlign:'center', color:'#94a3b8', padding:24 }}>No items added yet</td></tr>}
                {items.map((item, i) => (
                  <tr key={i}>
                    <td>{i+1}</td><td>{item.name}</td><td style={{ color:'#64748b' }}>{item.sku}</td>
                    <td><input type="number" min={1} className="form-input" style={{ width:70, padding:'4px 8px' }} value={item.qty} onChange={e => updateItem(i,'qty',e.target.value)} /></td>
                    <td><input type="number" min={0} className="form-input" style={{ width:90, padding:'4px 8px' }} value={item.rate} onChange={e => updateItem(i,'rate',e.target.value)} /></td>
                    <td><input type="number" min={0} max={100} className="form-input" style={{ width:90, padding:'4px 8px' }} value={item.discount_pct || 0} onChange={e => updateItem(i,'discount_pct',e.target.value)} /></td>
                    <td style={{ color:'#ef4444', fontWeight:600 }}>-Rs.{getLineDiscountAmount(item).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                    <td style={{ fontWeight:600 }}>Rs.{item.amount.toLocaleString()}</td>
                    <td><button onClick={() => removeItem(i)} style={{ background:'none', border:'none', cursor:'pointer', color:'#ef4444', fontSize:16, fontWeight:700 }}>x</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div><label className="form-label">Notes</label>
            <textarea className="form-input" rows={3} placeholder="Internal notes or instructions..." value={notes} onChange={e => setNotes(e.target.value)} style={{ resize:'vertical' }} />
          </div>
        </div>

        <div style={{ width:320, padding:24, display:'flex', flexDirection:'column', gap:20 }}>
          <div>
            <div style={{ fontWeight:600, marginBottom:10, fontSize:14 }}>Payment Mode</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {['Cash','Card'].map(m => (
                <button key={m} type="button" onClick={() => setPaymentMode(m)}
                  style={{ padding:'6px 14px', borderRadius:20, border:'1px solid', fontSize:12, cursor:'pointer', fontWeight:500,
                    background: paymentMode===m?'#1e293b':'#fff', color: paymentMode===m?'#fff':'#64748b', borderColor: paymentMode===m?'#1e293b':'#e2e8f0' }}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', background:'#f8fafc', borderRadius:8, border:'1px solid #e2e8f0' }}>
            <div><div style={{ fontWeight:600, fontSize:13 }}>Credit Sale</div><div style={{ fontSize:11, color:'#64748b' }}>Customer pays later</div></div>
            <div onClick={() => setIsCreditSale(v => !v)} style={{ width:44, height:24, borderRadius:12, background:isCreditSale?'#22c55e':'#cbd5e1', cursor:'pointer', position:'relative', transition:'background 0.2s' }}>
              <div style={{ position:'absolute', top:2, left:isCreditSale?22:2, width:20, height:20, borderRadius:'50%', background:'#fff', transition:'left 0.2s' }} />
            </div>
          </div>

          <div>
            <div style={{ fontWeight:600, marginBottom:10, fontSize:14 }}>Adjustments</div>
            <div style={{ display:'flex', gap:10 }}>
              <div style={{ flex:1 }}><label className="form-label" style={{ fontSize:11 }}>Tax (%)</label><input type="number" min={0} max={100} className="form-input" value={taxPct} onChange={e => setTaxPct(parseFloat(e.target.value)||0)} /></div>
              <div style={{ flex:1 }}><label className="form-label" style={{ fontSize:11 }}>Discount (Rs.)</label><input type="number" min={0} className="form-input" value={discount} onChange={e => setDiscount(e.target.value)} /></div>
            </div>
          </div>

          <div style={{ background:'#f8fafc', borderRadius:10, padding:16, border:'1px solid #e2e8f0' }}>
            <div style={{ fontWeight:600, marginBottom:12, fontSize:14 }}>Summary</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8, fontSize:13 }}>
              <div style={{ display:'flex', justifyContent:'space-between' }}><span style={{ color:'#64748b' }}>Subtotal</span><span>Rs.{subtotal.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
              <div style={{ display:'flex', justifyContent:'space-between' }}><span style={{ color:'#64748b' }}>Tax ({taxPct}%)</span><span>Rs.{taxAmt.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
              <div style={{ display:'flex', justifyContent:'space-between' }}><span style={{ color:'#64748b' }}>Discount</span><span style={{ color:'#ef4444' }}>-Rs.{(parseFloat(discount)||0).toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
              <div style={{ height:1, background:'#e2e8f0', margin:'4px 0' }} />
              <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:16 }}><span>Grand Total</span><span>Rs.{grandTotal.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
              {isCreditSale && <div style={{ marginTop:4, padding:'6px 10px', background:'#fef3c7', borderRadius:6, fontSize:11, color:'#92400e', textAlign:'center' }}>Credit Sale - payment due later</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// -- ReturnExchangeTab ------------------------------------------------------
function ReturnExchangeTab({ onCreateReturn, onPickInvoice, onReprint, refreshNonce = 0 }) {
  const [returns, setReturns] = useState([]);
  const [eligibleInvoices, setEligibleInvoices] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => { loadReturns(); }, [search, refreshNonce]);
  useEffect(() => { loadEligibleInvoices(); }, [refreshNonce]);

  async function loadReturns() {
    try {
      const data = await window.electron.invoke('returns:getAll', {});
      setReturns(Array.isArray(data) ? data : []);
    } catch { setReturns([]); }
  }

  async function loadEligibleInvoices() {
    try {
      const data = await window.electron.invoke('returns:getEligibleInvoices', {});
      setEligibleInvoices(Array.isArray(data) ? data : []);
    } catch {
      setEligibleInvoices([]);
    }
  }

  const filtered = returns.filter(r =>
    !search || (r.invoice_no||'').toLowerCase().includes(search.toLowerCase()) || (r.customer_name||'').toLowerCase().includes(search.toLowerCase())
  );
  const eligibleFiltered = eligibleInvoices.filter((inv) =>
    !search || (inv.invoice_no || '').toLowerCase().includes(search.toLowerCase()) || (inv.customer_name || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="filters-bar">
        <div style={{ position:'relative' }}>
          <input className="form-input" style={{ paddingLeft:12, width:280 }} placeholder="Search by invoice or customer" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-black filters-bar-right" onClick={onCreateReturn}>+ Create Return / Exchange</button>
      </div>
      <div className="table-container">
        <div style={{ padding:'10px 14px', fontWeight:600, fontSize:13, color:'#334155' }}>Eligible Paid Invoices (within 15 days)</div>
        <table className="data-table" style={{ marginBottom:14 }}>
          <thead>
            <tr><th>S.No</th><th>Invoice No.</th><th>Customer</th><th>Date</th><th>Total</th><th>Action</th></tr>
          </thead>
          <tbody>
            {eligibleFiltered.length === 0 && <tr><td colSpan={6} style={{ textAlign:'center', color:'#94a3b8', padding:20 }}>No eligible paid invoices found</td></tr>}
            {eligibleFiltered.map((inv, i) => (
              <tr key={`eligible-${inv.id}`}>
                <td>{i + 1}</td>
                <td style={{ fontWeight:600 }}>{inv.invoice_no}</td>
                <td>{inv.customer_name || 'Walk-in'}</td>
                <td>{inv.invoice_date}</td>
                <td style={{ fontWeight:600 }}>Rs.{Number(inv.grand_total || 0).toLocaleString()}</td>
                <td><button className="btn btn-outline btn-sm" onClick={() => onPickInvoice(inv)}>Create Return</button></td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ padding:'6px 14px', fontWeight:600, fontSize:13, color:'#334155' }}>Return / Exchange Records</div>
        <table className="data-table">
          <thead>
            <tr><th>S.No</th><th>Original Invoice</th><th>Customer</th><th>Type</th><th>Items Returned</th><th>Refund Amount</th><th>Date</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign:'center', color:'#94a3b8', padding:32 }}>No returns or exchanges found</td></tr>}
            {filtered.map((r, i) => (
              <tr key={r.id}>
                <td>{i+1}</td>
                <td style={{ fontWeight:600 }}>{r.invoice_no || '-'}</td>
                <td>{r.customer_name || '-'}</td>
                <td><span className={`badge ${r.type === 'Return' ? 'badge-orange' : 'badge-blue'}`}>{r.type}</span></td>
                <td style={{ textAlign:'center' }}>{r.items_returned || 0}</td>
                <td style={{ fontWeight:600, color:'#ef4444' }}>Rs.{Number(r.return_amount||0).toLocaleString()}</td>
                <td>{(r.date||r.created_at||'').split('T')[0]}</td>
                <td><span className={`badge ${r.status === 'Completed' ? 'badge-green' : r.status === 'Partial' ? 'badge-orange' : 'badge-grey'}`}>{r.status}</span></td>
                <td>
                  <button className="btn btn-outline btn-sm" onClick={() => onReprint?.(r)}>Reprint</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -- ReturnPickerModal - pick a paid invoice to return ----------------------
function ReturnPickerModal({ onClose, onPick }) {
  const [invoices, setInvoices] = useState([]);
  const [search, setSearch] = useState('');

  function isWithinReturnWindow(invoiceDate) {
    if (!invoiceDate) return false;
    const daysSince = Math.floor((Date.now() - new Date(invoiceDate).getTime()) / 86400000);
    return daysSince <= 15;
  }

  useEffect(() => {
    window.electron.invoke('invoices:getAll', { status: 'Paid' })
      .then(d => setInvoices(Array.isArray(d) ? d : []));
  }, []);

  const filtered = invoices.filter((inv) => {
    if (!isWithinReturnWindow(inv.invoice_date)) return false;
    if (inv.status !== 'Paid') return false;
    return !search || (inv.invoice_no || '').toLowerCase().includes(search.toLowerCase()) || (inv.customer_name || '').toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:16, width:560, maxHeight:'80vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 80px rgba(0,0,0,0.2)' }}>
        <div style={{ padding:'20px 24px', borderBottom:'1px solid #f1f5f9' }}>
          <div style={{ fontWeight:700, fontSize:17 }}>Select Invoice to Return</div>
          <div style={{ fontSize:12, color:'#64748b', marginTop:4 }}>Choose a paid invoice from the last 15 days</div>
        </div>
        <div style={{ padding:'12px 24px', borderBottom:'1px solid #f1f5f9' }}>
          <input className="form-input" placeholder="Search invoice or customer..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ overflowY:'auto', flex:1 }}>
          {filtered.length === 0 && <div style={{ textAlign:'center', color:'#94a3b8', padding:32 }}>No eligible paid invoices found (within 15 days)</div>}
          {filtered.map(inv => (
            <div key={inv.id} onClick={() => onPick(inv)}
              style={{ padding:'12px 24px', borderBottom:'1px solid #f8fafc', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}
              onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
              onMouseLeave={e => e.currentTarget.style.background='#fff'}>
              <div>
                <div style={{ fontWeight:600 }}>{inv.invoice_no}</div>
                <div style={{ fontSize:12, color:'#64748b' }}>{inv.customer_name||'Walk-in'} &middot; {inv.invoice_date}</div>
              </div>
              <div style={{ fontWeight:700 }}>Rs.{Number(inv.grand_total||0).toLocaleString()}</div>
            </div>
          ))}
        </div>
        <div style={{ padding:'14px 24px', borderTop:'1px solid #f1f5f9' }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// -- BillingInvoice (main) --------------------------------------------------
export default function BillingInvoice() {
  const [activeTab, setActiveTab] = useState('Invoices');
  const [invoices, setInvoices] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showCreate, setShowCreate] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [viewInvoice, setViewInvoice] = useState(null);
  const [returnInvoice, setReturnInvoice] = useState(null);
  const [payInvoice, setPayInvoice] = useState(null);
  const [showReturnPicker, setShowReturnPicker] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { can } = useAuth();

  function isOlderThan15Days(invoiceDate) {
    if (!invoiceDate) return false;
    return (Date.now() - new Date(invoiceDate).getTime()) > (15 * 86400000);
  }

  useEffect(() => { loadInvoices(); }, [search, statusFilter, activeTab]);

  async function loadInvoices() {
    try {
      await window.electron.invoke('invoices:autoComplete', {}).catch(() => {});
      const statusParam = activeTab === 'Completed' ? null : (statusFilter === 'All' ? null : statusFilter);
      const data = await window.electron.invoke('invoices:getAll', { status: statusParam, search });
      setInvoices(Array.isArray(data) ? data : []);
    } catch { setInvoices([]); }
  }

  async function deleteInvoice(id) {
    if (!window.confirm('Delete this invoice? This cannot be undone.')) return;
    const r = await window.electron.invoke('invoices:delete', { id });
    if (r.success) { toast.success('Invoice deleted'); loadInvoices(); }
    else toast.error(r.error || 'Failed');
  }

  function handleCreateClick() { setShowStartModal(true); }
  function handleNewInvoice() { setShowStartModal(false); setShowCreate(true); }
  async function handleResumeDraft(draft) {
    setShowStartModal(false);
    if (!draft?.id) {
      setShowCreate(draft || true);
      return;
    }
    try {
      const fullDraft = await window.electron.invoke('invoices:getById', { id: draft.id });
      setShowCreate(fullDraft || draft);
    } catch {
      setShowCreate(draft);
    }
  }

  function openReturnPicker() { setShowReturnPicker(true); }
  async function handleReprintReturnExchange(record) {
    if (!record?.id) return;
    const fullReturn = await window.electron.invoke('returns:getById', { id: record.id }).catch(() => null);
    if (!fullReturn) { toast.error('Unable to load return details'); return; }
    const originalInvoice = await window.electron.invoke('invoices:getById', { id: fullReturn.original_invoice_id }).catch(() => null);
    if (!originalInvoice) { toast.error('Original invoice not found'); return; }

    const returnItems = (fullReturn.items || []).filter(it => Number(it.returned_qty || 0) > 0)
      .map(it => ({
        product_name: it.product_name,
        returned_qty: Number(it.returned_qty || 0),
        rate: Number(it.rate || 0),
      }));
    const exchangeItems = (fullReturn.items || []).filter(it => Number(it.exchange_qty || 0) > 0)
      .map(it => ({
        product_name: it.product_name,
        qty: Number(it.exchange_qty || 0),
        rate: Number(it.rate || 0),
      }));

    await printReturnExchange(originalInvoice, {
      type: fullReturn.type || 'Return',
      returnId: fullReturn.id,
      returnItems,
      exchangeItems,
      returnTotal: Number(fullReturn.return_amount || 0),
      exchangeTotal: Number(fullReturn.exchange_amount || 0),
      netDifference: Number(fullReturn.net_amount || 0),
    });
  }
  async function handlePaymentUpdated() {
    setStatusFilter('All');
    setSearch('');
    setActiveTab('Invoices');
    await loadInvoices();
    setRefreshNonce((n) => n + 1);
  }

  const displayList = activeTab === 'Completed'
    ? invoices.filter((inv) => inv.status === 'Completed' || (isOlderThan15Days(inv.invoice_date) && ['Paid', 'Credit', 'Active'].includes(inv.status)))
    : activeTab === 'Invoices'
    ? invoices.filter((inv) => inv.status !== 'Completed' && !(isOlderThan15Days(inv.invoice_date) && ['Paid', 'Credit', 'Active'].includes(inv.status)))
    : invoices;

  if (showCreate && showCreate !== true) {
    return <CreateInvoiceForm initialDraft={showCreate} onClose={() => setShowCreate(false)} onSaved={loadInvoices} />;
  }
  if (showCreate === true) {
    return <CreateInvoiceForm onClose={() => setShowCreate(false)} onSaved={loadInvoices} />;
  }

  return (
    <div>
      {showStartModal && <InvoiceStartModal onClose={() => setShowStartModal(false)} onNew={handleNewInvoice} onResume={handleResumeDraft} />}

      {viewInvoice && (
        <ViewInvoiceModal
          invoiceId={viewInvoice}
          onClose={() => setViewInvoice(null)}
          onReturn={inv => { setViewInvoice(null); setReturnInvoice(inv); }}
          onMarkPaid={inv => { setViewInvoice(null); setPayInvoice(inv); }}
        />
      )}

      {payInvoice && (
        <UpdatePaymentModal
          invoice={payInvoice}
          onClose={() => setPayInvoice(null)}
          onUpdated={handlePaymentUpdated}
        />
      )}

      {returnInvoice && (
        <ReturnExchangeModal
          invoice={returnInvoice}
          onClose={() => setReturnInvoice(null)}
          onSaved={loadInvoices}
        />
      )}

      {showReturnPicker && (
        <ReturnPickerModal
          onClose={() => setShowReturnPicker(false)}
          onPick={inv => { setShowReturnPicker(false); setReturnInvoice(inv); }}
        />
      )}

      <div className="page-header">
        <div className="page-title">Billing &amp; Invoice</div>
        <div className="page-subtitle">Manage Bills And Create Sales Invoices</div>
      </div>

      <div className="tab-pills">
        {['Invoices','Return & Exchange','Completed'].map(tab => (
          <div key={tab} className={`tab-pill ${activeTab===tab?'active':''}`} onClick={() => setActiveTab(tab)}>{tab}</div>
        ))}
      </div>

      {activeTab === 'Return & Exchange' && (
        <ReturnExchangeTab
          refreshNonce={refreshNonce}
          onCreateReturn={openReturnPicker}
          onPickInvoice={(inv) => setReturnInvoice(inv)}
          onReprint={handleReprintReturnExchange}
        />
      )}

      {(activeTab === 'Invoices' || activeTab === 'Completed') && (
        <>
          <div className="filters-bar">
            <div style={{ position:'relative' }}>
              <input className="form-input" style={{ paddingLeft:12, width:280 }} placeholder="Search invoice, customer or amount" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="form-select" style={{ width:130 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option>All</option><option>Paid</option><option>Draft</option><option>Credit</option><option>Completed</option>
            </select>
            {activeTab === 'Invoices' && can('billing','create') && (
              <button className="btn btn-black filters-bar-right" onClick={handleCreateClick}>+ Create Invoice</button>
            )}
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>S.No</th><th>Invoice No.</th><th>Customer</th><th>Phone</th>
                  <th>Items</th><th>Total</th><th>Payment</th><th>Date</th><th>Status</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {displayList.length === 0 && <tr><td colSpan={10} style={{ textAlign:'center', color:'#94a3b8', padding:32 }}>No invoices found</td></tr>}
                {displayList.map((inv, i) => (
                  <tr
                    key={inv.id}
                    onClick={() => setViewInvoice(inv.id)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                  >
                    <td>{i+1}</td>
                    <td style={{ fontWeight:600, color:'#2563eb' }}>{inv.invoice_no}</td>
                    <td>{inv.customer_name || 'Walk-in'}</td>
                    <td>{inv.customer_phone || '-'}</td>
                    <td style={{ textAlign:'center' }}>{inv.item_count || '-'}</td>
                    <td style={{ fontWeight:600 }}>Rs.{Number(inv.grand_total||0).toLocaleString()}</td>
                    <td>{inv.payment_mode}</td>
                    <td>{inv.invoice_date}</td>
                    <td>
                      <span className={`badge ${inv.status==='Paid'?'badge-green':inv.status==='Draft'?'badge-grey':inv.status==='Credit'?'badge-blue':'badge-grey'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <KebabMenu items={[
                        { label:'View Details', icon:'[+]', action:() => setViewInvoice(inv.id) },
                        ...(inv.status !== 'Draft' ? [{
                          label:'Print', icon:'[P]', action:async () => {
                            const full = await window.electron.invoke('invoices:getById', { id: inv.id });
                            printInvoice(full);
                          }
                        }] : []),
                        ...((inv.status === 'Credit' || inv.status === 'Draft') ? [{ label:'Mark as Paid', icon:'[$]', action:() => setPayInvoice(inv) }] : []),
                        ...((inv.status === 'Paid' && !isOlderThan15Days(inv.invoice_date)) ? [{ label:'Return / Exchange', icon:'[R]', action:() => setReturnInvoice(inv) }] : []),
                        { label:'Delete', icon:'[X]', action:() => deleteInvoice(inv.id), danger:true },
                      ]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
