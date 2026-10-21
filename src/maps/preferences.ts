import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { MapError, toMapError } from './api';

export const viewportSchema = z
  .object({ x: z.number().min(-1e9).max(1e9), y: z.number().min(-1e9).max(1e9), zoom: z.number().min(0.001).max(2) })
  .strict();
export const viewSchema = z.object({ viewport: viewportSchema, collapsedIds: z.array(z.uuid()).max(500) });
export type ViewPreferences = z.infer<typeof viewSchema>;
export type Viewport = ViewPreferences['viewport'];
export async function readView(userId: string, mapId: string, signal: AbortSignal): Promise<ViewPreferences | null> {
  if (!supabase) throw new MapError('UNAVAILABLE');
  const { data, error } = await supabase
    .from('map_user_preferences')
    .select('viewport,collapsed_node_ids')
    .eq('map_id', mapId)
    .eq('user_id', userId)
    .abortSignal(signal)
    .maybeSingle();
  if (error) throw toMapError(error);
  return data ? viewSchema.parse({ viewport: data.viewport, collapsedIds: data.collapsed_node_ids }) : null;
}
export async function writeView(userId: string, mapId: string, view: ViewPreferences): Promise<void> {
  if (!supabase) throw new MapError('UNAVAILABLE');
  const valid = viewSchema.parse(view);
  const { error } = await supabase
    .from('map_user_preferences')
    .upsert(
      { map_id: mapId, user_id: userId, viewport: valid.viewport, collapsed_node_ids: valid.collapsedIds },
      { onConflict: 'map_id,user_id' },
    )
    .abortSignal(AbortSignal.timeout(20_000));
  if (error) throw toMapError(error);
}
