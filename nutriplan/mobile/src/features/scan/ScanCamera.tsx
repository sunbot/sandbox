import { ExpoScanCamera } from './ExpoScanCamera';
import type { ScanCameraProps } from './ScanCamera.types';

/** Android and iOS: the expo-camera scanner, unchanged. (Web has its own: ScanCamera.web.tsx.) */
export function ScanCamera(props: ScanCameraProps) {
  return <ExpoScanCamera {...props} />;
}
