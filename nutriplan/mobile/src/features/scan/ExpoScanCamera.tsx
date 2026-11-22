import { StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';
import type { ScanCameraProps } from './ScanCamera.types';

/** Zoom is a share of the phone's own maximum, so the same value is a different magnification on each phone. */
const ZOOMED = 0.2;

/**
 * The expo-camera scanner: the whole native scanner, and on web the fallback for browsers without BarcodeDetector (expo-camera
 * loads its own decoder there). Props are exactly what the screen passed to CameraView before this was split out.
 */
export function ExpoScanCamera({ torch, zoomed, onScanned, onError, enableTorch = torch }: ScanCameraProps & { enableTorch?: boolean }) {
  return (
    <CameraView style={StyleSheet.absoluteFill} facing="back" enableTorch={enableTorch} zoom={zoomed ? ZOOMED : 0}
      barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }} onBarcodeScanned={({ data }) => onScanned(data)}
      onMountError={(e) => onError(e?.message || 'Try again, or type the barcode instead.')} />
  );
}
