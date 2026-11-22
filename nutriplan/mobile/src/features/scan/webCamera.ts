/**
 * Browser camera helpers for the web barcode scanner (pure: no DOM globals, so they're tested without a camera).
 *
 * Why this exists: on web, expo-camera asks the browser for `facingMode: ideal environment` and nothing else, so Chrome on
 * Android hands back its low default size (typically 640×480) stretched over the whole screen, never applies a focus mode
 * (it converts 'continuous' with a table that has no such entry) and can't pick a lens. Here the stream is requested at a
 * useful size, and focus, zoom and torch are applied only where the chosen camera's own capabilities list them.
 */

/** The barcode formats the scanner reads (the same four as the native scanner), in BarcodeDetector's names. */
export const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

/** The formats this browser's BarcodeDetector can actually read, from `BarcodeDetector.getSupportedFormats()`. */
export function supportedScanFormats(supported: readonly string[]): string[] {
  return SCAN_FORMATS.filter((f) => supported.includes(f));
}

type Range = { min?: number; max?: number; step?: number };

/** The part of `MediaTrack.getCapabilities()` that matters here (browsers list only what a camera supports). */
export type TrackCaps = {
  width?: Range;
  height?: Range;
  focusMode?: readonly string[];
  zoom?: Range;
  torch?: boolean;
  facingMode?: readonly string[];
};

export type TrackSettings = { width?: number; height?: number; deviceId?: string; facingMode?: string };

/** What the chosen camera can do, in the terms the scanner needs. */
export type CameraSummary = {
  width: number;
  height: number;
  /** Null when the browser doesn't report focus modes at all (then nothing is assumed either way). */
  focusModes: readonly string[] | null;
  continuousFocus: boolean;
  zoom: { min: number; max: number } | null;
  torch: boolean;
};

export function describeTrack(caps: TrackCaps | null | undefined, settings: TrackSettings | null | undefined): CameraSummary {
  const c = caps ?? {};
  const focusModes = Array.isArray(c.focusMode) ? c.focusMode : null;
  const z = c.zoom;
  return {
    width: settings?.width ?? 0,
    height: settings?.height ?? 0,
    focusModes,
    continuousFocus: !!focusModes?.includes('continuous'),
    zoom: z && typeof z.min === 'number' && typeof z.max === 'number' && z.max > z.min ? { min: z.min, max: z.max } : null,
    torch: c.torch === true,
  };
}

/** Constraints for opening the scanner's camera: the rear camera (or an exact device) at a size barcodes can be read at. */
export function buildVideoConstraints(deviceId?: string): MediaTrackConstraints {
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  return deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: 'environment' }, ...size };
}

/** Looser requests to try, in order, if the browser says the first one can't be met. */
export const FALLBACK_CONSTRAINTS: readonly MediaTrackConstraints[] = [
  { facingMode: { ideal: 'environment' } },
  {},
];

/**
 * A camera that reports its focus modes but not continuous autofocus (a fixed-focus or manual-only lens) can't keep a barcode
 * sharp as the phone moves, so another rear lens is worth trying. A camera that reports nothing is left alone: nothing is known.
 */
export function needsBetterCamera(s: CameraSummary): boolean {
  return s.focusModes !== null && !s.continuousFocus;
}

export type DeviceInfo = { deviceId: string; label?: string; kind?: string; facing?: readonly string[] };

const FRONT_LABEL = /front|user|facetime|selfie/i;
const REAR_LABEL = /back|rear|environment/i;

/**
 * Other rear cameras worth trying, never the one already open and at most `limit` of them. A camera counts as rear when
 * its own capabilities say `environment`, or (only when they say nothing) its label says back/rear; a front-looking one never does.
 */
export function rearCandidates(devices: readonly DeviceInfo[], currentDeviceId: string | undefined, limit = 3): string[] {
  return devices
    .filter((d) => d.kind === undefined || d.kind === 'videoinput')
    .filter((d) => d.deviceId && d.deviceId !== currentDeviceId)
    .filter((d) => {
      if (d.facing && d.facing.length > 0) return d.facing.includes('environment');
      const label = d.label ?? '';
      return REAR_LABEL.test(label) && !FRONT_LABEL.test(label);
    })
    .map((d) => d.deviceId)
    .slice(0, limit);
}

/** The best of the cameras tried: continuous autofocus first, then the larger picture; the first one on a tie. */
export function pickBestCamera<T extends { summary: CameraSummary }>(tried: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const t of tried) {
    if (!best) { best = t; continue; }
    const a = best.summary, b = t.summary;
    if (b.continuousFocus !== a.continuousFocus ? b.continuousFocus : b.width * b.height > a.width * a.height) best = t;
  }
  return best;
}

/** The constraint sets to apply after opening: one each, because a browser drops a whole set if any part is unsupported. */
export function focusConstraint(s: CameraSummary): MediaTrackConstraintSet | null {
  return s.continuousFocus ? ({ focusMode: 'continuous' } as MediaTrackConstraintSet) : null;
}

/**
 * The zoom for "zoomed in": twice the normal view, only when the camera's range allows a real step beyond it. Digital zoom
 * past that only enlarges pixels, so it isn't offered. Null when the camera has no zoom.
 */
export function zoomedLevel(s: CameraSummary): number | null {
  if (!s.zoom) return null;
  const base = Math.min(s.zoom.max, Math.max(1, s.zoom.min));
  const target = Math.min(s.zoom.max, base * 2);
  return target >= base * 1.25 ? Math.round(target * 100) / 100 : null;
}

/** The zoom for the normal view: 1× when the range includes it, else the camera's own minimum. */
export function normalLevel(s: CameraSummary): number | null {
  if (!s.zoom) return null;
  return Math.min(s.zoom.max, Math.max(1, s.zoom.min));
}

export type CameraErrorKind = 'denied' | 'none' | 'busy' | 'insecure' | 'other';

/** What went wrong opening the camera, in words a person can act on (the barcode can always be typed in). */
export function classifyCameraError(error: unknown, secureContext = true): { kind: CameraErrorKind; message: string } {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  if (!secureContext) return { kind: 'insecure', message: 'The camera only works on a secure (https) page. You can type the barcode instead.' };
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { kind: 'denied', message: 'Camera access is blocked. In Chrome, tap the lock icon by the address, allow Camera, then reopen this screen. Or type the barcode.' };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { kind: 'none', message: 'No camera was found on this device. You can type the barcode instead.' };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { kind: 'busy', message: 'The camera is in use by another app or tab. Close it and try again, or type the barcode.' };
    default:
      return { kind: 'other', message: 'The camera couldn’t start. Try again, or type the barcode instead.' };
  }
}

/** Whether a failed request was the browser saying the constraints couldn't be met (worth retrying looser). */
export const isOverconstrained = (error: unknown): boolean => {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  return name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError';
};
