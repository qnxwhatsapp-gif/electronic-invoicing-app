import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV = [
  { label: 'Dashboard',            path: '/dashboard', module: 'dashboard',  icon: '⊞' },
  { label: 'Billing & Invoice',    path: '/billing',   module: 'billing',    icon: '👤' },
  { label: 'Inventory & Services', path: '/inventory', module: 'inventory',  icon: '📦' },
  { label: 'Vendors & Purchases',  path: '/vendors',   module: 'vendors',    icon: '🚚' },
  { label: 'Banking',              path: '/banking',   module: 'banking',    icon: '🏦' },
  { label: 'Expenses',             path: '/expenses',  module: 'expenses',   icon: '💵' },
  { label: 'Reports',              path: '/reports',   module: 'reports',    icon: '📊' },
  { label: 'Settings',             path: '/settings',  module: 'settings',   icon: '⚙️' },
];

export default function Sidebar() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [company, setCompany] = useState({ company_name: 'Invoicing App', logo_path: '' });
  const [logoSrc, setLogoSrc] = useState('');

  useEffect(() => {
    window.electron.invoke('settings:getCompany', {})
      .then((d) => { if (d) setCompany(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadLogo() {
      if (!company.logo_path) {
        if (alive) setLogoSrc('');
        return;
      }
      const res = await window.electron.invoke('settings:getLogoDataUrl', { filePath: company.logo_path }).catch(() => null);
      if (alive) setLogoSrc(res?.success ? (res.dataUrl || '') : '');
    }
    loadLogo();
    return () => { alive = false; };
  }, [company.logo_path]);

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-box" style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {logoSrc ? (
            <img src={logoSrc} alt="Company logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : null}
        </div>
        <span className="sidebar-logo-text">{company.company_name || 'Invoicing App'}</span>
      </div>
      <nav className="sidebar-nav">
        {NAV.filter(item => can(item.module, 'view')).map(item => (
          <div
            key={item.path}
            className={`nav-item ${pathname.startsWith(item.path) ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
          >
            <span style={{ fontSize: 14 }}>{item.icon}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </nav>
    </div>
  );
}
