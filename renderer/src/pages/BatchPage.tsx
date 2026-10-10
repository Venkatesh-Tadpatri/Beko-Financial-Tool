import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  approvalsApi,
  formatPaise,
  GRAIN_LABELS,
  importApi,
  type Batch,
  type BatchSummary,
  type DatasetInfo,
  type SheetPreview,
  type StagedRow,
} from '../api/data';
import { useAuth, useCan } from '../auth/AuthContext';
import { Badge, Card, Dialog, errorText, formatDateTime, LinkButton, Select, Table, Td, useAsync } from '../components/kit';
import { Alert, Button, Field } from '../components/ui';
import { ROLE_LABELS } from '../shell/nav';
import { STATUS } from './UploadPage';

export function BatchPage() {
  const { id } = useParams();
  const batchId = Number(id);
  const [params] = useSearchParams();
  const datasets = useAsync(() => importApi.datasets());
  const batch = useAsync(() => importApi.batch(batchId), [batchId]);
  const [remap, setRemap] = useState(false);
  const b = batch.data;
  const ds = datasets.data?.find((d) => d.key === b?.dataset_type);

  if (batch.error) return <Alert kind="error">{batch.error}</Alert>;
  if (!b || !ds) return <p className="text-sm text-muted">Loading…</p>;

  const needsMapping = b.status === 'draft' && (remap || Object.keys(b.column_map).length === 0);
  return (
    <div className="space-y-4">
      <BatchHeader b={b} ds={ds} />
      {params.get('duplicate') && b.status === 'draft' && (
        <Alert kind="warning">This exact file was uploaded before (upload #{params.get('duplicate')}). Check you are not loading the same data twice.</Alert>
      )}
      {needsMapping ? (
        <MappingStep b={b} ds={ds} onMapped={() => { setRemap(false); void batch.reload(); }} onCancel={Object.keys(b.column_map).length ? () => setRemap(false) : undefined} />
      ) : (
        <ReviewStep b={b} ds={ds} reload={batch.reload} onRemap={() => setRemap(true)} />
      )}
    </div>
  );
}

function BatchHeader({ b, ds }: { b: Batch; ds: DatasetInfo }) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-white px-6 py-4">
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{b.original_filename}</h2>
          <Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">
          Upload #{b.id} · {ds.label} ({GRAIN_LABELS[b.period_grain].toLowerCase()}) · source {b.source_name} · uploaded by {b.uploaded_by} on {formatDateTime(b.created_at)}
          {b.reimport_of ? ` · re-import of #${b.reimport_of}` : ''}
        </p>
      </div>
      {b.status === 'submitted' && (
        <p className="text-sm text-muted">
          Approval step {b.current_level} of {b.levels.length}: needs {ROLE_LABELS[b.levels[b.current_level - 1]]}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ mapping */

function MappingStep({ b, ds, onMapped, onCancel }: { b: Batch; ds: DatasetInfo; onMapped: () => void; onCancel?: () => void }) {
  const sheets = useAsync(() => importApi.sheets(b.id), [b.id]);
  const [sheet, setSheet] = useState(b.sheet_name ?? '');
  const [headerRow, setHeaderRow] = useState(b.header_row || 1);
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sheet && sheets.data?.sheets.length) setSheet(sheets.data.sheets[0]);
  }, [sheets.data, sheet]);

  useEffect(() => {
    if (!sheet) return;
    let live = true;
    importApi.sheet(b.id, sheet, headerRow).then(
      (p) => {
        if (!live) return;
        setPreview(p);
        setMap(p.suggested_map);
        setError(null);
      },
      (e) => live && (setPreview(null), setError(errorText(e))),
    );
    return () => {
      live = false;
    };
  }, [b.id, sheet, headerRow]);

  async function apply(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const clean = Object.fromEntries(Object.entries(map).filter(([, v]) => v));
    try {
      await importApi.map(b.id, sheet, headerRow, clean);
      onMapped();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const sample = preview?.sample[0] ?? {};
  const groups: { title: string; key: 'period' | 'dimension' | 'value'; note?: string }[] = [
    { title: 'Period', key: 'period', note: 'Map a date column, or the financial year and period number columns.' },
    { title: 'What the row is about', key: 'dimension' },
    { title: 'Values', key: 'value' },
  ];

  return (
    <Card title="Step 1 · Match the Excel columns">
      <form onSubmit={apply} className="space-y-6">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid max-w-2xl grid-cols-1 gap-4 md:grid-cols-2">
          <Select label="Sheet" value={sheet} onChange={(e) => setSheet(e.target.value)}>
            {sheets.data?.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Field label="Header row" type="number" min={1} max={1000} value={headerRow} onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))} hint="The row that holds the column names." />
        </div>
        {preview?.from_template && <Alert kind="info">The saved mapping for “{b.source_name}” has been applied. Check it and continue.</Alert>}

        {preview && groups.map((g) => (
          <fieldset key={g.key} className="space-y-2">
            <legend className="text-sm font-semibold">{g.title}</legend>
            {g.note && <p className="text-xs text-muted">{g.note}</p>}
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
              {ds.fields.filter((f) => f.group === g.key).map((f) => (
                <div key={f.key} className="grid grid-cols-[1fr_1fr] items-center gap-3">
                  <label htmlFor={`map-${f.key}`} className="text-sm">
                    {f.label}
                    {f.required && <span className="text-red-600"> *</span>}
                  </label>
                  <div>
                    <select id={`map-${f.key}`} value={map[f.key] ?? ''} onChange={(e) => setMap({ ...map, [f.key]: e.target.value })}
                      className="h-9 w-full rounded-lg border border-line bg-white px-2 text-sm">
                      <option value="">— not in file —</option>
                      {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    {map[f.key] && <div className="mt-0.5 truncate text-xs text-muted">e.g. {String(sample[map[f.key]] ?? '(empty)')}</div>}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
        ))}

        {preview && (
          <details className="rounded-lg border border-line">
            <summary className="cursor-pointer px-4 py-2 text-sm font-medium">First {preview.sample.length} rows of the sheet</summary>
            <div className="max-h-72 overflow-auto px-4 pb-3">
              <Table head={preview.headers}>
                {preview.sample.map((r, i) => (
                  <tr key={i}>{preview.headers.map((h) => <Td key={h} className="whitespace-nowrap text-xs">{String(r[h] ?? '')}</Td>)}</tr>
                ))}
              </Table>
            </div>
          </details>
        )}

        <div className="flex gap-3">
          <Button type="submit" busy={busy} disabled={!preview}>Check the data</Button>
          {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
        </div>
        <p className="text-xs text-muted">The mapping is saved for the source “{b.source_name}”, so next month's file is matched automatically.</p>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ review */

const FILTERS = [
  { key: 'all', label: 'All rows' },
  { key: 'errors', label: 'Errors' },
  { key: 'warnings', label: 'Warnings' },
  { key: 'excluded', label: 'Excluded' },
];
const PAGE = 100;

function ReviewStep({ b, ds, reload, onRemap }: { b: Batch; ds: DatasetInfo; reload: () => Promise<void>; onRemap: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canUpload = useCan('upload_data');
  const editable = b.status === 'draft' && canUpload;
  const [filter, setFilter] = useState(b.summary.error_rows ? 'errors' : 'all');
  const [offset, setOffset] = useState(0);
  const [summary, setSummary] = useState<Partial<BatchSummary>>(b.summary);
  const rows = useAsync(() => importApi.rows(b.id, filter, offset, PAGE), [b.id, filter, offset, summary]);
  const [editing, setEditing] = useState<StagedRow | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'warning' | 'info'; text: string } | null>(null);
  const [decide, setDecide] = useState<'approve' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSummary(b.summary), [b.summary]);

  const columns = ds.fields.filter((f) => b.column_map[f.key]);
  const act = useCallback(async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      const warn = (r as Batch | null)?.backup_warning;
      if (warn) setMsg({ kind: 'warning', text: `${done ?? 'Done.'} ${warn}` });
      else if (done) setMsg({ kind: 'success', text: done });
      await reload();
    } catch (e) {
      setMsg({ kind: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const s = summary;
  return (
    <div className="space-y-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Rows in file" value={s.total_rows} />
        <Stat label="Ready" value={s.ready_rows} tone="green" />
        <Stat label="With errors" value={s.error_rows} tone={s.error_rows ? 'red' : undefined} />
        <Stat label="With warnings" value={s.warning_rows} tone={s.warning_rows ? 'amber' : undefined} />
        <Stat label="Excluded" value={s.excluded_rows} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title="Periods in this upload">
          <Table head={['Period', 'Rows', `Total (${ds.fields.find((f) => f.key === s.value_field)?.label ?? 'value'})`]}>
            {(s.periods ?? []).map((p) => (
              <tr key={`${p.fy}-${p.period_no}`}>
                <Td>{p.label}</Td>
                <Td>{p.rows}</Td>
                <Td className="text-right tabular-nums">{ds.fields.find((f) => f.key === s.value_field)?.kind === 'count' ? p.total_paise.toLocaleString('en-IN') : formatPaise(p.total_paise)}</Td>
              </tr>
            ))}
          </Table>
          {b.replaces && b.replaces.length > 0 && (
            <p className="mt-3 text-sm text-amber-800">
              When approved, this replaces data from {b.replaces.map((r) => `upload #${r.batch_id} (${r.original_filename}, ${r.months} month${r.months > 1 ? 's' : ''})`).join(', ')}. The older data stays in the history.
            </p>
          )}
        </Card>
        <Card title="Progress">
          <Timeline b={b} />
        </Card>
      </div>

      <Card
        title="Rows"
        actions={
          editable ? (
            <>
              <Button variant="ghost" onClick={onRemap}>Change mapping</Button>
              <Button variant="secondary" busy={busy} onClick={() => void act(async () => setSummary((await importApi.validate(b.id)).summary), 'Checked again with the latest master data.')}>Check again</Button>
              <Button busy={busy} disabled={!s.can_submit} onClick={() => void act(() => importApi.submit(b.id), 'Submitted for approval.')}>Submit for approval</Button>
            </>
          ) : undefined
        }
      >
        {editable && !s.can_submit && (s.error_rows ?? 0) > 0 && (
          <div className="mb-4"><Alert kind="warning">Fix or exclude the {s.error_rows} row(s) with errors before submitting. Unmapped SAP codes can be added by an Admin under Master data; then click “Check again”.</Alert></div>
        )}
        <div role="tablist" aria-label="Row filter" className="mb-3 flex gap-1">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => { setFilter(f.key); setOffset(0); }}
              className={`rounded-lg px-3 py-1.5 text-sm ${filter === f.key ? 'bg-brand-50 font-medium text-brand-700' : 'text-muted hover:bg-canvas'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <Table head={['Row', ...columns.map((c) => c.label.replace(/ \(.*\)$/, '')), 'Check', '']}>
          {rows.data?.rows.map((r) => {
            const err = r.issues.some((i) => i.severity === 'error');
            const warn = !err && r.issues.length > 0;
            return (
              <tr key={r.row_no} className={r.excluded ? 'bg-slate-50 text-muted line-through decoration-slate-300' : err ? 'bg-red-50/60' : warn ? 'bg-amber-50/60' : ''}>
                <Td className="text-muted">{r.row_no}</Td>
                {columns.map((c) => {
                  const bad = r.issues.some((i) => i.field === c.key);
                  return (
                    <Td key={c.key} className={`whitespace-nowrap ${bad ? 'font-medium text-red-700' : ''} ${r.edited_fields.includes(c.key) ? 'italic' : ''}`}>
                      {String(r.values[c.key] ?? '') || <span className="text-red-400">empty</span>}
                    </Td>
                  );
                })}
                <Td className="max-w-[320px] text-xs no-underline">
                  {r.issues.map((i, k) => (
                    <div key={k} className={i.severity === 'error' ? 'text-red-700' : 'text-amber-800'}>{i.message}</div>
                  ))}
                </Td>
                <Td className="whitespace-nowrap text-right no-underline">
                  {editable && <LinkButton onClick={() => setEditing(r)}>Fix</LinkButton>}
                  {editable && (
                    <LinkButton onClick={() => void act(async () => setSummary((await importApi.editRow(b.id, r.row_no, { excluded: !r.excluded })).summary))}>
                      {r.excluded ? 'Include' : 'Exclude'}
                    </LinkButton>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
        <Pager total={rows.data?.total ?? 0} offset={offset} setOffset={setOffset} />
      </Card>

      {b.status === 'submitted' && b.can_act && (
        <div className="flex justify-end gap-3">
          <Button variant="danger" onClick={() => setDecide('reject')}>Reject</Button>
          <Button onClick={() => setDecide('approve')}>{b.current_level < b.levels.length ? `Approve step ${b.current_level}` : 'Approve and publish'}</Button>
        </div>
      )}
      {b.status === 'submitted' && !b.can_act && user?.permissions.includes('approve_data') && b.uploaded_by_id === user.id && (
        <Alert kind="info">You uploaded this file, so another approver must review it.</Alert>
      )}
      {b.status === 'rejected' && canUpload && (
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => void act(() => importApi.discard(b.id).then(() => navigate('/upload')))}>Discard</Button>
          <Button onClick={() => void act(() => importApi.reopen(b.id), 'Reopened as a draft. Make the corrections and submit again.')}>Reopen to correct</Button>
        </div>
      )}
      {b.status === 'draft' && canUpload && (
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => { if (window.confirm('Discard this draft? The archived file is kept.')) void act(() => importApi.discard(b.id).then(() => navigate('/upload'))); }}>Discard draft</Button>
        </div>
      )}
      {(b.status === 'approved' || b.status === 'superseded') && <ApprovedValues b={b} />}
      {(b.status === 'approved' || b.status === 'superseded') && canUpload && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => void act(async () => navigate(`/upload/${(await importApi.reimport(b.id)).batch.id}`))}>Re-import this file</Button>
        </div>
      )}

      {editing && (
        <RowEditDialog b={b} ds={ds} row={editing} onClose={() => setEditing(null)} onSaved={(sum) => { setEditing(null); setSummary(sum); }} />
      )}
      {decide && (
        <DecisionDialog b={b} kind={decide} onClose={() => setDecide(null)} onDone={async (text) => { setDecide(null); setMsg({ kind: 'success', text }); await reload(); }} />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | undefined; tone?: 'green' | 'red' | 'amber' }) {
  const color = tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : '';
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 font-heading text-2xl font-semibold tabular-nums ${color}`}>{value ?? '—'}</div>
    </div>
  );
}

function Pager({ total, offset, setOffset }: { total: number; offset: number; setOffset: (n: number) => void }) {
  if (total <= PAGE) return <p className="mt-3 text-xs text-muted">{total} row(s)</p>;
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-muted">
      <span>{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
        <Button variant="secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
      </div>
    </div>
  );
}

function Timeline({ b }: { b: Batch }) {
  const items: { when: string | null; text: string; tone: 'gray' | 'green' | 'red' | 'blue' }[] = [
    { when: b.created_at, text: `Uploaded by ${b.uploaded_by}`, tone: 'gray' },
  ];
  if (b.submitted_at) items.push({ when: b.submitted_at, text: 'Submitted for approval', tone: 'blue' });
  for (const d of b.decisions) {
    items.push({ when: d.ts, text: `${d.decision === 'approved' ? 'Approved' : 'Rejected'} (step ${d.level_no}) by ${d.username}${d.comment ? `: “${d.comment}”` : ''}`, tone: d.decision === 'approved' ? 'green' : 'red' });
  }
  return (
    <ol className="space-y-3">
      {items.map((i, k) => (
        <li key={k} className="flex gap-3 text-sm">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.tone === 'green' ? 'bg-emerald-500' : i.tone === 'red' ? 'bg-red-500' : i.tone === 'blue' ? 'bg-brand-500' : 'bg-slate-400'}`} />
          <div>
            <div>{i.text}</div>
            <div className="text-xs text-muted">{formatDateTime(i.when)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function RowEditDialog({ b, ds, row, onClose, onSaved }: { b: Batch; ds: DatasetInfo; row: StagedRow; onClose: () => void; onSaved: (s: BatchSummary) => void }) {
  const fields = ds.fields.filter((f) => b.column_map[f.key]);
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.key, String(row.values[f.key] ?? '')])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== String(row.values[k] ?? '')));
    try {
      onSaved((await importApi.editRow(b.id, row.row_no, { values: changed })).summary);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <Dialog title={`Fix row ${row.row_no}`} onClose={onClose} wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="row-form" busy={busy}>Save and check</Button></>}>
      <form id="row-form" onSubmit={save} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {error && <div className="md:col-span-2"><Alert kind="error">{error}</Alert></div>}
        {row.issues.length > 0 && (
          <div className="md:col-span-2">
            <Alert kind="warning">{row.issues.map((i) => i.message).join(' ')}</Alert>
          </div>
        )}
        {fields.map((f) => (
          <Field key={f.key} label={f.label} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            error={row.issues.find((i) => i.field === f.key)?.message} />
        ))}
        <p className="text-xs text-muted md:col-span-2">Corrections apply to this upload only. The original Excel file is not changed.</p>
      </form>
    </Dialog>
  );
}

function DecisionDialog({ b, kind, onClose, onDone }: { b: Batch; kind: 'approve' | 'reject'; onClose: () => void; onDone: (msg: string) => void }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const final = b.current_level >= b.levels.length;
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = kind === 'approve' ? await approvalsApi.approve(b.id, comment) : await approvalsApi.reject(b.id, comment);
      onDone(
        kind === 'reject'
          ? 'Rejected. The uploader can reopen it to correct.'
          : r.status === 'approved'
            ? `Approved. The data is now used in reports.${r.backup_warning ? ` ${r.backup_warning}` : ''}`
            : `Step ${b.current_level} approved. It now waits for ${ROLE_LABELS[r.levels[r.current_level - 1]]}.`,
      );
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={kind === 'approve' ? (final ? 'Approve and publish' : `Approve step ${b.current_level}`) : 'Reject upload'}
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={kind === 'reject' ? 'danger' : 'primary'} busy={busy} onClick={() => void go()}>{kind === 'approve' ? 'Approve' : 'Reject'}</Button></>}
    >
      {error && <Alert kind="error">{error}</Alert>}
      {kind === 'approve' && final && <p className="text-sm">The {b.summary.ready_rows} rows become part of the reports{b.replaces?.length ? ', replacing the earlier data for the same periods' : ''}. A backup is taken automatically.</p>}
      <div className="space-y-1.5">
        <label htmlFor="decision-comment" className="block text-sm font-medium">{kind === 'reject' ? 'Reason (required)' : 'Comment (optional)'}</label>
        <textarea id="decision-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100" />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ approved values + overrides */

const FACT_FIELDS: Record<string, { field: string; label: string; money: boolean }[]> = {
  sales_facts: [{ field: 'amount_paise', label: 'Amount', money: true }, { field: 'quantity', label: 'Quantity', money: false }],
  receivable_facts: [{ field: 'amount_paise', label: 'Amount', money: true }],
  metric_facts: [{ field: 'value', label: 'Value', money: true }],
};

function ApprovedValues({ b }: { b: Batch }) {
  const canOverride = useCan('override_data') && b.status === 'approved';
  const [offset, setOffset] = useState(0);
  const facts = useAsync(() => importApi.facts(b.id, offset), [b.id, offset]);
  const overrides = useAsync(() => importApi.overrides(b.id), [b.id]);
  const [target, setTarget] = useState<{ fact: Record<string, unknown>; field: string; label: string; money: boolean } | null>(null);
  const table = facts.data?.fact_table ?? 'sales_facts';
  const valueFields = FACT_FIELDS[table];
  const dimKeys = table === 'sales_facts' ? ['customer_code', 'material_code'] : table === 'receivable_facts' ? ['customer_code', 'ageing_bucket'] : ['metric', 'category'];

  return (
    <Card title="Approved values">
      <p className="mb-3 text-sm text-muted">
        Approved data can only be changed with an override: you re-enter your password and give a reason, and the change is written to the audit log.
      </p>
      <Table head={['Period', ...dimKeys.map((k) => k.replace('_', ' ')), ...valueFields.map((v) => v.label), '']}>
        {facts.data?.items.map((f) => (
          <tr key={String(f.id)}>
            <Td>{String(f.period_label)}</Td>
            {dimKeys.map((k) => <Td key={k}>{String(f[k] ?? '—')}</Td>)}
            {valueFields.map((v) => (
              <Td key={v.field} className="text-right tabular-nums">
                {v.money && !(table === 'metric_facts' && String(f.metric).includes('shares')) ? formatPaise(f[v.field] as number) : String(f[v.field] ?? '—')}
              </Td>
            ))}
            <Td className="text-right">
              {canOverride && valueFields.map((v) => (
                <LinkButton key={v.field} onClick={() => setTarget({ fact: f, ...v, money: v.money && !(table === 'metric_facts' && String(f.metric).includes('shares')) })}>
                  Override {v.label.toLowerCase()}
                </LinkButton>
              ))}
            </Td>
          </tr>
        ))}
      </Table>
      <Pager total={facts.data?.total ?? 0} offset={offset} setOffset={setOffset} />
      {overrides.data && overrides.data.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold">Overrides</h3>
          <Table head={['When', 'Who', 'Value', 'From', 'To', 'Reason']}>
            {overrides.data.map((o) => (
              <tr key={o.id}>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(o.ts)}</Td>
                <Td>{o.username}</Td>
                <Td>#{o.fact_id} {o.field.replace('_paise', '')}</Td>
                <Td>{o.old_value}</Td>
                <Td className="font-medium">{o.new_value}</Td>
                <Td className="text-muted">{o.reason}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {target && (
        <OverrideDialog
          table={table}
          target={target}
          onClose={() => setTarget(null)}
          onDone={() => { setTarget(null); void facts.reload(); void overrides.reload(); }}
        />
      )}
    </Card>
  );
}

function OverrideDialog({ table, target, onClose, onDone }: { table: string; target: { fact: Record<string, unknown>; field: string; label: string; money: boolean }; onClose: () => void; onDone: () => void }) {
  const current = target.fact[target.field] as number | null;
  const [value, setValue] = useState(current === null ? '' : target.money ? String(current / 100) : String(current));
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await importApi.override({ fact_table: table, fact_id: Number(target.fact.id), field: target.field, new_value: value, reason, password });
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <Dialog title={`Override ${target.label.toLowerCase()}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="override-form" variant="danger" busy={busy} disabled={!value || reason.trim().length < 5 || !password}>Override</Button></>}>
      <form id="override-form" onSubmit={save} className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <p className="text-sm">Current value: <strong>{target.money ? formatPaise(current) : String(current ?? '—')}</strong></p>
        <Field label={`New ${target.label.toLowerCase()}${target.money ? ' (₹)' : ''}`} value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="space-y-1.5">
          <label htmlFor="override-reason" className="block text-sm font-medium">Reason</label>
          <textarea id="override-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </div>
        <Field label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </form>
    </Dialog>
  );
}
