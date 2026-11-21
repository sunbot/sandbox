/**
 * What to do after a barcode lookup fails. Only a genuine "not found" sends the user to type the label in; a network
 * problem, timeout or busy provider offers a retry first (with manual entry still available), and an invalid scan just
 * resumes scanning.
 */
export type ScanFailure =
  | { kind: 'notFound'; message: string }
  | { kind: 'retry'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'settings'; message: string };

export function scanFailure(e: unknown): ScanFailure {
  const status = typeof e === 'object' && e && 'status' in e ? Number((e as { status: unknown }).status) : -1;
  const reason = typeof e === 'object' && e && 'reason' in e ? (e as { reason?: string }).reason : undefined;
  const message = e instanceof Error ? e.message : String(e);
  if (status === 404 && (reason === 'NotFound' || reason === undefined)) return { kind: 'notFound', message: 'This barcode isn’t in any food database yet.' };
  if (status === 400) return { kind: 'invalid', message };
  if (status === 401) return { kind: 'settings', message };
  // 0 = server unreachable, 503 = provider timeout / rate limit / outage, 5xx = server trouble: all temporary.
  return { kind: 'retry', message: status === 0 ? 'Can’t reach the server. Check your connection and try again.' : message };
}
