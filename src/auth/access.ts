import { redirect, type LoaderFunctionArgs } from 'react-router';
import { queryClient } from '../app/query-client';
import { supabase } from '../lib/supabase';
import { clearAccountDrafts } from '../maps/drafts';
import { useEditorStore } from '../state/editor';
import { safeReturnTo } from './return-to';

export type Access =
  | { kind: 'unconfigured' | 'guest' | 'unavailable' }
  | { kind: 'no-access'; userId: string }
  | { kind: 'member'; userId: string; workspace: { id: string; name: string }; role: 'admin' | 'member' };
export type MemberAccess = Extract<Access, { kind: 'member' }>;

export async function readAccess(): Promise<Access> {
  const client = supabase;
  if (!client) return { kind: 'unconfigured' };
  try {
    const access = await queryClient.fetchQuery<Access>({
      queryKey: ['access'],
      staleTime: 0,
      gcTime: 0,
      retry: false,
      queryFn: async ({ signal }) => {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw new Error('Session unavailable');
        if (!sessionData.session) return { kind: 'guest' };
        // Only the server-confirmed identity is used for membership queries.
        const { data, error } = await client.auth.getUser();
        if (error) {
          if (error.status === 401 || error.status === 403) return { kind: 'guest' };
          throw new Error('Identity unavailable');
        }
        if (!data.user || signal.aborted) throw new Error('Identity changed');
        const userId = data.user.id;
        const membership = await client
          .from('workspace_members')
          .select('workspace_id,role')
          .eq('user_id', userId)
          .eq('status', 'active')
          .limit(2)
          .abortSignal(signal);
        if (membership.error) throw new Error('Membership unavailable');
        if (membership.data.length === 0) return { kind: 'no-access', userId };
        // This installation has one workspace in the UI. Never choose silently.
        if (membership.data.length !== 1) throw new Error('Ambiguous membership');
        const member = membership.data[0];
        // The column is a checked text, so generated types widen it to string.
        const role = member.role;
        if (role !== 'admin' && role !== 'member') throw new Error('Unknown role');
        const workspace = await client
          .from('workspaces')
          .select('id,name')
          .eq('id', member.workspace_id)
          .abortSignal(signal)
          .single();
        if (workspace.error) throw new Error('Workspace unavailable');
        return { kind: 'member', userId, workspace: workspace.data, role };
      },
    });
    if (access.kind === 'no-access') {
      useEditorStore.getState().revoke();
      await useEditorStore.getState().flushLocal();
      await clearAccountDrafts(access.userId).catch(() => {});
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'access' });
    }
    return access;
  } catch {
    return { kind: 'unavailable' };
  }
}

export async function requireMember({ request }: LoaderFunctionArgs): Promise<MemberAccess> {
  const access = await readAccess();
  if (access.kind === 'unavailable') throw new Response(null, { status: 503 });
  if (access.kind === 'guest' || access.kind === 'unconfigured') {
    const url = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(safeReturnTo(url.pathname + url.search))}`);
  }
  if (access.kind !== 'member') throw redirect('/sem-acesso');
  return access;
}

export async function homeLoader() {
  const access = await readAccess();
  return redirect(access.kind === 'member' ? '/mapas' : access.kind === 'no-access' ? '/sem-acesso' : '/login');
}
export async function loginLoader({ request }: LoaderFunctionArgs) {
  const access = await readAccess();
  if (access.kind === 'member') throw redirect(safeReturnTo(new URL(request.url).searchParams.get('next')));
  if (access.kind === 'no-access') throw redirect('/sem-acesso');
  return access;
}
export async function noAccessLoader() {
  const access = await readAccess();
  if (access.kind === 'guest' || access.kind === 'unconfigured') throw redirect('/login');
  if (access.kind === 'member') throw redirect('/mapas');
  if (access.kind === 'unavailable') throw new Response(null, { status: 503 });
  return access;
}
