import { useMemo, useState, type FormEvent } from 'react';
import { approvalsApi, GRAIN_LABELS, importApi, masterApi, type Grain, type MasterEntity, type MasterRow } from '../api/data';
import { useCan } from '../auth/AuthContext';
import { Badge, Card, Dialog, errorText, LinkButton, Select, Table, Td, useAsync } from '../components/kit';
import { Alert, Button, Field } from '../components/ui';
import { ROLE_LABELS } from '../shell/nav';

type FieldSpec =
  | { key: string; label: string; type: 'text' | 'date' | 'email'; required?: boolean }
  | { key: string; label: string; type: 'ref'; ref: MasterEntity; required?: boolean }
  | { key: string; label: string; type: 'bool' };

interface EntitySpec {
  entity: MasterEntity;
  tab: string;
  title: string;
  help: string;
  columns: { key: string; label: string; ref?: MasterEntity }[];
  fields: FieldSpec[];
  mapping?: boolean; // needs the "manage mappings" permission
}

const NAMED: FieldSpec[] = [
  { key: 'code', label: 'Code', type: 'text', required: true },
  { key: 'name', label: 'Name', type: 'text', required: true },
];

const SPECS: EntitySpec[] = [
  { entity: 'oems', tab: 'OEMs', title: 'OEMs', help: 'Customers grouped as OEMs. SAP customer codes map to these.', columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }], fields: NAMED },
  { entity: 'products', tab: 'Products', title: 'Products', help: 'Each product belongs to one division and one segment. SAP material codes map to products.', columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'division_id', label: 'Division', ref: 'divisions' }, { key: 'segment_id', label: 'Segment', ref: 'segments' }], fields: [...NAMED, { key: 'division_id', label: 'Division', type: 'ref', ref: 'divisions', required: true }, { key: 'segment_id', label: 'Segment', type: 'ref', ref: 'segments', required: true }] },
  { entity: 'segments', tab: 'Segments', title: 'Segments', help: 'Market segments used in the sales-by-segment report.', columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }], fields: NAMED },
  { entity: 'divisions', tab: 'Divisions', title: 'Divisions', help: 'Business divisions. Used as a filter on most reports.', columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }], fields: NAMED },
  { entity: 'customer-map', tab: 'SAP customer codes', title: 'SAP customer codes', help: 'Maps each SAP customer (sold-to) code to an OEM. Uploads with unmapped codes cannot be submitted.', mapping: true, columns: [{ key: 'customer_code', label: 'SAP code' }, { key: 'customer_name', label: 'Customer name' }, { key: 'oem_id', label: 'OEM', ref: 'oems' }], fields: [{ key: 'customer_code', label: 'SAP customer code', type: 'text', required: true }, { key: 'customer_name', label: 'Customer name', type: 'text' }, { key: 'oem_id', label: 'OEM', type: 'ref', ref: 'oems', required: true }] },
  { entity: 'material-map', tab: 'SAP material codes', title: 'SAP material codes', help: 'Maps each SAP material code to a product (and so to a division and segment).', mapping: true, columns: [{ key: 'material_code', label: 'SAP code' }, { key: 'description', label: 'Description' }, { key: 'product_id', label: 'Product', ref: 'products' }], fields: [{ key: 'material_code', label: 'SAP material code', type: 'text', required: true }, { key: 'description', label: 'Description', type: 'text' }, { key: 'product_id', label: 'Product', type: 'ref', ref: 'products', required: true }] },
  { entity: 'engineers', tab: 'Sales engineers', title: 'Sales engineers', help: 'Sales engineers and their availability.', columns: [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'is_available', label: 'Available' }, { key: 'unavailable_to', label: 'Away until' }], fields: [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'email', label: 'Email', type: 'email' }, { key: 'phone', label: 'Phone', type: 'text' }, { key: 'is_available', label: 'Available', type: 'bool' }, { key: 'unavailable_from', label: 'Away from', type: 'date' }, { key: 'unavailable_to', label: 'Away until', type: 'date' }, { key: 'notes', label: 'Notes', type: 'text' }] },
  { entity: 'assignments', tab: 'Assignments', title: 'Engineer assignments', help: 'Which engineer looks after which OEM or division, and for how long.', columns: [{ key: 'engineer_id', label: 'Engineer', ref: 'engineers' }, { key: 'oem_id', label: 'OEM', ref: 'oems' }, { key: 'division_id', label: 'Division', ref: 'divisions' }, { key: 'start_date', label: 'From' }, { key: 'end_date', label: 'To' }], fields: [{ key: 'engineer_id', label: 'Engineer', type: 'ref', ref: 'engineers', required: true }, { key: 'oem_id', label: 'OEM', type: 'ref', ref: 'oems' }, { key: 'division_id', label: 'Division', type: 'ref', ref: 'divisions' }, { key: 'start_date', label: 'From', type: 'date', required: true }, { key: 'end_date', label: 'To (optional)', type: 'date' }] },
];

