import { useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, PrimaryButton, SecondaryButton, TextButton } from '@/components/ds';
import { CloudOff, LogIn, LogOut, RefreshCw, ShieldAlert } from '@/components/ds/icons';
import { loadSettings, saveSettings } from '@/lib/settings';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from './AuthProvider';

/** Shows the app only to a signed-in, invited, active account; otherwise the matching sign-in or access screen. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  switch (state.status) {
    case 'active': return <>{children}</>;
    case 'loading':
    case 'checking': return <Centered><Spinner label={state.status === 'checking' ? 'Checking your account…' : 'Loading…'} /></Centered>;
    case 'signedOut': return <SignInScreen notice={state.notice} />;
    case 'denied': return <AccessDeniedScreen />;
    case 'unreachable': return <UnreachableScreen message={state.message} />;
    case 'unconfigured': return (
      <Centered>
        <Title icon={ShieldAlert} title="Sign-in isn’t set up" />
        <AppText tone="secondary" align="center">This build doesn’t include the Firebase settings (EXPO_PUBLIC_FIREBASE_*). See docs/AUTH.md.</AppText>
      </Centered>
    );
  }
}

function Centered({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: t.space.xl, paddingTop: insets.top + t.space.xl, gap: t.space.lg, maxWidth: 480, width: '100%', alignSelf: 'center' }}>
      {children}
    </ScrollView>
  );
}

function Spinner({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: t.space.md }} accessibilityLiveRegion="polite">
      <ActivityIndicator color={t.colors.primary} />
      <AppText tone="secondary">{label}</AppText>
    </View>
  );
}

function Title({ icon: Icon, title }: { icon: typeof LogIn; title: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: t.space.md }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.colors.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={26} color={t.colors.primary} />
      </View>
      <AppText variant="pageTitle" align="center" accessibilityRole="header">{title}</AppText>
    </View>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  const t = useTheme();
  if (!text) return null;
  return <AppText accessibilityLiveRegion="polite" style={{ color: t.colors.errorText }} align="center">{text}</AppText>;
}

function SignInScreen({ notice }: { notice?: string }) {
  const t = useTheme();
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try { await signIn(); } catch (e) { setError(e instanceof Error ? e.message : 'Sign-in didn’t work. Try again.'); } finally { setBusy(false); }
  };

  return (
    <Centered>
      <Title icon={LogIn} title="Intake Grid" />
      <AppText tone="secondary" align="center">Sign in with your Google account to see your diary, plans and recipes.</AppText>
      {notice ? <AppText tone="secondary" align="center">{notice}</AppText> : null}
      <PrimaryButton label="Continue with Google" icon={LogIn} onPress={go} loading={busy} disabled={busy} fullWidth />
      <ErrorLine text={error} />
      <AppText variant="caption" tone="muted" align="center">Intake Grid is invite-only. Your data stays private to your account.</AppText>
      {server === null ? (
        <View style={{ alignItems: 'center' }}><TextButton label="Server address" tone="secondary" onPress={() => loadSettings().then((s) => setServer(s.apiUrl))} /></View>
      ) : (
        <View style={{ gap: t.space.sm }}>
          <AppText variant="label" tone="secondary">Server address</AppText>
          <TextInput value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" accessibilityLabel="Server address"
            style={{ minHeight: t.sizes.touch, borderRadius: t.radii.button, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface, color: t.colors.text, paddingHorizontal: t.space.md }} />
          <SecondaryButton label="Save address" onPress={async () => { await saveSettings({ apiUrl: server }); setServer(null); }} />
        </View>
      )}
    </Centered>
  );
}

function AccessDeniedScreen() {
  const t = useTheme();
  const { state, signOut, recheck } = useAuth();
  if (state.status !== 'denied') return null;
  return (
    <Centered>
      <Title icon={ShieldAlert} title={state.reason === 'Revoked' ? 'Access turned off' : 'Not invited yet'} />
      <AppText align="center">{state.message}</AppText>
      {state.email ? <AppText tone="secondary" align="center">Signed in as {state.email}</AppText> : null}
      {state.reason === 'NotInvited' ? (
        <View style={{ gap: t.space.xs, padding: t.space.md, borderRadius: t.radii.card, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface }}>
          <AppText variant="label" tone="secondary">Ask the owner to invite the email on this Google account. Setting up as the owner? Your account ID is:</AppText>
          <AppText selectable variant="secondary" numeric>{state.subject}</AppText>
        </View>
      ) : null}
      <PrimaryButton label="Try again" icon={RefreshCw} onPress={() => void recheck()} fullWidth />
      <SecondaryButton label="Use a different account" icon={LogOut} onPress={() => void signOut()} fullWidth />
    </Centered>
  );
}

function UnreachableScreen({ message }: { message: string }) {
  const { recheck, signOut } = useAuth();
  return (
    <Centered>
      <Title icon={CloudOff} title="Can’t reach the server" />
      <AppText tone="secondary" align="center">{message}</AppText>
      <PrimaryButton label="Try again" icon={RefreshCw} onPress={() => void recheck()} fullWidth />
      <SecondaryButton label="Sign out" icon={LogOut} onPress={() => void signOut()} fullWidth />
    </Centered>
  );
}
