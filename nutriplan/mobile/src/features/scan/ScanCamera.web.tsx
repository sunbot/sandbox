import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ExpoScanCamera } from './ExpoScanCamera';
import type { ScanCameraProps } from './ScanCamera.types';
import {
  FALLBACK_CONSTRAINTS, buildVideoConstraints, classifyCameraError, describeTrack, focusConstraint, isOverconstrained, needsBetterCamera,
  normalLevel, pickBestCamera, rearCandidates, supportedScanFormats, zoomedLevel, type CameraSummary, type TrackCaps, type TrackSettings,
} from './webCamera';

type Detected = { rawValue?: string };
type Detector = { detect(source: HTMLVideoElement): Promise<Detected[]> };
type DetectorCtor = { new (options: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

const detectorCtor = () => (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
const SCAN_INTERVAL_MS = 250;

/**
 * Web scanner. With the browser's own BarcodeDetector it opens the camera itself, because expo-camera can't ask for a picture
 * size, a focus mode or a particular lens on web (Chrome then gives a low-resolution preview that never refocuses). Other
 * browsers keep the expo-camera scanner exactly as before.
 */
export function ScanCamera(props: ScanCameraProps) {
  const [engine, setEngine] = useState<{ kind: 'checking' | 'detector' | 'fallback'; formats: string[] }>({ kind: 'checking', formats: [] });

  useEffect(() => {
    let alive = true;
    (async () => {
      const Ctor = detectorCtor();
      let usable: string[] = [];
      try {
        if (Ctor && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function') usable = supportedScanFormats(await (Ctor.getSupportedFormats?.() ?? Promise.resolve([])));
      } catch { /* treated as unsupported */ }
      if (!alive) return;
      setEngine({ kind: usable.length > 0 ? 'detector' : 'fallback', formats: usable });
    })();
    return () => { alive = false; };
  }, []);

  const { onSupport } = props;
  // The expo-camera fallback keeps the web behaviour it always had: a zoom button, no torch.
  useEffect(() => { if (engine.kind === 'fallback') onSupport?.({ zoom: true, torch: false }); }, [engine.kind, onSupport]);

  if (engine.kind === 'checking') return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />;
  if (engine.kind === 'fallback') return <ExpoScanCamera {...props} enableTorch={false} />;
  return <DetectorCamera {...props} formats={engine.formats} />;
}

type Opened = { stream: MediaStream; track: MediaStreamTrack; summary: CameraSummary; deviceId?: string };

function inspect(stream: MediaStream): Opened {
  const track = stream.getVideoTracks()[0];
  const caps = (typeof track.getCapabilities === 'function' ? track.getCapabilities() : {}) as TrackCaps;
  const settings = track.getSettings() as TrackSettings;
  return { stream, track, summary: describeTrack(caps, settings), deviceId: settings.deviceId };
}

const stop = (s: MediaStream | null | undefined) => s?.getTracks().forEach((t) => t.stop());

/** Opens the rear camera at a useful size; looser requests are tried only if the browser says that one can't be met. */
async function openDefault(): Promise<Opened> {
  const attempts: MediaTrackConstraints[] = [buildVideoConstraints(), ...FALLBACK_CONSTRAINTS];
  let last: unknown;
  for (const video of attempts) {
    try {
      return inspect(await navigator.mediaDevices.getUserMedia({ video: Object.keys(video).length ? video : true, audio: false }));
    } catch (e) {
      last = e;
      if (!isOverconstrained(e)) throw e;
    }
  }
  throw last;
}

/**
 * Chrome picks the rear lens. If that one reports focus modes without continuous autofocus (a fixed-focus lens), try the other
 * rear cameras once, one at a time (phones can't open two together), and keep the first that can focus; otherwise reopen the default.
 */
async function chooseCamera(first: Opened, isAlive: () => boolean): Promise<Opened> {
  if (!needsBetterCamera(first.summary) || !navigator.mediaDevices.enumerateDevices) return first;
  let devices: MediaDeviceInfo[] = [];
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { return first; }
  const others = rearCandidates(devices.map((d) => ({
    deviceId: d.deviceId, label: d.label, kind: d.kind,
    facing: typeof (d as MediaDeviceInfo & { getCapabilities?: () => TrackCaps }).getCapabilities === 'function'
      ? (d as MediaDeviceInfo & { getCapabilities: () => TrackCaps }).getCapabilities().facingMode : undefined,
  })), first.deviceId);
  if (others.length === 0) return first;

  stop(first.stream);
  const tried: Opened[] = [first];
  for (const id of others) {
    if (!isAlive()) break;
    try {
      const o = inspect(await navigator.mediaDevices.getUserMedia({ video: buildVideoConstraints(id), audio: false }));
      tried.push(o);
      if (o.summary.continuousFocus) break; // good enough: stop trying lenses
      stop(o.stream);
    } catch { /* that lens can't be opened: skip it */ }
  }
  const best = pickBestCamera(tried) ?? first;
  // Whatever isn't kept is closed; a camera that was closed to try others is reopened by its id.
  tried.forEach((t) => { if (t !== best) stop(t.stream); });
  if (best.stream.active) return best;
  return inspect(await navigator.mediaDevices.getUserMedia({ video: buildVideoConstraints(best.deviceId), audio: false }));
}

function DetectorCamera({ torch, zoomed, onScanned, onError, onSupport, formats }: ScanCameraProps & { formats: string[] }) {
  const host = useRef<HTMLElement | null>(null);
  const opened = useRef<Opened | null>(null);
  const callbacks = useRef({ onScanned, onError, onSupport });
  useEffect(() => { callbacks.current = { onScanned, onError, onSupport }; });

  // Open the camera, show it, scan it; release everything when leaving.
  useEffect(() => {
    const Ctor = detectorCtor();
    const container = host.current;
    if (!Ctor || !container) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let current: Opened | null = null;
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.muted = true;
    video.autoplay = true;
    Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', background: '#000' });
    container.appendChild(video);

    (async () => {
      try {
        if (!window.isSecureContext) throw Object.assign(new Error('insecure'), { name: 'InsecureContext' });
        const first = await openDefault();
        if (!alive) { stop(first.stream); return; }
        current = await chooseCamera(first, () => alive);
        if (!alive) { stop(current.stream); return; }
        opened.current = current;
        const { track, summary } = current;

        const focus = focusConstraint(summary);
        if (focus) await track.applyConstraints({ advanced: [focus] }).catch(() => undefined);
        if (__DEV__) console.debug('[scan] camera', { size: `${summary.width}x${summary.height}`, focusModes: summary.focusModes, zoom: summary.zoom, torch: summary.torch });
        callbacks.current.onSupport?.({ zoom: zoomedLevel(summary) !== null, torch: summary.torch });
        track.addEventListener('ended', () => { if (alive) callbacks.current.onError('The camera stopped. Close other apps using it, then reopen this screen, or type the barcode.'); });

        video.srcObject = current.stream;
        await video.play().catch(() => undefined);

        const detector = new Ctor({ formats });
        let busy = false;
        timer = setInterval(async () => {
          // One detection at a time, none while the tab is hidden or before there's a picture.
          if (busy || document.hidden || video.readyState < 2) return;
          busy = true;
          try {
            for (const b of await detector.detect(video)) if (b.rawValue) callbacks.current.onScanned(b.rawValue);
          } catch { /* a missed frame; the next one tries again */ } finally { busy = false; }
        }, SCAN_INTERVAL_MS);
      } catch (e) {
        if (alive) callbacks.current.onError(classifyCameraError(e, window.isSecureContext !== false).message);
      }
    })();

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      stop(current?.stream);
      opened.current = null;
      video.srcObject = null;
      video.remove();
    };
  }, [formats]);

  // Zoom and torch follow the buttons, only where this camera supports them.
  useEffect(() => {
    const o = opened.current;
    if (!o) return;
    const level = zoomed ? zoomedLevel(o.summary) : normalLevel(o.summary);
    if (level !== null) void o.track.applyConstraints({ advanced: [{ zoom: level } as MediaTrackConstraintSet] }).catch(() => undefined);
  }, [zoomed]);
  useEffect(() => {
    const o = opened.current;
    if (o?.summary.torch) void o.track.applyConstraints({ advanced: [{ torch } as MediaTrackConstraintSet] }).catch(() => undefined);
  }, [torch]);

  return <View ref={(el) => { host.current = el as unknown as HTMLElement | null; }} style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />;
}
