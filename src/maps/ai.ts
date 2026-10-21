import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { commandResult, editorSessionId, toMapError, MapError } from './api';
import { MAP_DEPTH_MAX, MAP_NODES_MAX } from './limits';
export const generationSchema = z.object({
  id: z.uuid(),
  mapId: z.uuid(),
  parentNodeId: z.uuid(),
  editorSessionId: z.uuid(),
  state: z.enum(['pending', 'running', 'applied', 'failed', 'cancelled', 'stale']),
  errorCode: z.string().nullable(),
  result: commandResult.nullable(),
});
export type AIGeneration = z.infer<typeof generationSchema>;
export class AIError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfter = 0,
  ) {
    super(code);
  }
}
export type AIAvailability = { enabled: boolean; code: string | null };
export type AIRequest = {
  mapId: string;
  parentNodeId: string;
  generationId: string;
  editorSessionId: string;
  guidance: string;
};
export async function aiAvailable(): Promise<AIAvailability> {
  if (!supabase) return { enabled: false, code: 'AI_UNAVAILABLE' };
  const { data, error } = await supabase.functions.invoke('generate-children', { body: { action: 'availability' } });
  return {
    enabled: !error && data?.enabled === true,
    code: error ? 'AI_UNAVAILABLE' : typeof data?.error === 'string' ? data.error : null,
  };
}
export async function startAI(request: AIRequest): Promise<AIGeneration> {
  if (!supabase) throw new AIError('AI_UNAVAILABLE');
  const { data, error } = await supabase.functions.invoke('generate-children', { body: request });
  if (error) {
    let code = 'AI_UNAVAILABLE',
      retryAfter = 0;
    try {
      if (error.context instanceof Response) {
        const body = await error.context.json();
        code = body.error ?? code;
        retryAfter =
          Number.isSafeInteger(body.retryAfter) && body.retryAfter > 0 && body.retryAfter <= 86400
            ? body.retryAfter
            : 0;
      }
    } catch {
      /* A lost response is reconciled by querying the same job id. */
    }
    throw new AIError(code, retryAfter);
  }
  return generationSchema.parse(data);
}
export async function getAI(mapId: string, generationId: string | null): Promise<AIGeneration | null> {
  if (!supabase) throw new MapError('UNAVAILABLE');
  const { data, error } = await supabase
    .rpc('get_ai_generation', {
      p_map_id: mapId,
      ...(generationId ? { p_generation_id: generationId } : {}),
      p_editor_session_id: editorSessionId,
    })
    .abortSignal(AbortSignal.timeout(20_000));
  if (error) throw toMapError(error);
  return data === null ? null : generationSchema.parse(data);
}
export async function cancelAI(mapId: string, generationId: string): Promise<AIGeneration> {
  if (!supabase) throw new MapError('UNAVAILABLE');
  const { data, error } = await supabase
    .rpc('cancel_ai_generation', { p_map_id: mapId, p_generation_id: generationId })
    .abortSignal(AbortSignal.timeout(20_000));
  if (error) throw toMapError(error);
  return generationSchema.parse(data);
}
export const aiErrorText: Record<string, string> = {
  AI_CONFIG_MISSING:
    'A IA não está configurada. Peça ao administrador para conferir a chave, o modelo e o orçamento no servidor.',
  AI_RATE_LIMIT: 'Você atingiu o limite de pedidos por minuto. Aguarde antes de tentar novamente.',
  AI_DAILY_LIMIT: 'A equipe atingiu o limite diário de gerações. O limite renova à meia-noite UTC.',
  AI_BUDGET_LIMIT:
    'O saldo diário de tokens não permite outra geração agora. Aguarde a conclusão das chamadas em andamento ou a renovação à meia-noite UTC.',
  PROVIDER_CONFIG:
    'O provedor recusou a configuração. Peça ao administrador para conferir a chave, o modelo e as permissões.',
  PROVIDER_RATE_LIMIT: 'O provedor está limitando as solicitações. Aguarde e tente novamente manualmente.',
  PROVIDER_BUDGET:
    'O provedor bloqueou o uso por saldo ou limite de gasto. Peça ao administrador para conferir a conta da API.',
  AI_DISABLED: 'A geração com IA ainda não está liberada para esta conta.',
  AI_UNAVAILABLE: 'A IA está indisponível. Confira a conexão e tente consultar a solicitação novamente.',
  AI_BUSY: 'Você já tem uma geração em andamento. Aguarde a conclusão.',
  AI_LIMIT: 'O limite de uso da IA foi atingido. Tente novamente mais tarde.',
  AI_CONTEXT_TOO_LONG: 'O contexto deste ramo é muito longo para a IA. Escolha um ramo menor.',
  LIMIT_EXCEEDED: `É preciso espaço para quatro nós, dentro dos limites de ${MAP_NODES_MAX} nós e ${MAP_DEPTH_MAX} níveis.`,
  CONTEXT_CHANGED: 'O contexto mudou durante a geração. Nenhum filho foi inserido. Você pode tentar novamente.',
  EXPIRED: 'A geração expirou. Nenhum filho foi inserido. Você pode tentar novamente.',
  INVALID_OUTPUT: 'A resposta da IA não contém quatro caminhos válidos. Nenhum filho foi inserido.',
  REFUSED: 'A IA recusou esta solicitação. Nenhum filho foi inserido.',
  TIMEOUT: 'A IA não respondeu a tempo. Nenhum filho foi inserido.',
  PROVIDER_FAILED: 'Não foi possível gerar os caminhos. Nenhum filho foi inserido.',
};
