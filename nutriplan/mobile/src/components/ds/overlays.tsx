import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from '@/components/ds/icons';
import { useReducedMotion, useStyles, useTheme } from '@/theme/ThemeProvider';
import type { Theme } from '@/theme/tokens';
import { AppText, IconButton, PrimaryButton, SecondaryButton } from './primitives';
import { steadyHeightFor } from './steadyHeight';

/* ───────────────────────── Bottom sheet ───────────────────────── */

/**
 * Modal bottom sheet for short selections and confirmations.
 * Closing (back button, backdrop, X) never discards state: callers keep their draft and can reopen.
 *
 * `steadyKey`: the sheet keeps the height it first laid out at for this key, so content that grows (an opened measure list)
 * scrolls inside the sheet's scroll view instead of pushing the sheet's top and header up. Change the key when the content is
 * genuinely different (another entry, or its data finished loading) to measure again. The height still gives way to the keyboard.
 */
export function BottomSheet({ visible, onClose, title, children, footer, steadyKey }: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  steadyKey?: string;
}) {
  const t = useTheme();
  const s = useStyles(sheetStyles);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const anim = useState(() => new Animated.Value(0))[0];
  if (visible && !mounted) setMounted(true); // mount before animating in
  const [steady, setSteady] = useState<{ key: string; height: number } | null>(null);
  if (!mounted && steady) setSteady(null); // measured afresh each time the sheet opens
  const steadyHeight = steadyKey != null ? steadyHeightFor(steady, steadyKey) : undefined;

  useEffect(() => {
    const done = () => { if (!visible) setMounted(false); };
    if (reduced) { anim.setValue(visible ? 1 : 0); done(); return; }
    Animated.timing(anim, { toValue: visible ? 1 : 0, duration: visible ? t.motion.slow : t.motion.fast, useNativeDriver: true }).start(done);
  }, [visible, reduced, anim, t.motion.slow, t.motion.fast]);

  if (!mounted) return null;
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [400, 0] });

  return (
    <Modal transparent visible={mounted} onRequestClose={onClose} animationType="none" statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.scrim, opacity: anim }]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        </Animated.View>
        {/* Edge-to-edge Android doesn't resize the window for the keyboard, so pad on both platforms. */}
        <KeyboardAvoidingView behavior={Platform.OS === 'web' ? undefined : 'padding'} style={{ maxHeight: '90%' }}>
          <Animated.View testID="bottom-sheet"
            onLayout={steadyKey != null && steadyHeight === undefined ? (e) => setSteady({ key: steadyKey, height: e.nativeEvent.layout.height }) : undefined}
            style={[s.sheet, steadyHeight !== undefined && { height: steadyHeight }, { paddingBottom: Math.max(insets.bottom, t.space.lg), transform: [{ translateY }] }]} accessibilityViewIsModal>
            <View style={s.handle} />
            {title ? (
              <View style={s.header}>
                <AppText variant="cardTitle" style={{ flex: 1 }} numberOfLines={2} accessibilityRole="header">{title}</AppText>
                <IconButton icon={X} label="Close" onPress={onClose} />
              </View>
            ) : null}
            {/* Content shrinks to fit (scroll views inside scroll) so nothing spills past the sheet. */}
            <View style={{ paddingHorizontal: t.screenPadding, flexShrink: 1 }}>{children}</View>
            {footer ? <View style={{ paddingHorizontal: t.screenPadding, paddingTop: t.space.lg, gap: t.space.sm }}>{footer}</View> : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const sheetStyles = (t: Theme) =>
  StyleSheet.create({
    sheet: { backgroundColor: t.colors.surfaceRaised, borderTopLeftRadius: t.radii.sheet, borderTopRightRadius: t.radii.sheet, maxHeight: '100%', paddingTop: t.space.sm, overflow: 'hidden' },
    handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: t.colors.borderStrong, marginBottom: t.space.sm },
    header: { flexDirection: 'row', alignItems: 'center', paddingLeft: t.screenPadding, paddingRight: t.space.sm, marginBottom: t.space.sm },
  });

