import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { AppText, FoodRow } from '@/components/ds';
import { Trash2 } from '@/components/ds/icons';
import { useTheme } from '@/theme/ThemeProvider';
import { createOpenRowTracker, type OpenRowTracker } from './openRow';

const SwipeContext = createContext<OpenRowTracker<SwipeableMethods> | null>(null);

/**
 * One open swipe at a time for a screen: opening a row closes the previous one, and the screen closes it when a scroll
 * starts. Wrap a screen's diary list in this and call `closeOpen` from its ScrollView's onScrollBeginDrag.
 */
export function SwipeGroup({ children }: { children: (closeOpen: () => void) => ReactNode }) {
  const [tracker] = useState(() => createOpenRowTracker<SwipeableMethods>((m) => m.close()));
  const closeOpen = useCallback(() => { tracker.closeOpen(); }, [tracker]);
  return <SwipeContext.Provider value={tracker}>{children(closeOpen)}</SwipeContext.Provider>;
}

const DELETE_WIDTH = 96;

/**
 * A logged diary food: tap to edit; swipe left to reveal Delete (never deletes by itself). The row looks exactly like
 * any other food row until swiped. Screen readers get a "Delete" action on the row, and Delete is also in the editor.
 * Reduced motion: Reanimated follows the system setting, so the reveal/close animations are skipped when it's on.
 */
export function SwipeableDiaryRow({ name, detail, calories, badge, onPress, onDelete, accessibilityHint }: {
  name: string;
  badge?: ReactNode;
  detail?: string;
  calories: number;
  onPress: () => void;
  onDelete: () => void;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  const group = useContext(SwipeContext);
  const methods = useRef<SwipeableMethods | null>(null);

  // A tap while some row is swiped open just closes it (it doesn't also open the editor).
  const press = useCallback(() => {
    if (group?.closeOpen()) return;
    onPress();
  }, [group, onPress]);

  const remove = useCallback(() => {
    methods.current?.close();
    group?.forget(methods.current);
    onDelete();
  }, [group, onDelete]);

  const actions = useMemo(() => [{ name: 'delete', label: 'Delete' }], []);

  return (
    <ReanimatedSwipeable
      ref={methods}
      friction={1.5}
      rightThreshold={DELETE_WIDTH / 2}
      overshootRight={false}
      dragOffsetFromRight={16}
      onSwipeableWillOpen={() => methods.current && group?.opened(methods.current)}
      onSwipeableClose={() => group?.forget(methods.current)}
      renderRightActions={() => (
        <View style={{ width: DELETE_WIDTH, paddingLeft: t.space.sm, justifyContent: 'center' }}>
          <Pressable onPress={remove} accessibilityRole="button" accessibilityLabel={`Delete ${name}`}
            style={({ pressed }) => ({ flex: 1, minHeight: t.sizes.touch, borderRadius: t.radii.sm, alignItems: 'center', justifyContent: 'center', gap: 2,
              backgroundColor: pressed ? t.colors.errorText : t.colors.error })}>
            <Trash2 size={20} color={t.colors.textOnPrimary} />
            <AppText variant="label" style={{ color: t.colors.textOnPrimary }}>Delete</AppText>
          </Pressable>
        </View>
      )}
    >
      <FoodRow name={name} detail={detail} calories={calories} badge={badge} onPress={press} accessibilityHint={accessibilityHint}
        accessibilityActions={actions} onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'delete') onDelete(); }} />
    </ReanimatedSwipeable>
  );
}
