/**
 * Keeps track of the one swiped-open row on a screen (pure, so it can be tested without a renderer).
 * `opened` closes whichever row was open before; `closeOpen` closes the open row and says whether there was one.
 */
export type OpenRowTracker<T> = {
  opened: (row: T) => void;
  forget: (row: T | null) => void;
  closeOpen: () => boolean;
  current: () => T | null;
};

export function createOpenRowTracker<T>(close: (row: T) => void): OpenRowTracker<T> {
  let open: T | null = null;
  return {
    opened(row) {
      if (open && open !== row) close(open);
      open = row;
    },
    forget(row) {
      if (row && open === row) open = null;
    },
    closeOpen() {
      if (!open) return false;
      const row = open;
      open = null;
      close(row);
      return true;
    },
    current: () => open,
  };
}
