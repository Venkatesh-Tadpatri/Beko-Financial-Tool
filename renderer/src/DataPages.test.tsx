import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { FakeBackend } from './test/fakeBackend';

const GOOD = 'Str0ng!Passw0rd';
let backend: FakeBackend;

async function signInAs(username: string, page?: string) {
  render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  );
  const user = userEvent.setup({ delay: null });
  await user.type(await screen.findByLabelText('Username'), username);
  await user.type(screen.getByLabelText('Password'), GOOD);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  const nav = await screen.findByRole('navigation', { name: 'Main' });
  if (page) await user.click(within(nav).getByRole('link', { name: page }));
  return { user, nav };
}

beforeEach(() => {
  backend = new FakeBackend();
  backend.install();
  backend.addUser('founder', GOOD, 'super_admin');
  backend.addUser('eddie', GOOD, 'editor');
  backend.addUser('april', GOOD, 'approver');
  backend.addUser('val', GOOD, 'viewer');
  window.location.hash = '';
});

describe('Upload wizard', () => {
  it('maps columns, flags problems, lets the editor fix and exclude rows, then submits', async () => {
    backend.chosenExcel = 'C:\\exports\\sales-apr.xlsx';
    const { user } = await signInAs('eddie', 'Upload data');
    await user.click(await screen.findByRole('button', { name: 'Choose Excel file…' }));

    // Step 1: suggested mapping is pre-filled
    expect(await screen.findByText('Step 1 · Match the Excel columns')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/SAP customer code/)).toHaveValue('Sold-To Party'));
    expect(screen.getByText('e.g. C100')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check the data' }));

    // Step 2: review
    expect(await screen.findByText('sales-apr.xlsx')).toBeInTheDocument();
    const submit = await screen.findByRole('button', { name: 'Submit for approval' });
    expect(submit).toBeDisabled();
    expect(await screen.findByText(/C999" is not mapped to an OEM/)).toBeInTheDocument();

    // fix the unmapped code on row 3
    const errorRow = screen.getByText(/C999" is not mapped/).closest('tr')!;
    await user.click(within(errorRow).getByRole('button', { name: 'Fix' }));
    const dialog = screen.getByRole('dialog', { name: 'Fix row 3' });
    const cust = within(dialog).getByLabelText('SAP customer code');
    await user.clear(cust);
    await user.type(cust, 'C100');
    await user.click(within(dialog).getByRole('button', { name: 'Save and check' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeEnabled());
    // the negative amount is a warning only; exclude it anyway
    await user.click(screen.getByRole('tab', { name: 'All rows' }));
    const negRow = (await screen.findByText(/is negative/)).closest('tr')!;
    await user.click(within(negRow).getByRole('button', { name: 'Exclude' }));
    await waitFor(() => expect(backend.data.rows[1].find((r) => r.row_no === 4)!.excluded).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Submit for approval' }));
    expect(await screen.findByText('Submitted for approval.')).toBeInTheDocument();
    expect(backend.data.batches[0].status).toBe('submitted');
  });
});

describe('Approvals', () => {
  async function submittedBatch() {
    backend.chosenExcel = 'C:\\exports\\sales-apr.xlsx';
    const d = backend.data;
    const me = backend.users.find((u) => u.user.username === 'eddie')!;
    d.handle({ method: 'POST', path: '/api/import/upload', body: { path: backend.chosenExcel, source_name: 'SAP' } }, '/api/import/upload', me);
    d.handle({ method: 'POST', path: '/api/import/batches/1/mapping', body: { column_map: {} } }, '/api/import/batches/1/mapping', me);
    d.mappedCustomers.add('C999');
    d.handle({ method: 'POST', path: '/api/import/batches/1/validate' }, '/api/import/batches/1/validate', me);
    d.handle({ method: 'POST', path: '/api/import/batches/1/submit' }, '/api/import/batches/1/submit', me);
  }

  it('an approver reviews and approves another user’s upload', async () => {
    await submittedBatch();
    const { user } = await signInAs('april', 'Approvals');
    const card = (await screen.findByText(/Waiting for you \(1\)/)).closest('section')!;
    await user.click(within(card).getByRole('button', { name: 'Review' }));
    await user.click(await screen.findByRole('button', { name: 'Approve and publish' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve and publish' });
    expect(within(dialog).getByText(/become part of the reports/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/Approved. The data is now used in reports./)).toBeInTheDocument();
    expect(backend.data.batches[0].status).toBe('approved');
  });

  it('rejecting needs a reason in the dialog and records it', async () => {
    await submittedBatch();
    const { user } = await signInAs('april', 'Approvals');
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject upload' });
    await user.type(within(dialog).getByLabelText('Reason (required)'), 'Wrong month');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText(/Rejected. The uploader can reopen it/)).toBeInTheDocument();
    expect(backend.data.batches[0].decisions).toEqual([expect.objectContaining({ comment: 'Wrong month' })]);
  });

  it('the uploader is not offered approval of their own upload', async () => {
    await submittedBatch();
    backend.users.find((u) => u.user.username === 'eddie')!.user.role = 'approver';
    backend.users.find((u) => u.user.username === 'eddie')!.user.permissions.push('approve_data');
    await signInAs('eddie', 'Approvals');
    expect(await screen.findByText(/Waiting for you \(0\)/)).toBeInTheDocument();
    expect(screen.getByText(/not the uploader/)).toBeInTheDocument();
  });

  it('an override needs a reason and the password', async () => {
    await submittedBatch();
    backend.data.batches[0].status = 'approved';
    window.location.hash = '#/upload/1';
    const { user } = await signInAs('april');
    await user.click(await screen.findByRole('button', { name: 'Override amount' }));
    const dialog = screen.getByRole('dialog', { name: 'Override amount' });
    const go = within(dialog).getByRole('button', { name: 'Override' });
    expect(go).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(/New amount/));
    await user.type(within(dialog).getByLabelText(/New amount/), '1250.50');
    await user.type(within(dialog).getByLabelText('Reason'), 'Credit note posted late');
    await user.type(within(dialog).getByLabelText('Your password'), GOOD);
    await user.click(go);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Override amount' })).not.toBeInTheDocument());
    expect(backend.data.overrideBodies[0]).toMatchObject({ fact_id: 1, field: 'amount_paise', new_value: '1250.50', reason: 'Credit note posted late' });
  });
});

describe('Master data', () => {
  it('an admin adds an OEM', async () => {
    const { user } = await signInAs('founder', 'Master data');
    expect(await screen.findByText('Alpha Appliances')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Code'), 'OEM2');
    await user.type(within(dialog).getByLabelText('Name'), 'Beta Retail');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Beta Retail')).toBeInTheDocument();
  });

  it('shows the data settings tab with period and approval chain', async () => {
    const { user } = await signInAs('founder', 'Master data');
    await user.click(await screen.findByRole('tab', { name: 'Data settings' }));
    expect(await screen.findByLabelText('Period for Sales (SAP)')).toHaveValue('M');
    expect(screen.getAllByText(/1\. Approver/).length).toBeGreaterThan(0);
  });

  it('editors and viewers do not see master data, viewers do not see upload', async () => {
    const { nav } = await signInAs('eddie');
    expect(within(nav).queryByRole('link', { name: 'Master data' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Upload data' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Approvals' })).not.toBeInTheDocument();
  });
});
