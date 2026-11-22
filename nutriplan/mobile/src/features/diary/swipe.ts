/**
 * Swipe decisions for a diary row (pure, so they're tested without a renderer). The row only takes a touch once it moves
 * clearly sideways, so taps and vertical scrolling are never captured, and letting go either leaves Delete revealed or
 * closes the row: a swipe never deletes by itself.
 */
export const DELETE_WIDTH = 96;
/** How far (px) a drag has to go to leave the row open. */
export const OPEN_AT = DELETE_WIDTH * 0.4;
/** How fast (px/ms) a flick has to be to open or close regardless of distance. */
export const FLICK = 0.5;

/** Whether a move should take the touch from taps and scrolling: more than 10 px, and mostly sideways. */
export const claimsSwipe = (dx: number, dy: number) => Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5;

/** Where the row goes while dragging: never right of closed, never further left than the Delete button. */
export const dragPosition = (from: number, dx: number) => Math.min(0, Math.max(-DELETE_WIDTH, from + dx));

/** Where the row settles when let go ('open' = Delete revealed). There is no 'delete': only the button deletes. */
export function settle(from: number, dx: number, vx: number): 'open' | 'closed' {
  if (vx < -FLICK) return 'open';
  if (vx > FLICK) return 'closed';
  return from + dx < -OPEN_AT ? 'open' : 'closed';
}
