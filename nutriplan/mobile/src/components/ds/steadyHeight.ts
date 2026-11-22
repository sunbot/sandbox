/** A bottom sheet's locked height: the one measured for this key, or undefined while it still has to be measured. */
export const steadyHeightFor = (steady: { key: string; height: number } | null, key: string): number | undefined =>
  steady && steady.key === key && steady.height > 0 ? steady.height : undefined;
