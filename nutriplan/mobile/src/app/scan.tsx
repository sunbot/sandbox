import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { lookupBarcode } from '@/api/hooks';
import { Button } from '@/components/ui';
import { font, spacing } from '@/lib/theme';

/** Point at a barcode: looks it up locally first, then Open Food Facts; unknown codes go to "add from label". */
export default function ScanScreen() {
  const params = useLocalSearchParams<{ date?: string; meal?: string; mode?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<string>('Point the camera at a barcode');
  const busy = useRef(false);

  if (!permission) return <View style={styles.center} />;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={[font.body, { textAlign: 'center', marginBottom: spacing.md }]}>Camera access is needed to scan barcodes.</Text>
        <Button title="Allow camera" onPress={requestPermission} />
      </View>
    );
  }

  const onScanned = async ({ data }: BarcodeScanningResult) => {
    if (busy.current) return;
    busy.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStatus(`Looking up ${data}…`);
    try {
      const food = await lookupBarcode(data);
      router.replace({ pathname: '/food/[id]', params: { ...params, id: food.id } });
    } catch {
      setStatus(`${data} isn't in any database yet.`);
      router.replace({ pathname: '/custom-food', params: { ...params, barcode: data } });
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={onScanned}
      />
      <View style={styles.frame} pointerEvents="none" />
      <View style={styles.footer}>
        <Text style={styles.status}>{status}</Text>
        <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  frame: { position: 'absolute', top: '35%', left: '10%', right: '10%', height: 160, borderWidth: 3, borderColor: '#fff', borderRadius: 16 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: spacing.xl, gap: spacing.md, backgroundColor: 'rgba(0,0,0,0.55)' },
  status: { color: '#fff', textAlign: 'center', fontSize: 15 },
});

