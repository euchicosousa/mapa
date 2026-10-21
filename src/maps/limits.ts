// Domain limits shared with the database functions and the Edge Functions.
// supabase/functions/_shared/limits.ts mirrors these values (Deno cannot import
// from src/), and limits.test.ts fails if the client, the mirror or the SQL drift.
export const MAP_NODES_MAX = 500;
export const MAP_DEPTH_MAX = 30;
export const NODE_TEXT_MAX = 500;
export const MAP_TITLE_MAX = 120;
// Project name, client name and library search share this bound.
export const ENTITY_NAME_MAX = 120;
export const AI_CHILDREN_COUNT = 4;
export const AI_CHILD_TEXT_MAX = 120;
export const AI_GUIDANCE_MAX = 1000;