export function MasterDataPage() {
  const [tab, setTab] = useState<string>(SPECS[0].tab);
  const canConfigure = useCan('configure_approvals');
  const tabs = [...SPECS.map((s) => s.tab), ...(canConfigure ? ['Data settings'] : [])];
  const spec = SPECS.find((s) => s.tab === tab);
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Master data" className="flex flex-wrap gap-1 rounded-xl border border-line bg-white p-1">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === tab}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${t === tab ? 'bg-brand-600 text-white' : 'text-muted hover:bg-canvas hover:text-ink'}`}
          >
            {t}
          </button>
        ))}
      </div>
      {spec ? <EntityPanel key={spec.entity} spec={spec} /> : <DataSettingsPanel />}
    </div>
  );
}

function useRefNames(entities: MasterEntity[]) {
  const key = entities.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loaded = useAsync(async () => Object.fromEntries(await Promise.all(entities.map(async (e) => [e, await masterApi.list(e)] as const))), [key]);
  const names = useMemo(() => {
    const out: Record<string, Record<number, string>> = {};
    for (const [e, rows] of Object.entries(loaded.data ?? {})) {
      out[e] = Object.fromEntries((rows as MasterRow[]).map((r) => [r.id, String(r.name ?? r.code ?? r.id)]));
    }
    return out;
  }, [loaded.data]);
  return { names, options: (loaded.data ?? {}) as Record<string, MasterRow[]>, reload: loaded.reload };
}

function EntityPanel({ spec }: { spec: EntitySpec }) {
  const rows = useAsync(() => masterApi.list(spec.entity), [spec.entity]);
  const refs = [...new Set(spec.fields.filter((f) => f.type === 'ref').map((f) => (f as { ref: MasterEntity }).ref))];
  const { names, options } = useRefNames(refs);
  const [editing, setEditing] = useState<MasterRow | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const canEdit = useCan(spec.mapping ? 'manage_mappings' : 'manage_master_data');

  const visible = (rows.data ?? []).filter(
    (r) => (showInactive || r.is_active) && (!search || JSON.stringify(r).toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <Card
      title={spec.title}
      actions={canEdit && <Button onClick={() => setEditing('new')}>Add</Button>}
    >
      <p className="mb-4 text-sm text-muted">{spec.help}</p>
      <div className="mb-4 flex items-end gap-4">
        <div className="w-72">
          <Field label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="mb-3 flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
      </div>
      {rows.error && <Alert kind="error">{rows.error}</Alert>}
      <Table head={[...spec.columns.map((c) => c.label), 'Status', '']}>
        {visible.map((r) => (
          <tr key={r.id} className={r.is_active ? '' : 'opacity-60'}>
            {spec.columns.map((c) => (
              <Td key={c.key}>
                {c.ref ? names[c.ref]?.[r[c.key] as number] ?? (r[c.key] ? `#${r[c.key]}` : '—') : typeof r[c.key] === 'boolean' ? (r[c.key] ? 'Yes' : 'No') : String(r[c.key] ?? '') || '—'}
              </Td>
            ))}
            <Td>{r.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}{r.is_demo ? <span className="ml-1"><Badge tone="amber">Demo</Badge></span> : null}</Td>
            <Td className="text-right">{canEdit && <LinkButton onClick={() => setEditing(r)}>Edit</LinkButton>}</Td>
          </tr>
        ))}
      </Table>
      {rows.data && visible.length === 0 && <p className="py-6 text-center text-sm text-muted">Nothing here yet.</p>}
      {editing && (
        <EntityDialog
          spec={spec}
          row={editing === 'new' ? null : editing}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void rows.reload();
          }}
        />
      )}
    </Card>
  );
}

