import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { claimsSwipe, DELETE_WIDTH, dragPosition, OPEN_AT, settle } from './swipe.ts';

test('a row only takes the touch for a clearly sideways move, so taps and vertical scrolling are never captured', () => {
  assert.equal(claimsSwipe(0, 0), false);          // a tap
  assert.equal(claimsSwipe(8, 0), false);          // a tiny slide (finger wobble on a tap)
  assert.equal(claimsSwipe(-30, 0), true);         // a swipe
  assert.equal(claimsSwipe(-15, -60), false);      // scrolling
  assert.equal(claimsSwipe(-24, -40), false);      // mostly vertical diagonal
  assert.equal(claimsSwipe(-40, -20), true);       // mostly sideways
});

test('dragging never moves the row right of closed or past the Delete button', () => {
  assert.equal(dragPosition(0, 50), 0);
  assert.equal(dragPosition(0, -40), -40);
  assert.equal(dragPosition(0, -500), -DELETE_WIDTH);
  assert.equal(dragPosition(-DELETE_WIDTH, 30), -DELETE_WIDTH + 30);
});

test('letting go reveals Delete or closes: a swipe never deletes by itself', () => {
  assert.equal(settle(0, -(OPEN_AT + 5), 0), 'open');
  assert.equal(settle(0, -(OPEN_AT - 5), 0), 'closed');  // a short drag snaps back
  assert.equal(settle(0, -20, -0.8), 'open');            // a quick flick
  assert.equal(settle(-DELETE_WIDTH, 60, 0), 'closed');  // dragged back
  assert.equal(settle(-DELETE_WIDTH, 10, 0.9), 'closed'); // flicked back
  for (const dx of [-500, -96, -60, 0, 60]) for (const vx of [-3, 0, 3]) assert.ok(['open', 'closed'].includes(settle(0, dx, vx)));
});

/**
 * Guard for an Android-only bug no test runner here can reproduce: inside react-native-gesture-handler's swipe component
 * (ReanimatedSwipeable), taps on the row and on the revealed Delete button never arrived on an Android phone, so logged foods
 * couldn't be edited or deleted (fixed by PanResponder + React Native's Pressable). Changing this back needs a device check.
 */
test('the diary row keeps to React Native touch handling (gesture-handler swipe broke taps on Android)', () => {
  const row = readFileSync(new URL('./SwipeableDiaryRow.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(row, /from 'react-native-gesture-handler/, 'SwipeableDiaryRow must not use gesture-handler (taps were lost on Android)');
  assert.match(row, /import \{[^}]*\bPanResponder\b[^}]*\bPressable\b[^}]*\} from 'react-native'/);
  assert.doesNotMatch(row, /onSwipeableOpen|onSwipeableWillOpen/, 'a swipe must not delete by itself');
  // Delete happens only from the Delete button (remove) and the screen-reader action, never from a gesture callback.
  const calls = row.match(/onDelete\(\)/g) ?? [];
  assert.equal(calls.length, 2, 'onDelete() should be called only by the Delete button and the accessibility action');
  const foodRow = readFileSync(new URL('../../components/ds/data.tsx', import.meta.url), 'utf8');
  assert.match(foodRow, /import \{[^}]*\bPressable\b[^}]*\} from 'react-native';/, 'FoodRow taps use React Native\'s Pressable');
});
