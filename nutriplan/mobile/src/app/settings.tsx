import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, post } from '@/api/client';
import type { Account, Invitation } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, Field } from '@/components/ui';
import { loadSettings, saveSettings } from '@/lib/settings';
import { colors, font, spacing } from '@/lib/theme';
import { useSnackbar } from '@/components/ds';
import { LogOut, Trash2, UserPlus } from '@/components/ds/icons';

/** Your account, where Intake Grid finds its server, and (for the owner) who may use it. */
export default function SettingsScreen() {
  const snackbar = useSnackbar(); // alerts don't show on web; the snackbar works everywhere
  const { state, signOut } = useAuth();
  const account = state.status === 'active' ? state.account : null;
  const [apiUrl, setApiUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    loadSettings().then((s) => setApiUrl(s.apiUrl));
  }, []);

  const save = async () => {
    await saveSettings({ apiUrl });
    setTesting(true);
    try {
      const status = await get<{ languageModel: boolean; foods: number }>('/status');
      snackbar({ message: `Connected · ${status.foods.toLocaleString()} foods · AI assistant ${status.languageModel ? 'on' : 'off'}` });
      qc.invalidateQueries();
    } catch (e) {
      snackbar({ message: `Saved, but couldn't connect: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: spacing.md }}>
        <Text style={font.heading}>Account</Text>
        {account ? (
          <Text style={font.body}>
            {account.displayName}{account.email ? ` · ${account.email}` : ''}{account.role === 'Owner' ? ' · Owner' : ''}
          </Text>
        ) : null}
        <Button title="Sign out" variant="secondary" icon={LogOut} onPress={() => void signOut()} />
      </Card>
      {account?.role === 'Owner' ? <People me={account} /> : null}
      <Card style={{ gap: spacing.md }}>
        <Field label="Server URL" value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" keyboardType="url" placeholder="http://192.168.1.20:5154" />
        <Button title="Save & test" onPress={save} loading={testing} />
      </Card>
      <Text style={font.small}>
        Android emulator: http://10.0.2.2:5154 · Phone on the same Wi-Fi: http://&lt;your PC’s IP&gt;:5154 · Hosted: your https URL.
      </Text>
    </ScrollView>
  );
}

/** Owner only: invite a Google account by email, withdraw invitations, and turn people's access off or back on. */
function People({ me }: { me: Account }) {
  const snackbar = useSnackbar();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const invitations = useQuery({ queryKey: ['account', 'invitations'], queryFn: () => get<Invitation[]>('/account/invitations') });
  const users = useQuery({ queryKey: ['account', 'users'], queryFn: () => get<Account[]>('/account/users') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['account'] });
  const onError = (e: unknown) => snackbar({ message: e instanceof Error ? e.message : String(e) });

  const invite = useMutation({
    mutationFn: () => post<Invitation>('/account/invitations', { email }),
    onSuccess: () => { setEmail(''); refresh(); snackbar({ message: 'Invited. They can now sign in with that Google account (for 14 days).' }); },
    onError,
  });
  const revoke = useMutation({ mutationFn: (id: string) => del(`/account/invitations/${id}`), onSuccess: refresh, onError });
  const setActive = useMutation({
    mutationFn: (u: { id: string; active: boolean }) => post<Account>(`/account/users/${u.id}/active`, { active: u.active }),
    onSuccess: refresh,
    onError,
  });

  const open = (invitations.data ?? []).filter((i) => !i.accepted && !i.revoked && new Date(i.expiresAt) > new Date());
  return (
    <Card style={{ gap: spacing.md }}>
      <Text style={font.heading}>People</Text>
      <Text style={font.small}>Only people you invite can sign in. Each person’s diary, plans, recipes and pantry are private to them.</Text>
      <Field label="Invite a Google account (email)" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="off" />
      <Button title="Send invitation" icon={UserPlus} onPress={() => invite.mutate()} loading={invite.isPending} disabled={!email.includes('@')} />
      {open.length ? <Text style={font.small}>Open invitations</Text> : null}
      {open.map((i) => (
        <View key={i.id} style={styles.row}>
          <Text style={[font.body, { flex: 1 }]}>Expires {new Date(i.expiresAt).toLocaleDateString()}</Text>
          <Button title="Withdraw" variant="secondary" compact icon={Trash2} onPress={() => revoke.mutate(i.id)} />
        </View>
      ))}
      {(users.data ?? []).filter((u) => u.id !== me.id).length ? <Text style={font.small}>Members</Text> : null}
      {(users.data ?? []).filter((u) => u.id !== me.id).map((u) => (
        <View key={u.id} style={styles.row}>
          <Text style={[font.body, { flex: 1, color: u.isActive ? colors.text : colors.textMuted }]}>
            {u.displayName}{u.email ? ` · ${u.email}` : ''}{u.isActive ? '' : ' · Access off'}
          </Text>
          <Button title={u.isActive ? 'Turn off' : 'Turn on'} variant="secondary" compact onPress={() => setActive.mutate({ id: u.id, active: !u.isActive })} />
        </View>
      ))}
      {invitations.error || users.error ? <Text style={[font.small, { color: colors.danger }]}>Couldn’t load people. {((invitations.error ?? users.error) as Error).message}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
});
