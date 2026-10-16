import { api } from './client';

export type Grain = 'M' | 'Q' | 'Y';
export const GRAIN_LABELS: Record<Grain, string> = { M: 'Monthly', Q: 'Quarterly', Y: 'Yearly' };

export interface DatasetField {
  key: string;
  label: string;
  kind: 'text' | 'money' | 'count' | 'date' | 'int';
  required: boolean;
  group: 'period' | 'dimension' | 'value';
}

export interface DatasetInfo {
  key: string;
  label: string;
  period_grain: Grain;
  fields: DatasetField[];
  templates: { id: number; source_name: string }[];
  approval_levels: string[];
}

export interface PeriodSummary {
  fy: number;
  period_no: number;
  label: string;
  rows: number;
  total_paise: number;
}

export interface BatchSummary {
  total_rows: number;
  included_rows: number;
  excluded_rows: number;
  error_rows: number;
  warning_rows: number;
  ready_rows: number;
  issue_counts: Record<string, number>;
  periods: PeriodSummary[];
  value_field: string;
  can_submit: boolean;
}

export type BatchStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'superseded';

export interface Batch {
  id: number;
  dataset_type: string;
  dataset_label: string;
  source_name: string;
  original_filename: string;
  period_grain: Grain;
  status: BatchStatus;
  current_level: number;
  levels: string[];
  uploaded_by: string;
  uploaded_by_id: number;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  row_count: number;
  sheet_name: string | null;
  header_row: number;
  column_map: Record<string, string>;
  summary: Partial<BatchSummary>;
  decisions: { level_no: number; decision: 'approved' | 'rejected'; comment: string; ts: string; username: string }[];
  can_act?: boolean;
  replaces?: { batch_id: number; original_filename: string; approved_at: string | null; months: number }[];
  current_months?: number;
  reimport_of: number | null;
  backup_warning?: string | null;
}

export interface Issue {
  field: string | null;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface StagedRow {
  row_no: number;
  values: Record<string, unknown>;
  edited_fields: string[];
  issues: Issue[];
  excluded: boolean;
}

export interface SheetPreview {
  headers: string[];
  sample: Record<string, unknown>[];
  suggested_map: Record<string, string>;
  from_template: boolean;
}

export const importApi = {
  datasets: () => api<DatasetInfo[]>('GET', '/api/import/datasets'),
  upload: (dataset_type: string, source_name: string, path: string) =>
    api<{ batch: Batch; sheets: string[]; duplicate_of: { id: number; status: string; created_at: string } | null; auto_import_error: string | null }>('POST', '/api/import/upload', { dataset_type, source_name, path }),
  sheet: (id: number, sheet: string, header_row: number) =>
    api<SheetPreview>('GET', `/api/import/batches/${id}/sheet?${new URLSearchParams({ sheet, header_row: String(header_row) })}`),
  sheets: (id: number) => api<{ batch: Batch; sheets: string[] }>('GET', `/api/import/batches/${id}/sheets`),
  map: (id: number, sheet: string, header_row: number, column_map: Record<string, string>) =>
    api<{ batch: Batch; summary: BatchSummary }>('POST', `/api/import/batches/${id}/mapping`, { sheet, header_row, column_map, save_template: true }),
  batches: (status?: string) => api<{ items: Batch[]; total: number }>('GET', `/api/import/batches${status ? `?status=${status}` : ''}`),
  batch: (id: number) => api<Batch>('GET', `/api/import/batches/${id}`),
  rows: (id: number, filter: string, offset: number, limit = 100) =>
    api<{ rows: StagedRow[]; total: number }>('GET', `/api/import/batches/${id}/rows?filter=${filter}&offset=${offset}&limit=${limit}`),
  editRow: (id: number, row_no: number, body: { values?: Record<string, string | null>; excluded?: boolean }) =>
    api<{ summary: BatchSummary }>('PATCH', `/api/import/batches/${id}/rows/${row_no}`, body),
  validate: (id: number) => api<{ summary: BatchSummary }>('POST', `/api/import/batches/${id}/validate`),
  submit: (id: number) => api<Batch>('POST', `/api/import/batches/${id}/submit`),
  reopen: (id: number) => api<Batch>('POST', `/api/import/batches/${id}/reopen`),
  discard: (id: number) => api<null>('POST', `/api/import/batches/${id}/discard`),
  reimport: (id: number) => api<{ batch: Batch }>('POST', `/api/import/batches/${id}/reimport`),
  facts: (id: number, offset: number) =>
    api<{ fact_table: string; items: Record<string, unknown>[]; total: number }>('GET', `/api/import/batches/${id}/facts?offset=${offset}&limit=100`),
  overrides: (id: number) =>
    api<{ id: number; field: string; old_value: string; new_value: string; reason: string; username: string; ts: string; fact_id: number }[]>('GET', `/api/import/batches/${id}/overrides`),
  override: (body: { fact_table: string; fact_id: number; field: string; new_value: string; reason: string; password: string }) =>
    api<{ old_value: string; new_value: string }>('POST', '/api/overrides', body),
};

export interface SalesReportItem {
  name: string;
  amount_paise: number;
  share: number;
  units?: number;
  average_unit_paise?: number;
}

export interface SalesReportPeriod {
  fy: number;
  period_no: number;
  label: string;
  amount_paise: number;
  units: number;
}

export interface SalesSummary {
  fy: number | null;
  fy_label: string;
  available_fys: number[];
  total_paise: number;
  total_units: number;
  row_count: number;
  billing_documents: number;
  periods: SalesReportPeriod[];
  products: SalesReportItem[];
  channels: SalesReportItem[];
  employees: SalesReportItem[];
  customers: SalesReportItem[];
}

export const reportApi = {
  salesSummary: (fy?: number) => api<SalesSummary>('GET', `/api/reports/sales-summary${fy === undefined ? '' : `?fy=${fy}`}`),
};

export const approvalsApi = {
  pending: () => api<Batch[]>('GET', '/api/approvals/pending'),
  approve: (id: number, comment: string) => api<Batch>('POST', `/api/approvals/${id}/approve`, { comment }),
  reject: (id: number, comment: string) => api<Batch>('POST', `/api/approvals/${id}/reject`, { comment }),
  levels: () => api<Record<string, string[]>>('GET', '/api/approvals/levels'),
  setLevels: (dataset_type: string, roles: string[]) => api<Record<string, string[]>>('PUT', '/api/approvals/levels', { dataset_type, roles }),
  resetLevels: (dataset_type: string) => api<null>('DELETE', `/api/approvals/levels/${dataset_type}`),
  setGrain: (dataset_type: string, period_grain: Grain) => api<unknown>('PUT', '/api/settings/datasets', { dataset_type, period_grain }),
};

export type MasterEntity = 'divisions' | 'segments' | 'products' | 'oems' | 'customer-map' | 'material-map' | 'engineers' | 'assignments';
export type MasterRow = Record<string, unknown> & { id: number; is_active: boolean };

export const masterApi = {
  list: (entity: MasterEntity) => api<MasterRow[]>('GET', `/api/master/${entity}`),
  create: (entity: MasterEntity, body: Record<string, unknown>) => api<MasterRow>('POST', `/api/master/${entity}`, body),
  update: (entity: MasterEntity, id: number, body: Record<string, unknown>) => api<MasterRow>('PATCH', `/api/master/${entity}/${id}`, body),
};

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
export function formatPaise(paise: number | null | undefined): string {
  return paise === null || paise === undefined ? '—' : INR.format(paise / 100);
}
