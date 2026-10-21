import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as client from './limits';
import * as edge from '../../supabase/functions/_shared/limits.ts';

// All migrations in order: a later migration that redefines a function wins.
const directory = 'supabase/migrations';
const sql = readdirSync(directory)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(`${directory}/${file}`, 'utf8'))
  .join('\n');

// The last match of each anchor is the value the database enforces today.
function lastNumber(pattern: RegExp) {
  const matches = [...sql.matchAll(new RegExp(pattern.source, 'gi'))];
  expect(matches.length, `trecho ausente nas migrações: ${pattern.source}`).toBeGreaterThan(0);
  return Number(matches.at(-1)![1]);
}

describe('domain limits', () => {
  it('Edge Function mirror matches the client', () => {
    for (const [name, value] of Object.entries(edge))
      expect([name, client[name as keyof typeof client]]).toEqual([name, value]);
  });

  it('client matches the SQL functions and constraints', () => {
    expect(lastNumber(/max_nodes constant integer := (\d+)/)).toBe(client.MAP_NODES_MAX);
    expect(lastNumber(/max_depth constant integer := (\d+)/)).toBe(client.MAP_DEPTH_MAX);
    expect(lastNumber(/"char_length"\("text"\) <= (\d+)\)\) AND \("btrim"\("text"\)/)).toBe(client.NODE_TEXT_MAX);
    expect(lastNumber(/"char_length"\("title"\) <= (\d+)\)\) AND \("btrim"\("title"\)/)).toBe(client.MAP_TITLE_MAX);
    expect(lastNumber(/"char_length"\("name"\) <= (\d+)\)\) AND \("btrim"\("name"\)/)).toBe(client.ENTITY_NAME_MAX);
    expect(lastNumber(/char_length\(p_query\)\s*>\s*(\d+)/)).toBe(client.ENTITY_NAME_MAX);
    expect(lastNumber(/jsonb_array_length\(p_children\)\s*<>\s*(\d+)/)).toBe(client.AI_CHILDREN_COUNT);
    expect(lastNumber(/char_length\(v->>'text'\) not between 1 and (\d+)/)).toBe(client.AI_CHILD_TEXT_MAX);
    expect(lastNumber(/char_length\(p_guidance\)\s*>\s*(\d+)/)).toBe(client.AI_GUIDANCE_MAX);
  });
});
