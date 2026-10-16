/* In-memory stand-in for the Phase 5 endpoints: import, approvals, master data. */
import type { User } from '../api/client';
import type { BridgeRequest, BridgeResponse } from '../global';

const SALES_FIELDS = [
  { key: 'period_date', label: 'Posting / period date', kind: 'date', required: false, group: 'period' },
  { key: 'fiscal_year', label: 'Financial year', kind: 'text', required: false, group: 'period' },
  { key: 'period_no', label: 'Period number', kind: 'int', required: false, group: 'period' },
  { key: 'customer_code', label: 'SAP customer code', kind: 'text', required: true, group: 'dimension' },
  { key: 'material_code', label: 'SAP material code', kind: 'text', required: true, group: 'dimension' },
  { key: 'amount', label: 'Net sales value (₹)', kind: 'money', required: true, group: 'value' },
  { key: 'quantity', label: 'Quantity', kind: 'count', required: false, group: 'value' },
];

type Issue = { field: string | null; code: string; message: string; severity: 'error' | 'warning' };
interface FakeRow {
  row_no: number;
  values: Record<string, unknown>;
  edited_fields: string[];
  issues: Issue[];
  excluded: boolean;
}
type FakeBatch = Record<string, unknown> & { id: number; status: string; uploaded_by_id: number | undefined; summary: Record<string, unknown>; decisions: unknown[] };

export class FakeData {
  batches: FakeBatch[] = [];
  rows: Record<number, FakeRow[]> = {};
  master: Record<string, Record<string, unknown>[]> = {
    oems: [{ id: 1, code: 'OEM1', name: 'Alpha Appliances', is_active: true }],
    divisions: [], segments: [], products: [], 'customer-map': [], 'material-map': [], engineers: [], assignments: [],
  };
  mappedCustomers = new Set(['C100']);
  overrideBodies: Record<string, unknown>[] = [];

  private ok(data: unknown, status = 200): BridgeResponse {
    return { status, ok: true, data };
  }

  private err(status: number, code: string, message: string): BridgeResponse {
    return { status, ok: false, data: { detail: { code, message } } };
  }

  private validate(id: number) {
    const rows = this.rows[id];
    for (const r of rows) {
      r.issues = [];
      if (!this.mappedCustomers.has(String(r.values.customer_code)))
        r.issues.push({ field: 'customer_code', code: 'unmapped_customer', message: `SAP customer code "${String(r.values.customer_code)}" is not mapped to an OEM.`, severity: 'error' });
      if (Number(r.values.amount) < 0) r.issues.push({ field: 'amount', code: 'negative', message: 'Net sales value is negative. Check it is correct.', severity: 'warning' });
    }
    const inc = rows.filter((r) => !r.excluded);
    const errRows = inc.filter((r) => r.issues.some((i) => i.severity === 'error')).length;
    const ok = inc.filter((r) => !r.issues.some((i) => i.severity === 'error'));
    const summary = {
      total_rows: rows.length, included_rows: inc.length, excluded_rows: rows.length - inc.length, error_rows: errRows,
      warning_rows: inc.filter((r) => r.issues.length && !r.issues.some((i) => i.severity === 'error')).length, ready_rows: ok.length,
      issue_counts: {}, value_field: 'amount', can_submit: errRows === 0 && ok.length > 0,
      periods: [{ fy: 2025, period_no: 1, label: 'Apr 2025', rows: ok.length, total_paise: ok.reduce((a, r) => a + Number(r.values.amount) * 100, 0) }],
    };
    this.batches.find((x) => x.id === id)!.summary = summary;
    return summary;
  }

