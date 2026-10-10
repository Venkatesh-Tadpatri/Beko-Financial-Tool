import { PASSWORD_RULES } from '../auth/passwordPolicy';

export function PasswordChecklist({ password, confirm, username = '' }: { password: string; confirm: string; username?: string }) {
  const items = [
    ...PASSWORD_RULES.map((r) => ({ label: r.label, ok: r.test(password, username) })),
    { label: 'Both passwords match', ok: password.length > 0 && password === confirm },
  ];
  return (
    <ul aria-label="Password requirements" className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-canvas px-3.5 py-3">
      {items.map((i) => (
        <li key={i.label} className={`flex items-center gap-2 text-xs ${i.ok ? 'text-emerald-700' : 'text-muted'}`}>
          <span
            aria-hidden="true"
            className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${i.ok ? 'bg-emerald-600 text-white' : 'border border-line bg-white'}`}
          >
            {i.ok ? '✓' : ''}
          </span>
          <span>
            {i.label}
            <span className="sr-only">{i.ok ? ' (met)' : ' (not met)'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
