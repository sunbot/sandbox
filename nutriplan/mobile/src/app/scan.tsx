import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { lookupBarcode } from '@/api/hooks';
import { AppText, PrimaryButton, SecondaryButton } from '@/components/ds';
import { RefreshCw } from '@/components/ds/icons';
import { scanFailure, type ScanFailure } from '@/features/scan/outcome';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Point at a barcode: your foods first, then the product databases. A product that isn't in any database goes to
 * "add from label"; a connection problem or busy service offers Retry instead (manual entry stays one tap away).
 */
export default function ScanScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ date?: string; meal?: string; mode?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<string>('Point the camera at a barcode');
  const [failure, setFailure] = useState<(ScanFailure & { code: string }) | null>(null);
  const [looking, setLooking] = useState(false);
  const busy = useRef(false);

  if (!permission) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.screenPadding, gap: t.space.md, backgroundColor: t.colors.background }}>
        <AppText variant="body" align="center">Camera access is needed to scan barcodes.</AppText>
        <PrimaryButton label="Allow camera" onPress={requestPermission} />
      </View>
    );
  }

  const manual = (code: string) => router.replace({ pathname: '/custom-food', params: { ...params, barcode: code } });

  const look = async (code: string) => {
    setFailure(null);
    setLooking(true);
    setStatus(`Looking up ${code}…`);
    try {
      const food = await lookupBarcode(code);
      router.replace({ pathname: '/food/[id]', params: { ...params, id: food.id } });
    } catch (e) {
      const f = scanFailure(e);
      if (f.kind === 'notFound') { setStatus(f.message); manual(code); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      if (f.kind === 'invalid') { setStatus(`${f.message}`); busy.current = false; }
      else setFailure({ ...f, code });
    } finally {
      setLooking(false);
    }
  };

  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (busy.current) return;
    busy.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    look(data);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={StyleSheet.absoluteFill} facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }} onBarcodeScanned={onScanned} />
      <View pointerEvents="none" style={{ position: 'absolute', top: '35%', left: '10%', right: '10%', height: 160, borderWidth: 3, borderColor: '#fff', borderRadius: 16 }} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: t.screenPadding, paddingBottom: t.space.xxl, gap: t.space.md, backgroundColor: t.colors.surfaceRaised, borderTopLeftRadius: t.radii.sheet, borderTopRightRadius: t.radii.sheet }}>
        {failure ? (
          <>
            <AppText variant="body" accessibilityLiveRegion="polite">{failure.message}</AppText>
            {failure.kind === 'retry' ? <PrimaryButton label="Try again" icon={RefreshCw} loading={looking} onPress={() => look(failure.code)} fullWidth /> : null}
            {failure.kind === 'settings' ? <PrimaryButton label="Open Settings" onPress={() => router.push('/settings')} fullWidth /> : null}
            <SecondaryButton label="Enter the label by hand" onPress={() => manual(failure.code)} fullWidth />
            <SecondaryButton label="Scan another" onPress={() => { setFailure(null); setStatus('Point the camera at a barcode'); busy.current = false; }} fullWidth />
          </>
        ) : (
          <>
            <AppText variant="body" align="center" accessibilityLiveRegion="polite">{status}</AppText>
            <SecondaryButton label="Cancel" onPress={() => router.back()} fullWidth />
          </>
        )}
      </View>
    </View>
  );
}
