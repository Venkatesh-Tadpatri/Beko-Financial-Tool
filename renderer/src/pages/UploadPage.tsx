import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GRAIN_LABELS, importApi, type Batch, type BatchStatus } from '../api/data';
import { Badge, Card, errorText, formatDateTime, Select, Table, Td, useAsync } from '../components/kit';
import { Alert, Button, Field } from '../components/ui';

export const STATUS: Record<BatchStatus, { label: string; tone: 'gray' | 'blue' | 'green' | 'red' | 'amber' }> = {
  draft: { label: 'Draft', tone: 'gray' },
  submitted: { label: 'Waiting for approval', tone: 'blue' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  superseded: { label: 'Replaced', tone: 'amber' },
};

const FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'submitted', label: 'Waiting for approval' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'superseded', label: 'Replaced' },
];

export function periodRange(b: Batch): string {
  const p = b.summary.periods ?? [];
  if (!p.length) return '—';
  return p.length === 1 ? p[0].label : `${p[0].label} – ${p[p.length - 1].label}`;
}

export function UploadPage() {
  const navigate = useNavigate();
  const datasets = useAsync(() => importApi.datasets());
  const [filter, setFilter] = useState('');
  const batches = useAsync(() => importApi.batches(filter || undefined), [filter]);
  const [dataset, setDataset] = useState('sales');
  const [source, setSource] = useState('SAP');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = datasets.data?.find((d) => d.key === dataset);

  async function chooseAndUpload() {
    setError(null);
    const path = await window.fvt.chooseExcelFile();
    if (!path) return;
    setBusy(true);
    try {
      const res = await importApi.upload(dataset, source.trim() || 'SAP', path);
      const dup = res.duplicate_of ? `&duplicate=${res.duplicate_of.id}` : '';
      navigate(`/upload/${res.batch.id}?new=1${dup}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="New upload">
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[1fr_1fr_auto]">
          <Select label="What does the file contain?" value={dataset} onChange={(e) => setDataset(e.target.value)}>
            {datasets.data?.map((d) => (
              <option key={d.key} value={d.key}>{d.label}</option>
            ))}
          </Select>
          <div>
            <Field label="Source" list="sources" value={source} onChange={(e) => setSource(e.target.value)} hint="Each source keeps its own saved column mapping." />
            <datalist id="sources">
              {info?.templates.map((t) => <option key={t.id} value={t.source_name} />)}
            </datalist>
          </div>
          <div className="md:pt-[26px]">
            <Button className="h-11" onClick={() => void chooseAndUpload()} busy={busy}>Choose Excel file…</Button>
          </div>
        </div>
        {info && (
          <p className="text-sm text-muted">
            {info.label} data is {GRAIN_LABELS[info.period_grain].toLowerCase()}. A new upload replaces the periods it covers once it is approved; the
            previous version is kept in the history. The original file is archived unchanged.
          </p>
        )}
        {error && <div className="mt-4"><Alert kind="error">{error}</Alert></div>}
      </Card>

      <Card title="Uploads">
        <div role="tablist" aria-label="Upload status" className="mb-4 flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
              className={`rounded-lg px-3 py-1.5 text-sm ${filter === f.key ? 'bg-brand-50 font-medium text-brand-700' : 'text-muted hover:bg-canvas'}`}>
              {f.label}
            </button>
          ))}
        </div>
        {batches.error && <Alert kind="error">{batches.error}</Alert>}
        <Table head={['#', 'File', 'Data', 'Periods', 'Rows', 'Uploaded', 'Status']}>
          {batches.data?.items.map((b) => (
            <tr key={b.id} className="cursor-pointer hover:bg-canvas" onClick={() => navigate(`/upload/${b.id}`)}>
              <Td className="text-muted">{b.id}</Td>
              <Td>
                <button className="text-left font-medium text-brand-700 hover:underline" onClick={() => navigate(`/upload/${b.id}`)}>{b.original_filename}</button>
                <div className="text-xs text-muted">{b.source_name}</div>
              </Td>
              <Td>{b.dataset_label}</Td>
              <Td className="whitespace-nowrap">{periodRange(b)}</Td>
              <Td>{b.summary.ready_rows ?? '—'}</Td>
              <Td className="whitespace-nowrap text-muted">{formatDateTime(b.created_at)}<div className="text-xs">{b.uploaded_by}</div></Td>
              <Td><Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge></Td>
            </tr>
          ))}
        </Table>
        {batches.data?.items.length === 0 && <p className="py-6 text-center text-sm text-muted">No uploads yet.</p>}
      </Card>
    </div>
  );
}
