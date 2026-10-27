/** Navigation is filtered by the user's permissions; the backend enforces the same rules. */
export interface NavItem {
  to: string;
  label: string;
  permission: string;
  icon: string; // SVG path (24x24)
  phase?: string; // shown on pages not built yet
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const I = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  reports: 'M5 21V10m7 11V4m7 17v-7',
  turnover: 'M4 19h16M7 19v-5m5 5V9m5 10v-8M4 12l5-5 4 3 7-7m0 0h-4m4 0v4',
  revenue: 'M4 20V10m5 10V4m5 16v-7m5 7V7M3 20h18',
  productMix: 'M12 3a9 9 0 1 0 9 9h-9V3Zm3 0v6h6a9 9 0 0 0-6-6Z',
  forecast: 'M3 20h18M6 16v-5m5 5V8m5 8v-3m4 3V6M4 9l5-3 5 4 6-5',
  expenses: 'M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3S9.5 10 12 10.5s4.5 1.3 4.5 3.3-2 3.2-4.5 3.2-4.5-1.4-4.5-3.2',
  margins: 'M19 5 5 19M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm9 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  pnl: 'M4 19h16M6 16V9m4 7V5m4 11v-4m4 4V7',
  balanceSheet: 'M3 8h18L12 3 3 8Zm2 2v8m5-8v8m4-8v8m5-8v8M3 21h18',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 20h16',
  approve: 'm5 12 4 4 10-10',
  master: 'M4 6h16M4 12h16M4 18h10',
  users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1m14-8a3 3 0 1 0 0-6m4 14v-1a4 4 0 0 0-3-3.9M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  backup: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  audit: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4',
};

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', permission: 'view_reports', icon: I.dashboard },
      { to: '/turnover', label: 'Turnover', permission: 'view_reports', icon: I.turnover },
      { to: '/revenue', label: 'Revenue', permission: 'view_reports', icon: I.revenue },
      { to: '/forecast', label: 'Actual vs Forecast', permission: 'view_reports', icon: I.forecast },
      { to: '/expenses', label: 'Expenses', permission: 'view_reports', icon: I.expenses },
      { to: '/margins', label: 'Margins', permission: 'view_reports', icon: I.margins },
      { to: '/pnl-summary', label: 'P&L Summary', permission: 'view_reports', icon: I.pnl },
      { to: '/balance-sheet', label: 'Balance Sheet', permission: 'view_reports', icon: I.balanceSheet },
      { to: '/product-mix', label: 'Product Mix', permission: 'view_reports', icon: I.productMix },
      { to: '/global-presence', label: 'Global Presence', permission: 'view_reports', icon: I.globe },
      { to: '/reports', label: 'Reports', permission: 'view_reports', icon: I.reports },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/upload', label: 'Upload data', permission: 'upload_data', icon: I.upload },
      { to: '/master-data', label: 'Master data', permission: 'manage_master_data', icon: I.master },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/users', label: 'Users', permission: 'manage_users', icon: I.users },
      { to: '/backups', label: 'Backups', permission: 'manage_backups', icon: I.backup },
      { to: '/audit-log', label: 'Audit log', permission: 'view_audit_log', icon: I.audit },
    ],
  },
];

export const ROLE_LABELS: Record<string, string> = {
  viewer: 'Viewer',
  editor: 'Editor',
  approver: 'Approver',
  admin: 'Admin',
  super_admin: 'Super Admin',
};
