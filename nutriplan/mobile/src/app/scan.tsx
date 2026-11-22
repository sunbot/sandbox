import { useState, type ReactNode } from 'react';
import { Linking, Platform, StyleSheet, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { lookupBarcode } from '@/api/hooks';
import { AppText, IconButton, PrimaryButton, SecondaryButton, TextButton } from '@/components/ds';
import { CameraOff, Flashlight, FlashlightOff, Keyboard as KeyboardIcon, RefreshCw, ZoomIn, ZoomOut } from '@/components/ds/icons';
import { checkManualBarcode, createScanGate } from '@/features/scan/barcode';
import { scanFailure, type ScanFailure } from '@/features/scan/outcome';
import { useTheme } from '@/theme/ThemeProvider';

/** Zoom is a share of the phone's own maximum, so the same value is a different magnification on each phone. */
const ZOOMED = 0.2;
const HINT = 'Hold the phone about 15–20 cm (6–8 in) from the barcode. If it looks blurry, move back or zoom in.';

/**
 * Point at a barcode: your foods first, then the product databases. A product that isn't in any database goes to
 * "add from label"; a connection problem or busy service offers Retry instead. A camera that can't focus or scan is never
 * reported as "not found": the barcode can always be typed in.
 *
 * Focus: Android keeps continuous autofocus by default (expo-camera's Android "autofocus" option only focuses once at a
 * corner of the preview, so it isn't used). Most blur comes from holding the phone closer than its camera can focus, so
 * the guide is shorter and a zoom toggle lets you stand back; a torch helps in dim light.
 */
export default function ScanScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ date?: string; meal?: string; mode?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<string>('Point the camera at a barcode');
  const [failure, setFailure] = useState<(ScanFailure & { code: string }) | null>(null);
  const [looking, setLooking] = useState(false);
  const [torch, setTorch] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | null>(null);
  const [gate] = useState(() => createScanGate());
  const isWeb = Platform.OS === 'web';

  const manual = (code: string) => router.replace({ pathname: '/custom-food', params: { ...params, barcode: code } });

  const look = async (code: string) => {
    setFailure(null);
    setLooking(true);
    setStatus(`Looking up ${code}…`);
    try {
      const food = await lookupBarcode(code);
      // Leaving the screen: the gate stays closed so the still-running camera can't look it up (and navigate) again.
      router.replace({ pathname: '/food/[id]', params: { ...params, id: food.id } });
    } catch (e) {
      const f = scanFailure(e);
      if (f.kind === 'notFound') { setStatus(f.message); manual(code); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      if (f.kind === 'invalid') { setStatus(f.message); gate.done(code, true, 60_000); } // not a food barcode: don't keep retrying it
      else { setFailure({ ...f, code }); gate.done(code, true); }
    } finally {
      setLooking(false);
    }
  };

  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (failure || typing || !gate.accept(data)) return; // one lookup at a time; a failed code isn't retried by itself
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    void look(data);
  };

  const submitTyped = () => {
    if (looking) return; // the keyboard's return key while a lookup runs
    const c = checkManualBarcode(typed);
    if (!c.ok) { setTypedError(c.message); return; }
    setTypedError(null);
    gate.reset();
    if (gate.accept(c.code)) void look(c.code);
  };

  const typeIn = (
    <View style={{ gap: t.space.sm }}>
      <TextInput value={typed} onChangeText={(v) => { setTyped(v); setTypedError(null); }} keyboardType="number-pad" inputMode="numeric" autoFocus
        placeholder="Numbers under the barcode" placeholderTextColor={t.colors.textMuted} accessibilityLabel="Barcode number" returnKeyType="search" onSubmitEditing={submitTyped}
        style={{ minHeight: t.sizes.touch, borderRadius: t.radii.button, borderWidth: 1, borderColor: typedError ? t.colors.error : t.colors.border, backgroundColor: t.colors.surface,
          color: t.colors.text, paddingHorizontal: t.space.md, fontSize: t.type.body.fontSize, fontVariant: ['tabular-nums'] }} />
      {typedError ? <AppText variant="secondary" style={{ color: t.colors.errorText }} accessibilityLiveRegion="polite">{typedError}</AppText> : null}
      <PrimaryButton label="Look up" loading={looking} disabled={looking} onPress={submitTyped} fullWidth />
    </View>
  );

  // A lookup that failed for a temporary reason: Retry, or type the label in. Shown with or without a camera.
  const failureBlock = failure ? (
    <>
      <AppText variant="body" accessibilityLiveRegion="polite">{failure.message}</AppText>
      {failure.kind === 'retry' ? <PrimaryButton label="Try again" icon={RefreshCw} loading={looking} onPress={() => { gate.reset(); if (gate.accept(failure.code)) void look(failure.code); }} fullWidth /> : null}
      {failure.kind === 'settings' ? <PrimaryButton label="Open Settings" onPress={() => router.push('/settings')} fullWidth /> : null}
      <SecondaryButton label="Enter the label by hand" onPress={() => manual(failure.code)} fullWidth />
    </>
  ) : null;

  // No camera (denied for good, unavailable, or failed to start): typing the barcode always works.
  const noCamera = (title: string, body: string, action?: ReactNode) => (
    <View style={{ flex: 1, justifyContent: 'center', padding: t.screenPadding, gap: t.space.md, backgroundColor: t.colors.background }}>
      <View style={{ alignItems: 'center', gap: t.space.sm }}>
        <CameraOff size={28} color={t.colors.textSecondary} />
        <AppText variant="cardTitle" align="center">{title}</AppText>
        <AppText variant="body" tone="secondary" align="center">{body}</AppText>
      </View>
      {failureBlock ?? <>{action}{typeIn}</>}
      {failure ? <TextButton label="Type another barcode" tone="secondary" onPress={() => setFailure(null)} /> : null}
      <TextButton label="Cancel" tone="secondary" onPress={() => router.back()} />
    </View>
  );

  if (!permission) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  if (!permission.granted) {
    return permission.canAskAgain
      ? noCamera('Camera access is needed to scan', 'Or type the numbers under the barcode.', <PrimaryButton label="Allow camera" onPress={requestPermission} fullWidth />)
      : noCamera('Camera access is turned off', 'Turn on camera access for Intake Grid in your phone’s settings, or type the barcode.',
        isWeb ? undefined : <SecondaryButton label="Open settings" onPress={() => { void Linking.openSettings(); }} fullWidth />);
  }
  if (cameraError) return noCamera('The camera couldn’t start', cameraError);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" enableTorch={torch && !isWeb} zoom={zoomed ? ZOOMED : 0}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }} onBarcodeScanned={onScanned}
        onMountError={(e) => setCameraError(e?.message || 'Try again, or type the barcode instead.')} />
      {/* A wide, short guide: barcodes are wide, and a smaller target keeps the phone far enough away to focus. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: '28%', left: '14%', right: '14%', height: 110, borderWidth: 3, borderColor: '#fff', borderRadius: 14 }} />
      <View style={{ position: 'absolute', top: '28%', right: t.space.md, marginTop: 120, gap: t.space.sm }}>
        <IconButton icon={zoomed ? ZoomOut : ZoomIn} label={zoomed ? 'Zoom out' : 'Zoom in'} variant="tonal" onPress={() => setZoomed((z) => !z)} />
        {!isWeb ? <IconButton icon={torch ? FlashlightOff : Flashlight} label={torch ? 'Turn torch off' : 'Turn torch on'} variant="tonal" onPress={() => setTorch((x) => !x)} /> : null}
      </View>
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: t.screenPadding, paddingBottom: t.space.xxl, gap: t.space.md, backgroundColor: t.colors.surfaceRaised, borderTopLeftRadius: t.radii.sheet, borderTopRightRadius: t.radii.sheet }}>
        {failure ? (
          <>
            {failureBlock}
            <SecondaryButton label="Scan another" onPress={() => { setFailure(null); setStatus('Point the camera at a barcode'); }} fullWidth />
          </>
        ) : typing ? (
          <>
            {typeIn}
            <TextButton label="Back to the camera" tone="secondary" onPress={() => { setTyping(false); setTypedError(null); }} />
          </>
        ) : (
          <>
            <AppText variant="body" align="center" accessibilityLiveRegion="polite">{status}</AppText>
            <AppText variant="caption" tone="muted" align="center">{HINT}</AppText>
            <SecondaryButton label="Type the barcode" icon={KeyboardIcon} onPress={() => setTyping(true)} fullWidth />
            <TextButton label="Cancel" tone="secondary" onPress={() => router.back()} />
          </>
        )}
      </View>
    </View>
  );
}
