/** Mirrors backend/app/core/security.py for live feedback. The backend remains the authority. */
export interface Rule {
  label: string;
  test: (password: string, username: string) => boolean;
}

export const PASSWORD_RULES: Rule[] = [
  { label: 'At least 10 characters', test: (p) => p.length >= 10 },
  { label: 'An upper-case letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'A lower-case letter', test: (p) => /[a-z]/.test(p) },
  { label: 'A digit', test: (p) => /\d/.test(p) },
  { label: 'A symbol (e.g. ! @ # $)', test: (p) => /[^A-Za-z0-9]/.test(p) },
  {
    label: 'Does not contain the username',
    test: (p, u) => u.trim().length < 3 || !p.toLowerCase().includes(u.trim().toLowerCase()),
  },
];

export function passwordOk(password: string, username = ''): boolean {
  return password.length <= 128 && PASSWORD_RULES.every((r) => r.test(password, username));
}
