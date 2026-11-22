/** What the camera in use can do; the screen shows the zoom and torch buttons only for what's supported. */
export type ScanSupport = { zoom: boolean; torch: boolean };

export type ScanCameraProps = {
  torch: boolean;
  zoomed: boolean;
  /** A barcode's digits as the camera read them (looked up, gated and de-duplicated by the screen). */
  onScanned: (code: string) => void;
  /** The camera couldn't start or stopped: the screen offers typing the barcode instead. */
  onError: (message: string) => void;
  onSupport?: (support: ScanSupport) => void;
};
