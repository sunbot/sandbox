/**
 * Barcode helpers for scanning and for typing a code in by hand (pure, so they're tested without a camera).
 */

/** Digits only, from what was typed or scanned ("0 12345 67890 5" → "012345678905"). */
export const digitsOf = (text: string) => text.replace(/\D/g, '');

/** GTIN check digit (UPC-A, UPC-E expanded, EAN-8, EAN-13, GTIN-14): catches a mistyped digit before any lookup. */
export function validGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export type ManualCheck = { ok: true; code: string } | { ok: false; message: string };

/** Whether a typed barcode can be looked up, and why not. UPC-E (6–8 digits printed short) should be typed as printed in full. */
export function checkManualBarcode(text: string): ManualCheck {
  const code = digitsOf(text);
  if (!code) return { ok: false, message: 'Type the numbers under the barcode.' };
  if (![8, 12, 13, 14].includes(code.length)) return { ok: false, message: `That's ${code.length} digits. Barcodes on food have 8, 12 or 13.` };
  if (!validGtin(code)) return { ok: false, message: 'One of the digits looks wrong (the last digit doesn’t check out). Check and try again.' };
  return { ok: true, code };
}

/**
 * Stops the same code being looked up again and again: while a lookup runs nothing else is accepted, and after a failed
 * lookup that same code is ignored for a short while (another code is accepted straight away).
 */
export function createScanGate(cooldownMs = 4000, now: () => number = Date.now) {
  let busy = false;
  let last: { code: string; at: number } | null = null;
  return {
    /** True when this scan should be looked up (and marks the gate busy). */
    accept(code: string): boolean {
      if (busy) return false;
      if (last && last.code === code && now() - last.at < cooldownMs) return false;
      busy = true;
      return true;
    },
    /** The lookup finished; `failed` starts the cool-down for that code. */
    done(code: string, failed: boolean) {
      busy = false;
      last = failed ? { code, at: now() } : null;
    },
    reset() { busy = false; last = null; },
  };
}
