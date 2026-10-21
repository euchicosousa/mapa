import type { LoaderFunctionArgs } from 'react-router';
import { requireMember, noAccessLoader } from './access';
import { invitationSchema, pendingInvitationSchema } from './invitations';
import { queryClient } from '../app/query-client';
import { supabase } from '../lib/supabase';

export async function teamLoader(args: LoaderFunctionArgs) {
  const access = await requireMember(args);
  const members = await queryClient.fetchQuery({
    queryKey: ['team', access.userId, access.workspace.id],
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!supabase) throw new Error('Not configured');
      const roster = await supabase
        .from('workspace_members')
        .select('user_id,role,status')
        .eq('workspace_id', access.workspace.id)
        .abortSignal(signal);
      if (roster.error) throw new Response(null, { status: 503 });
      const profiles = await supabase
        .from('profiles')
        .select('id,display_name')
        .in(
          'id',
          roster.data.map((member) => member.user_id),
        )
        .abortSignal(signal);
      if (profiles.error) throw new Response(null, { status: 503 });
      return roster.data
        .map((member) => ({
          ...member,
          name: profiles.data.find((profile) => profile.id === member.user_id)?.display_name ?? 'Membro da equipe',
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    },
  });
  let invitations: ReturnType<typeof invitationSchema.parse>[] = [];
  if (access.role === 'admin') {
    const result = await supabase!
      .from('workspace_invitations')
      .select('id,email,status,expires_at,last_attempt_at,delivery_state')
      .eq('workspace_id', access.workspace.id)
      .order('created_at', { ascending: false });
    if (result.error) throw new Response(null, { status: 503 });
    invitations = invitationSchema.array().parse(result.data);
  }
  return { access, members, invitations };
}

export async function pendingInvitationsLoader() {
  const access = await noAccessLoader();
  if (access instanceof Response) return access;
  const result = await supabase!.rpc('pending_workspace_invitations');
  if (result.error) throw new Response(null, { status: 503 });
  return { access, invitations: pendingInvitationSchema.array().parse(result.data) };
}