/** Yes/no in a sheet. Use sparingly: prefer Undo for reversible actions. */
export function ConfirmationSheet({ visible, title, message, confirmLabel, destructive, onConfirm, onCancel, loading }: {
  visible: boolean; title: string; message?: string; confirmLabel: string; destructive?: boolean; onConfirm: () => void; onCancel: () => void; loading?: boolean;
}) {
  return (
    <BottomSheet visible={visible} onClose={onCancel} title={title}
      footer={<>
        {destructive
          ? <SecondaryButton label={confirmLabel} tone="danger" onPress={onConfirm} loading={loading} fullWidth />
          : <PrimaryButton label={confirmLabel} onPress={onConfirm} loading={loading} fullWidth />}
        <SecondaryButton label="Cancel" onPress={onCancel} fullWidth />
      </>}>
      {message ? <AppText variant="body" tone="secondary">{message}</AppText> : null}
    </BottomSheet>
  );
}

/* ───────────────────────── Snackbar with Undo ───────────────────────── */

type SnackOptions = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Runs when the snackbar times out or is replaced without the action being pressed (e.g. commit a deferred delete). */
  onTimeout?: () => void;
  durationMs?: number;
};

const SnackbarContext = createContext<(o: SnackOptions) => void>(() => undefined);
export const useSnackbar = () => useContext(SnackbarContext);

/** Hosts one snackbar at a time, above the tab bar. Timers live here, so pending commits survive navigation. */
export function SnackbarProvider({ children, bottomOffset = 72 }: { children: ReactNode; bottomOffset?: number }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [snack, setSnack] = useState<(SnackOptions & { key: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef<(SnackOptions & { key: number }) | null>(null);
  const anim = useState(() => new Animated.Value(0))[0];

  const settle = useCallback((acted: boolean) => {
    const s = current.current;
    if (!s) return;
    current.current = null;
    if (timer.current) clearTimeout(timer.current);
    if (acted) s.onAction?.(); else s.onTimeout?.();
    if (reduced) { anim.setValue(0); setSnack(null); return; }
    Animated.timing(anim, { toValue: 0, duration: t.motion.fast, useNativeDriver: true }).start(() => setSnack((x) => (x?.key === s.key ? null : x)));
  }, [anim, reduced, t.motion.fast]);

  const show = useCallback((o: SnackOptions) => {
    settle(false); // a new message commits the previous one
    const next = { ...o, key: Date.now() };
    current.current = next;
    setSnack(next);
    AccessibilityInfo.announceForAccessibility?.(o.message);
    if (reduced) anim.setValue(1);
    else Animated.timing(anim, { toValue: 1, duration: t.motion.base, useNativeDriver: true }).start();
    timer.current = setTimeout(() => settle(false), o.durationMs ?? 5000);
  }, [anim, reduced, settle, t.motion.base]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); current.current?.onTimeout?.(); }, []);

  return (
    <SnackbarContext.Provider value={show}>
      {children}
      {snack ? (
        <Animated.View pointerEvents="box-none" accessibilityLiveRegion="polite"
          style={{ position: 'absolute', left: t.space.lg, right: t.space.lg, bottom: bottomOffset + insets.bottom, opacity: anim,
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
          <View style={{ backgroundColor: t.colors.snackbar, borderRadius: t.radii.button, minHeight: 52, paddingLeft: t.space.lg, paddingRight: t.space.xs, flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
            <AppText variant="secondary" style={{ color: t.colors.snackbarText, flex: 1, paddingVertical: t.space.sm }} numberOfLines={2}>{snack.message}</AppText>
            {snack.actionLabel ? (
              <Pressable onPress={() => settle(true)} accessibilityRole="button" accessibilityLabel={snack.actionLabel}
                style={{ minHeight: t.sizes.touch, minWidth: t.sizes.touch, paddingHorizontal: t.space.md, alignItems: 'center', justifyContent: 'center' }}>
                <AppText variant="bodyStrong" style={{ color: t.colors.snackbarAction }}>{snack.actionLabel}</AppText>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </SnackbarContext.Provider>
  );
}
