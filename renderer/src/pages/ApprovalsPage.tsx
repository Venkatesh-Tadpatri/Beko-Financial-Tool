import { useNavigate } from 'react-router-dom';
import { approvalsApi } from '../api/data';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, formatDateTime, Table, Td, useAsync } from '../components/kit';
import { Alert, Button } from '../components/ui';
import { ROLE_LABELS } from '../shell/nav';
import { periodRange } from './UploadPage';

export function ApprovalsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const pending = useAsync(() => approvalsApi.pending());
  const mine = pending.data?.filter((b) => b.can_act) ?? [];
  const others = pending.data?.filter((b) => !b.can_act) ?? [];

  return (
    <div className="space-y-4">
      {pending.error && <Alert kind="error">{pending.error}</Alert>}
      <Card title={`Waiting for you${pending.data ? ` (${mine.length})` : ''}`}>
        <Table head={['#', 'File', 'Data', 'Periods', 'Rows', 'Submitted', 'Step', '']}>
          {mine.map((b) => (
            <tr key={b.id}>
              <Td className="text-muted">{b.id}</Td>
              <Td className="font-medium">{b.original_filename}<div className="text-xs font-normal text-muted">by {b.uploaded_by}</div></Td>
              <Td>{b.dataset_label}</Td>
              <Td className="whitespace-nowrap">{periodRange(b)}</Td>
              <Td>{b.summary.ready_rows}</Td>
              <Td className="whitespace-nowrap text-muted">{formatDateTime(b.submitted_at)}</Td>
              <Td><Badge tone="blue">{b.current_level} of {b.levels.length}</Badge></Td>
              <Td className="text-right"><Button onClick={() => navigate(`/upload/${b.id}`)}>Review</Button></Td>
            </tr>
          ))}
        </Table>
        {pending.data && mine.length === 0 && <p className="py-6 text-center text-sm text-muted">Nothing is waiting for your approval.</p>}
      </Card>
      {others.length > 0 && (
        <Card title="Waiting for someone else">
          <Table head={['#', 'File', 'Data', 'Uploaded by', 'Needs']}>
            {others.map((b) => (
              <tr key={b.id} className="cursor-pointer hover:bg-canvas" onClick={() => navigate(`/upload/${b.id}`)}>
                <Td className="text-muted">{b.id}</Td>
                <Td>{b.original_filename}</Td>
                <Td>{b.dataset_label}</Td>
                <Td>{b.uploaded_by}{b.uploaded_by_id === user?.id ? ' (you)' : ''}</Td>
                <Td>{ROLE_LABELS[b.levels[b.current_level - 1]]}{b.uploaded_by_id === user?.id ? ', not the uploader' : ''}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
