'use client';

import { apiMe, apiSignin, apiSignout, apiSignup } from './api';

/**
 * Session state for the frontend shell.
 *
 * The source of truth is the httpOnly session cookie held by the API — this module
 * only asks the backend who the caller is. Nothing about the identity is stored in
 * the browser, and a password never leaves the form.
 */

export interface Session {
  email: string;
  organisation: string;
  createdAt: string;
}

/** Who the cookie belongs to, or null when nobody is signed in. */
export function readSession(): Promise<Session | null> {
  return apiMe();
}

export function signIn(email: string, password: string): Promise<Session> {
  return apiSignin(email, password);
}

export function signUp(email: string, password: string, organisation: string): Promise<Session> {
  return apiSignup(email, password, organisation);
}

/** Revokes the session row server-side and clears the cookie. */
export function signOut(): Promise<void> {
  return apiSignout();
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
