import { AI_GUIDANCE_MAX } from '../_shared/limits.ts';
import { withAllowedOrigins } from '../_shared/cors.ts';
import { generateChildren, ProviderError, type AIContext, type Usage } from './provider.ts';
export type GenerationJob = {
  id: string;
  mapId: string;
  state: string;
  claimed?: boolean;
  context?: AIContext;
  [key: string]: unknown;
};
type Reply<T> = { data: T | null; error: { message: string; details?: string | null } | null };
export type Service = {
  authenticate: (token: string) => Promise<{ id: string } | null>;
  available: (actor: string) => Promise<boolean>;
  reserve: (args: Record<string, unknown>) => Promise<Reply<GenerationJob>>;
  finish: (args: {
    p_generation_id: string;
    p_children: { text: string }[] | null;
    p_usage: Usage | null;
    p_error: string | null;
  }) => Promise<Reply<GenerationJob>>;
};
export type GenerationEvent = {
  generationId: string;
  state: string;
  code?: string;
  latencyMs: number;
  usage?: Usage | null;
};
export function generationLog(event: GenerationEvent) {
  return JSON.stringify({
    event: 'ai_generation',
    generationId: event.generationId,
    state: event.state,
    code: event.code ?? null,
    latencyMs: Math.max(0, Math.round(event.latencyMs)),
    inputTokens: event.usage?.input_tokens ?? null,
    outputTokens: event.usage?.output_tokens ?? null,
    totalTokens: event.usage?.total_tokens ?? null,
  });
}
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const clientErrors = [
  'AI_DISABLED',
  'AI_BUSY',
  'AI_RATE_LIMIT',
  'AI_DAILY_LIMIT',
  'AI_BUDGET_LIMIT',
  'AI_CONFIG_MISSING',
  'AI_CONTEXT_TOO_LONG',
  'NOT_FOUND',
  'VALIDATION',
  'LIMIT_EXCEEDED',
  'CONFLICT',
];
export function createGenerationHandler(deps: {
  service: Service;
  allowedOrigins?: string;
  key?: string;
  model?: string;
  budget?: string;
  background: (task: Promise<unknown>) => void;
  generate?: typeof generateChildren;
  log?: (event: GenerationEvent) => void;
}) {
  const json = (value: unknown, status = 200, retryAfter?: number) =>
    new Response(JSON.stringify(value), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
      },
    });
  return withAllowedOrigins(async (request: Request) => {
    if (request.method !== 'POST') return json({ error: 'VALIDATION' }, 405);
    const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ error: 'UNAUTHENTICATED' }, 401);
    let actor;
    try {
      actor = await deps.service.authenticate(token);
    } catch {
      return json({ error: 'AI_UNAVAILABLE' }, 503);
    }
    if (!actor) return json({ error: 'UNAUTHENTICATED' }, 401);
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 6000) return json({ error: 'VALIDATION' }, 400);
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'VALIDATION' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'VALIDATION' }, 400);
    const budget = Number(deps.budget),
      configured = !!deps.key && !!deps.model && Number.isSafeInteger(budget) && budget >= 17000;
    if (body.action === 'availability') {
      if (!configured) return json({ enabled: false, error: 'AI_CONFIG_MISSING' });
      try {
        const enabled = await deps.service.available(actor.id);
        return json({ enabled, error: enabled ? null : 'AI_DISABLED' });
      } catch {
        return json({ enabled: false, error: 'AI_UNAVAILABLE' });
      }
    }
    if (
      Object.keys(body).some(
        (name) => !['mapId', 'parentNodeId', 'generationId', 'editorSessionId', 'guidance'].includes(name),
      ) ||
      ![body.mapId, body.parentNodeId, body.generationId, body.editorSessionId].every(uuid) ||
      typeof body.guidance !== 'string' ||
      [...body.guidance].length > AI_GUIDANCE_MAX
    )
      return json({ error: 'VALIDATION' }, 400);
    if (!configured) return json({ error: 'AI_CONFIG_MISSING' }, 503);
    const started = Date.now();
    let reserved: Reply<GenerationJob>;
    try {
      reserved = await deps.service.reserve({
        p_actor: actor.id,
        p_map_id: body.mapId,
        p_parent_node_id: body.parentNodeId,
        p_generation_id: body.generationId,
        p_editor_session_id: body.editorSessionId,
        p_guidance: body.guidance,
        p_model: deps.model,
        p_daily_budget: budget,
      });
    } catch {
      return json({ error: 'AI_UNAVAILABLE' }, 503);
    }
    if (reserved.error || !reserved.data) {
      const code = clientErrors.includes(reserved.error?.message ?? '') ? reserved.error!.message : 'AI_UNAVAILABLE';
      const parsed = Number(reserved.error?.details),
        retryAfter = Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 86400 ? parsed : undefined;
      deps.log?.({ generationId: body.generationId, state: 'rejected', code, latencyMs: Date.now() - started });
      return json(
        { error: code, ...(retryAfter ? { retryAfter } : {}) },
        ['AI_RATE_LIMIT', 'AI_DAILY_LIMIT', 'AI_BUDGET_LIMIT'].includes(code)
          ? 429
          : code === 'NOT_FOUND'
            ? 404
            : code === 'AI_DISABLED'
              ? 403
              : code === 'AI_CONFIG_MISSING' || code === 'AI_UNAVAILABLE'
                ? 503
                : 400,
        retryAfter,
      );
    }
    const job = reserved.data;
    if (job.claimed)
      deps.background(
        (async () => {
          deps.log?.({ generationId: job.id, state: 'running', latencyMs: Date.now() - started });
          let usage: Usage | null = null;
          try {
            const generated = await (deps.generate ?? generateChildren)(
              job.context!,
              body.guidance,
              deps.key!,
              deps.model!,
            );
            usage = generated.usage;
            const finished = await deps.service.finish({
              p_generation_id: job.id,
              p_children: generated.children,
              p_usage: usage,
              p_error: null,
            });
            if (finished.error || !finished.data) throw new ProviderError('PROVIDER_FAILED', usage);
            deps.log?.({ generationId: job.id, state: finished.data.state, latencyMs: Date.now() - started, usage });
          } catch (error) {
            const code = error instanceof ProviderError ? error.code : 'PROVIDER_FAILED';
            usage = error instanceof ProviderError ? (error.usage ?? usage) : usage;
            const failed = await deps.service
              .finish({ p_generation_id: job.id, p_children: null, p_usage: usage, p_error: code })
              .catch(() => null);
            deps.log?.({
              generationId: job.id,
              state: failed?.data?.state ?? 'unconfirmed',
              code,
              latencyMs: Date.now() - started,
              usage,
            });
          }
        })(),
      );
    const safe = { ...job };
    delete safe.context;
    delete safe.claimed;
    return json(safe);
  }, deps.allowedOrigins);
}