  handle(req: BridgeRequest, route: string, me: { user: User } | null): BridgeResponse | null {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const key = `${req.method} ${route}`;
    const m = /^\/api\/import\/batches\/(\d+)(?:\/([a-z]+))?(?:\/(\d+))?$/.exec(route);
    const masterMatch = /^\/api\/master\/([a-z-]+)(?:\/(\d+))?$/.exec(route);
    const ap = /^\/api\/approvals\/(\d+)\/(approve|reject)$/.exec(route);

    if (key === 'GET /api/import/datasets')
      return this.ok([{ key: 'sales', label: 'Sales (SAP)', period_grain: 'M', fields: SALES_FIELDS, templates: [], approval_levels: ['approver'] }]);
    if (key === 'POST /api/import/upload') {
      const id = this.batches.length + 1;
      const b: FakeBatch = {
        id, dataset_type: 'sales', dataset_label: 'Sales (SAP)', source_name: body.source_name, original_filename: String(body.path).split('\\').pop(),
        period_grain: 'M', status: 'draft', current_level: 0, levels: ['approver'], uploaded_by: me?.user.username, uploaded_by_id: me?.user.id,
        created_at: '2026-10-10T10:00:00+00:00', submitted_at: null, decided_at: null, row_count: 0, sheet_name: 'Export', header_row: 1,
        column_map: {}, summary: {}, decisions: [], reimport_of: null,
      };
      this.batches.push(b);
      return this.ok({ batch: b, sheets: ['Export'], duplicate_of: null }, 201);
    }
    if (key === 'GET /api/import/batches') return this.ok({ items: [...this.batches].reverse(), total: this.batches.length });
    if (key === 'GET /api/approvals/pending')
      return this.ok(this.batches.filter((b) => b.status === 'submitted').map((b) => ({ ...b, can_act: b.uploaded_by_id !== me?.user.id })));
    if (ap) {
      const b = this.batches.find((x) => x.id === Number(ap[1]))!;
      if (b.uploaded_by_id === me?.user.id) return this.err(403, 'own_upload', 'You cannot approve or reject your own upload.');
      b.status = ap[2] === 'approve' ? 'approved' : 'rejected';
      b.decisions.push({ level_no: 1, decision: b.status, comment: body.comment, ts: '2026-10-10T11:00:00+00:00', username: me?.user.username });
      return this.ok({ ...b, backup_warning: null });
    }
    if (m) {
      const id = Number(m[1]);
      const b = this.batches.find((x) => x.id === id);
      if (!b) return this.err(404, 'not_found', 'Upload not found.');
      const sub = `${req.method} ${m[2] ?? ''}`;
      if (sub === 'GET ') return this.ok({ ...b, can_act: b.status === 'submitted' && b.uploaded_by_id !== me?.user.id, replaces: [] });
      if (sub === 'GET sheets') return this.ok({ batch: b, sheets: ['Export'] });
      if (sub === 'GET sheet')
        return this.ok({
          headers: ['Billing Date', 'Sold-To Party', 'Material', 'Net Value'],
          sample: [{ 'Billing Date': '2025-04-15', 'Sold-To Party': 'C100', Material: 'M1', 'Net Value': 1000 }],
          suggested_map: { period_date: 'Billing Date', customer_code: 'Sold-To Party', material_code: 'Material', amount: 'Net Value' },
          from_template: false,
        });
      if (sub === 'POST mapping') {
        b.column_map = body.column_map as Record<string, string>;
        this.rows[id] = [
          { row_no: 2, values: { period_date: '2025-04-15', customer_code: 'C100', material_code: 'M1', amount: 1000 }, edited_fields: [], issues: [], excluded: false },
          { row_no: 3, values: { period_date: '2025-04-16', customer_code: 'C999', material_code: 'M1', amount: 500 }, edited_fields: [], issues: [], excluded: false },
          { row_no: 4, values: { period_date: '2025-04-17', customer_code: 'C100', material_code: 'M1', amount: -20 }, edited_fields: [], issues: [], excluded: false },
        ];
        return this.ok({ batch: b, summary: this.validate(id) });
      }
      if (sub === 'GET rows') {
        const f = new URLSearchParams(req.path.split('?')[1]).get('filter');
        const rows = (this.rows[id] ?? []).filter((r) =>
          f === 'errors' ? !r.excluded && r.issues.some((i) => i.severity === 'error') : f === 'excluded' ? r.excluded : true,
        );
        return this.ok({ rows, total: rows.length });
      }
      if (sub === 'PATCH rows') {
        const r = this.rows[id].find((x) => x.row_no === Number(m[3]))!;
        if (body.values) {
          Object.assign(r.values, body.values);
          r.edited_fields = Object.keys(body.values as object);
        }
        if (typeof body.excluded === 'boolean') r.excluded = body.excluded;
        return this.ok({ summary: this.validate(id) });
      }
      if (sub === 'POST validate') return this.ok({ summary: this.validate(id) });
      if (sub === 'POST submit') {
        if (!(b.summary as { can_submit?: boolean }).can_submit) return this.err(409, 'has_errors', 'Rows still have errors.');
        Object.assign(b, { status: 'approved', current_level: 0, submitted_at: '2026-10-10T10:30:00+00:00', decided_at: '2026-10-10T10:30:00+00:00' });
        return this.ok({ ...b, backup_warning: null });
      }
      if (sub === 'GET facts')
        return this.ok({ fact_table: 'sales_facts', items: [{ id: 1, period_label: 'Apr 2025', customer_code: 'C100', material_code: 'M1', amount_paise: 100000, quantity: 1 }], total: 1 });
      if (sub === 'GET overrides') return this.ok([]);
    }
    if (key === 'POST /api/overrides') {
      this.overrideBodies.push(body);
      return body.password === 'Str0ng!Passw0rd'
        ? this.ok({ old_value: '1000', new_value: String(body.new_value) })
        : this.err(400, 'wrong_password', 'Your password is not correct.');
    }
    if (key === 'GET /api/approvals/levels') return this.ok({ '*': ['approver'] });
    if (masterMatch) {
      const list = this.master[masterMatch[1]];
      if (req.method === 'GET') return this.ok(list);
      if (req.method === 'POST') {
        const row = { id: list.length + 1, ...body };
        list.push(row);
        return this.ok(row, 201);
      }
      const row = list.find((x) => x.id === Number(masterMatch[2]))!;
      Object.assign(row, body);
      return this.ok(row);
    }
    return null;
  }
}
