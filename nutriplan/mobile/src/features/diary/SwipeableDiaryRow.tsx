import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, View } from 'react-native';
import { AppText, FoodRow } from '@/components/ds';
import { Square, SquareCheck, Trash2 } from '@/components/ds/icons';
import { useReducedMotion, useTheme } from '@/theme/ThemeProvider';
import { createOpenRowTracker, type OpenRowTracker } from './openRow';
import { DELETE_WIDTH, claimsSwipe, dragPosition, settle as settleSwipe } from './swipe';

/** What a screen can ask an open row to do. */
type RowHandle = { close: () => void };

const SwipeContext = createContext<OpenRowTracker<RowHandle> | null>(null);

/**
 * One open swipe at a time for a screen: opening a row closes the previous one, and the screen closes it when a scroll
 * starts. Wrap a screen's diary list in this and call `closeOpen` from its ScrollView's onScrollBeginDrag.
 */
export function SwipeGroup({ children }: { children: (closeOpen: () => void) => ReactNode }) {
  const [tracker] = useState(() => createOpenRowTracker<RowHandle>((m) => m.close()));
  const closeOpen = useCallback(() => { tracker.closeOpen(); }, [tracker]);
  return <SwipeContext.Provider value={tracker}>{children(closeOpen)}</SwipeContext.Provider>;
}


/**
 * A logged diary food: tap to edit; swipe left to reveal Delete (never deletes by itself), then tap Delete. The row looks
 * exactly like any other food row until swiped. Screen readers get a "Delete" action on the row, and Delete is also in the editor.
 * Reduced motion: the row jumps instead of sliding.
 *
 * Built on React Native's own touch system (PanResponder + Pressable) rather than a gesture-handler swipe component: inside
 * that component, taps on the row and on the revealed Delete button never arrived on Android, so neither editing nor deleting
 * worked. Here a tap is an ordinary press, and the row only claims a touch once it moves clearly sideways, so vertical
 * scrolling and taps are untouched.
 */
export function SwipeableDiaryRow({ name, detail, calories, badge, onPress, onDelete, accessibilityHint, selectionMode = false, selected = false, onToggleSelect }: {
  name: string;
  badge?: ReactNode;
  detail?: string;
  calories: number;
  onPress: () => void;
  onDelete: () => void;
  accessibilityHint?: string;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const group = useContext(SwipeContext);
  const x = useState(() => new Animated.Value(0))[0];
  const drag = useState(() => ({ from: 0 }))[0]; // where the row was when this touch began
  const [revealed, setRevealed] = useState(false);

  const slideTo = useCallback((to: number) => {
    if (reduced) { x.setValue(to); return; }
    Animated.timing(x, { toValue: to, duration: 160, useNativeDriver: true }).start();
  }, [reduced, x]);

  // What the screen's tracker holds for this row: closing just slides this row's panel shut.
  const closeCore = useCallback(() => { setRevealed(false); slideTo(0); }, [slideTo]);
  const handle = useMemo<RowHandle>(() => ({ close: closeCore }), [closeCore]);
  const close = useCallback(() => { closeCore(); group?.forget(handle); }, [closeCore, group, handle]);
  const open = useCallback(() => {
    setRevealed(true);
    slideTo(-DELETE_WIDTH);
    group?.opened(handle);
  }, [group, slideTo, handle]);
  // A row that goes away while open (deleted, meal collapsed, day changed) must not keep swallowing the next tap.
  useEffect(() => () => { group?.forget(handle); }, [group, handle]);

  const settle = useCallback((dx: number, vx: number) => {
    if (settleSwipe(drag.from, dx, vx) === 'open') open(); else close();
  }, [open, close, drag]);

  const pan = useMemo(() => PanResponder.create({
    // Only a clearly sideways drag takes the touch; a tap or a vertical scroll never does.
    onMoveShouldSetPanResponder: (_, g) => claimsSwipe(g.dx, g.dy),
    onPanResponderGrant: () => { x.stopAnimation((v) => { drag.from = v; }); },
    onPanResponderMove: (_, g) => { x.setValue(dragPosition(drag.from, g.dx)); },
    onPanResponderRelease: (_, g) => settle(g.dx, g.vx),
    onPanResponderTerminate: (_, g) => settle(g.dx, g.vx),
    // Once swiping, a scroll view shouldn't take the touch away.
    onPanResponderTerminationRequest: () => false,
  }), [x, drag, settle]);

  // A tap while some row is swiped open just closes it (it doesn't also open the editor).
  const press = useCallback(() => {
    if (selectionMode) { onToggleSelect?.(); return; }
    if (group?.closeOpen()) return;
    onPress();
  }, [group, onPress, onToggleSelect, selectionMode]);

  const remove = useCallback(() => {
    close();
    onDelete();
  }, [close, onDelete]);

  const actions = useMemo(() => [{ name: 'delete', label: 'Delete' }], []);

  return (
    <View style={{ overflow: 'hidden' }}>
      {/* Under the row; the row covers it until swiped. Hidden from screen readers while covered (they have the Delete action). */}
      {!selectionMode ? <View importantForAccessibility={revealed ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!revealed}
        style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: DELETE_WIDTH, paddingLeft: t.space.sm, justifyContent: 'center' }}>
        <Pressable onPress={remove} accessibilityRole="button" accessibilityLabel={`Delete ${name}`}
          style={({ pressed }) => ({ flex: 1, minHeight: t.sizes.touch, borderRadius: t.radii.sm, alignItems: 'center', justifyContent: 'center', gap: 2,
            backgroundColor: pressed ? t.colors.errorText : t.colors.error })}>
          <Trash2 size={20} color={t.colors.textOnPrimary} />
          <AppText variant="label" style={{ color: t.colors.textOnPrimary }}>Delete</AppText>
        </Pressable>
      </View> : null}
      <Animated.View {...(selectionMode ? {} : pan.panHandlers)} style={{ transform: [{ translateX: x }], backgroundColor: t.colors.surface }}>
        <FoodRow name={name} detail={detail} calories={calories} badge={badge} onPress={press}
          accessibilityActions={selectionMode ? undefined : actions} onAccessibilityAction={selectionMode ? undefined : (e) => { if (e.nativeEvent.actionName === 'delete') onDelete(); }}
          accessibilityRole={selectionMode ? 'checkbox' : 'button'} accessibilityState={selectionMode ? { checked: selected } : undefined}
          accessibilityHint={selectionMode ? 'Selects this diary entry to move it to another meal' : accessibilityHint}
          trailing={selectionMode ? (selected ? <SquareCheck size={20} color={t.colors.primary} /> : <Square size={20} color={t.colors.textSecondary} />) : undefined} />
      </Animated.View>
    </View>
  );
}
