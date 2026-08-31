'use client';

/**
 * Session state for the frontend shell.
 *
 * This is a client-side stub so the interface is complete before the backend
 * lands. It deliberately stores ONLY the account identity — never a password.
 * When Xano auth is wired in, replace the three functions below with calls to
 * the auth endpoints and keep the same shape.
 */

const KEY = 'ceasefire.session.v1';

export interface Session {
  email: string;
  organisation: string;
  createdAt: string;
}

export function readSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return parsed?.email ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSession(s: Session): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode / blocked storage — session simply won't persist */
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}

export function initials(email: string): string {
  const name = email.split('@')[0] ?? '';
  const parts = name.split(/[.\-_+]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || '··';
}

const FREE_MAIL_HOSTS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'gmx.com',
  'yandex.com',
  'mail.com',
  'zoho.com',
]);

/**
 * Derives a workspace name from the email domain — but never from a consumer
 * mailbox. "sara@gmail.com" is not a workspace called Gmail.
 */
export function orgFromEmail(email: string): string {
  const host = (email.split('@')[1] ?? '').toLowerCase();
  if (!host || FREE_MAIL_HOSTS.has(host)) return '';
  const label = host.split('.')[0] ?? '';
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
}

export function isFreeMail(email: string): boolean {
  return FREE_MAIL_HOSTS.has((email.split('@')[1] ?? '').toLowerCase());
}
