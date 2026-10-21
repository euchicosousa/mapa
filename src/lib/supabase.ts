import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
const config = __PUBLIC_CONFIG__;
export const supabase = config.status === 'ready' ? createClient<Database>(config.url, config.publishableKey, {
  auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'mapa.auth.v1' },
}) : null;
