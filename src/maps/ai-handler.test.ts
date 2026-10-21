import { expect, it, vi } from 'vitest';
import {
  createGenerationHandler,
  generationLog,
  type Service,
  type GenerationJob,
} from '../../supabase/functions/generate-children/handler';
import { ProviderError } from '../../supabase/functions/generate-children/provider';
const id = '00000000-0000-4000-8000-000000000001';
const payload = {
  mapId: id,
  parentNodeId: id,
  generationId: id,
  editorSessionId: id,
  guidance: 'Client text must not enter logs',
};
const running: GenerationJob = {
  id,
  mapId: id,
  state: 'running',
  claimed: true,
  context: { title: 'Private client title', path: [{ id, text: 'Private node' }], children: [] },
};
const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 };
const request = (body: unknown = payload) =>
  new Request('https://example.test', {
    method: 'POST',
    headers: { Authorization: 'Bearer private-session-token' },
    body: JSON.stringify(body),
  });
function setup() {
  const service: Service = {
    authenticate: vi.fn(async () => ({ id })),
    available: vi.fn(async () => true),
    reserve: vi.fn(async () => ({ data: running, error: null })),
    finish: vi.fn(async () => ({ data: { ...running, state: 'applied' }, error: null })),
  };
  const generate = vi.fn(async () => ({
    children: [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }],
    usage,
  }));
  const tasks: Promise<unknown>[] = [];
  const log = vi.fn();
  return {
    service,
    generate,
    tasks,
    log,
    dependencies: {
      service,
      key: 'private-provider-key',
      model: 'configured-model',
      budget: '50000',
      generate,
      background: (task: Promise<unknown>) => {
        tasks.push(task);
      },
      log,
    },
  };
}
it('quota rejection never calls the adapter, preserves Retry-After and logs only safe metadata', async () => {
  for (const code of ['AI_RATE_LIMIT', 'AI_DAILY_LIMIT', 'AI_BUDGET_LIMIT', 'AI_BUSY']) {
    const f = setup();
    vi.mocked(f.service.reserve).mockResolvedValue({ data: null, error: { message: code, details: '60' } });
    const response = await createGenerationHandler(f.dependencies)(request());
    expect(response.status).toBe(code === 'AI_BUSY' ? 400 : 429);
    expect((await response.json()).error).toBe(code);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.service.finish).not.toHaveBeenCalled();
    expect(f.tasks).toHaveLength(0);
    const logs = f.log.mock.calls.map(([event]) => generationLog(event)).join();
    for (const marker of [
      'Private client title',
      'Private node',
      'Client text',
      'private-session-token',
      'private-provider-key',
    ])
      expect(logs).not.toContain(marker);
  }
});
it('missing configuration never reserves or calls a provider and availability explains the reason', async () => {
  const f = setup(),
    handler = createGenerationHandler({ ...f.dependencies, key: undefined });
  const response = await handler(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'AI_CONFIG_MISSING' });
  expect(await (await handler(request({ action: 'availability' }))).json()).toEqual({
    enabled: false,
    error: 'AI_CONFIG_MISSING',
  });
  expect(f.service.reserve).not.toHaveBeenCalled();
  expect(f.generate).not.toHaveBeenCalled();
});
it('a repeated claimed=false generation does not call the provider or debit again', async () => {
  const f = setup();
  vi.mocked(f.service.reserve).mockResolvedValue({ data: { ...running, claimed: false }, error: null });
  const response = await createGenerationHandler(f.dependencies)(request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.context).toBeUndefined();
  expect(body.claimed).toBeUndefined();
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.tasks).toHaveLength(0);
});
it('one claimed request calls one adapter, finalizes with usage and emits a correlated terminal event', async () => {
  const f = setup();
  await createGenerationHandler(f.dependencies)(request());
  await Promise.all(f.tasks);
  expect(f.generate).toHaveBeenCalledOnce();
  expect(f.service.finish).toHaveBeenCalledOnce();
  expect(vi.mocked(f.service.finish).mock.calls[0][0].p_usage).toEqual(usage);
  expect(f.log).toHaveBeenLastCalledWith(expect.objectContaining({ generationId: id, state: 'applied', usage }));
});
it('terminal provider failures preserve known usage without retry; timeout preserves the unknown reserve', async () => {
  for (const code of [
    'TIMEOUT',
    'INVALID_OUTPUT',
    'PROVIDER_RATE_LIMIT',
    'PROVIDER_CONFIG',
    'PROVIDER_BUDGET',
  ] as const) {
    const f = setup();
    f.generate.mockRejectedValue(new ProviderError(code, code === 'TIMEOUT' ? null : usage));
    vi.mocked(f.service.finish).mockResolvedValue({ data: { ...running, state: 'failed' }, error: null });
    await createGenerationHandler(f.dependencies)(request());
    await Promise.all(f.tasks);
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.service.finish).toHaveBeenCalledWith({
      p_generation_id: id,
      p_children: null,
      p_usage: code === 'TIMEOUT' ? null : usage,
      p_error: code,
    });
  }
});
it('client parameters cannot change server budget/model or forge worker source', async () => {
  const f = setup();
  for (const extra of [{ budget: 999999 }, { model: 'client-model' }, { source: 'ai' }])
    expect((await createGenerationHandler(f.dependencies)(request({ ...payload, ...extra }))).status).toBe(400);
  expect(f.service.reserve).not.toHaveBeenCalled();
  expect(f.generate).not.toHaveBeenCalled();
});
it('structured logs drop arbitrary client fields and never stringify full errors or requests', () => {
  const event = {
    generationId: id,
    state: 'failed',
    latencyMs: 123,
    code: 'TIMEOUT',
    usage,
    context: 'PRIVATE',
    apiKey: 'SECRET',
    password: 'PASSWORD',
    authorization: 'BEARER',
  };
  const parsed = JSON.parse(generationLog(event));
  expect(Object.keys(parsed).sort()).toEqual(
    ['code', 'event', 'generationId', 'inputTokens', 'latencyMs', 'outputTokens', 'state', 'totalTokens'].sort(),
  );
  expect(JSON.stringify(parsed)).not.toMatch(/PRIVATE|SECRET|PASSWORD|BEARER/);
});