function EntityDialog({ spec, row, options, onClose, onSaved }: { spec: EntitySpec; row: MasterRow | null; options: Record<string, MasterRow[]>; onClose: () => void; onSaved: () => void }) {
  const initial: Record<string, unknown> = Object.fromEntries(spec.fields.map((f) => [f.key, row?.[f.key] ?? (f.type === 'bool' ? true : '')]));
  initial.is_active = row?.is_active ?? true;
  const [form, setForm] = useState<Record<string, unknown>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {};
    for (const f of [...spec.fields, { key: 'is_active', label: '', type: 'bool' } as FieldSpec]) {
      const v = form[f.key];
      body[f.key] = f.type === 'ref' ? (v === '' || v === null ? null : Number(v)) : v === '' ? null : v;
    }
    for (const f of spec.fields) if (f.type === 'text' && body[f.key] === null && !('required' in f && f.required)) body[f.key] = '';
    try {
      if (row) await masterApi.update(spec.entity, row.id, body);
      else await masterApi.create(spec.entity, body);
      onSaved();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={`${row ? 'Edit' : 'Add'} ${spec.title.toLowerCase().replace(/s$/, '')}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="entity-form" busy={busy}>Save</Button>
        </>
      }
    >
      <form id="entity-form" onSubmit={submit} className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        {spec.fields.map((f) =>
          f.type === 'ref' ? (
            <Select key={f.key} label={f.label} value={String(form[f.key] ?? '')} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} required={f.required}>
              <option value="">{f.required ? 'Choose…' : 'None'}</option>
              {(options[f.ref] ?? []).filter((o) => o.is_active || o.id === form[f.key]).map((o) => (
                <option key={o.id} value={o.id}>
                  {String(o.name ?? o.code)}{o.code && o.name ? ` (${String(o.code)})` : ''}
                </option>
              ))}
            </Select>
          ) : f.type === 'bool' ? (
            <label key={f.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(form[f.key])} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} /> {f.label}
            </label>
          ) : (
            <Field key={f.key} label={f.label} type={f.type} value={String(form[f.key] ?? '')} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} required={f.required} />
          ),
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(form.is_active)} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
        </label>
        {spec.mapping && row && <p className="text-xs text-muted">Changing a mapping also updates the approved data that uses this code, so reports follow the new mapping.</p>}
      </form>
    </Dialog>
  );
}

function DataSettingsPanel() {
  const datasets = useAsync(() => importApi.datasets());
  const levels = useAsync(() => approvalsApi.levels());
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      setMsg({ kind: 'success', text: done });
      void datasets.reload();
      void levels.reload();
    } catch (e) {
      setMsg({ kind: 'error', text: errorText(e) });
    }
  };
  const chainText = (roles: string[]) => roles.map((r, i) => `${i + 1}. ${ROLE_LABELS[r]}`).join('  →  ');

  return (
    <div className="space-y-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Card title="Period and approval settings per data type">
        <p className="mb-4 text-sm text-muted">
          How often each kind of data arrives, and who must approve it. Changing the period applies to new uploads only. Reports combine
          monthly data into quarters and years automatically.
        </p>
        <Table head={['Data type', 'Period', 'Approval chain', '']}>
          {datasets.data?.map((d) => (
            <tr key={d.key}>
              <Td className="font-medium">{d.label}</Td>
              <Td>
                <select
                  aria-label={`Period for ${d.label}`}
                  className="h-9 rounded-lg border border-line bg-white px-2 text-sm"
                  value={d.period_grain}
                  onChange={(e) => void run(() => approvalsApi.setGrain(d.key, e.target.value as Grain), `${d.label} is now ${GRAIN_LABELS[e.target.value as Grain].toLowerCase()}.`)}
                >
                  {(['M', 'Q', 'Y'] as Grain[]).map((g) => (
                    <option key={g} value={g}>{GRAIN_LABELS[g]}</option>
                  ))}
                </select>
              </Td>
              <Td className="text-muted">
                {chainText(d.approval_levels)}
                {levels.data && !levels.data[d.key] && <span className="ml-2 text-xs">(default)</span>}
              </Td>
              <Td className="text-right">
                <ChainEditor
                  label={d.label}
                  roles={d.approval_levels}
                  custom={Boolean(levels.data?.[d.key])}
                  onSave={(roles) => run(() => approvalsApi.setLevels(d.key, roles), `Approval chain for ${d.label} saved.`)}
                  onReset={() => run(() => approvalsApi.resetLevels(d.key), `${d.label} now uses the default approval chain.`)}
                />
              </Td>
            </tr>
          ))}
        </Table>
        {levels.data?.['*'] && (
          <div className="mt-6 flex items-center justify-between rounded-lg bg-canvas px-4 py-3 text-sm">
            <span>
              <strong>Default approval chain:</strong> {chainText(levels.data['*'])}
            </span>
            <ChainEditor label="the default" roles={levels.data['*']} custom onSave={(roles) => run(() => approvalsApi.setLevels('*', roles), 'Default approval chain saved.')} />
          </div>
        )}
      </Card>
    </div>
  );
}

const APPROVER_ROLES = ['approver', 'admin', 'super_admin'];

function ChainEditor({ label, roles, custom, onSave, onReset }: { label: string; roles: string[]; custom: boolean; onSave: (r: string[]) => void; onReset?: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(roles);
  return (
    <>
      <LinkButton onClick={() => { setDraft(roles); setOpen(true); }}>Change chain</LinkButton>
      {custom && onReset && <LinkButton onClick={onReset}>Use default</LinkButton>}
      {open && (
        <Dialog
          title={`Approval chain for ${label}`}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => { onSave(draft); setOpen(false); }}>Save</Button>
            </>
          }
        >
          <p className="text-sm text-muted">Each level must be approved, in order, by a different person from the uploader.</p>
          {draft.map((r, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <Select label={`Level ${i + 1}`} value={r} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? e.target.value : x)))}>
                  {APPROVER_ROLES.map((x) => (
                    <option key={x} value={x}>{ROLE_LABELS[x]}</option>
                  ))}
                </Select>
              </div>
              {draft.length > 1 && <Button variant="ghost" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>Remove</Button>}
            </div>
          ))}
          {draft.length < 5 && <Button variant="secondary" onClick={() => setDraft([...draft, draft[draft.length - 1]])}>Add level</Button>}
        </Dialog>
      )}
    </>
  );
}
