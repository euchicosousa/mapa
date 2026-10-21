# Operação do Mapa

URL: **https://mapa.cnvt.com.br**. Equipe operacional CNVT. Projeto Vercel `mapa`, escopo `agenciacnvt`; Supabase final `mapa`, ref `bodxafqkqlyfoyfgahyj`. Há um único banco final; desenvolvimento e validação também o usam. Preservar dados e contas reais.

## Publicação e migrações

A referência publicada e o procedimento de rollback estão em [DEPLOY.md](DEPLOY.md). O ticket 28 valida essa versão sem redesenhar nem acrescentar funcionalidades. Documentação e testes locais não exigem uma nova publicação do cliente.

Antes de publicar alterações: testar, compilar, revisar os arquivos enviados e executar o smoke público. Somente URL e chave publicável do Supabase entram na Vercel. A lista de origens e callbacks é exata; não liberar automaticamente URLs de preview. Não colocar segredo em variável `VITE_*`.

Migrações: criar arquivo versionado pela CLI instalada, revisar SQL e dependências, conferir o histórico remoto e aplicar somente arquivos pendentes no projeto final. Verificar tipos e autorização após mudanças. Não editar uma migração já aplicada, reaplicar seed, executar reset ou criar outro banco para contornar uma falha. O estado de referência desta entrega usa 33 migrações, consolidadas no ticket 30 numa base única (`supabase/migrations/20261021185253_base.sql`); o passo a passo de novas migrações está em [DEPLOY.md](DEPLOY.md#migrações-do-banco). Rollback do frontend não reverte banco, Auth, funções ou segredos.

## Configuração preservada

- Auth: e-mail/senha, cadastro público e acesso anônimo desabilitados. Site URL oficial e callback `/auth/callback`; SMTP Resend, remetente MAPA em `auth.cnvt.com.br`, TLS. A entrega real ao Outlook no ticket 26 foi observada no spam; não considerar resposta de envio como prova de recebimento.
- Funções `generate-children` e `manage-invitation`: JWT obrigatório e CORS de origens exatas. CORS não substitui autorização.
- OpenAI: chave somente nos segredos Supabase; modelo aprovado `gpt-6-luna`. Orçamento de **50.000 tokens/dia UTC por equipe**, uma geração ativa por usuário, 10 pedidos/minuto/usuário e 100 gerações/dia por equipe. Não aumentar limites silenciosamente para passar testes.
- A reserva de tokens é conservadora e reconciliada com o uso conhecido. Limite de tokens não é um teto monetário do provedor. Conferir cobrança e controles de gasto na conta OpenAI com o responsável; os testes registram tokens, sem inventar valores em moeda.

Valores de credenciais não são listados aqui. Seguir [PUBLICACAO.md](PUBLICACAO.md), [IA.md](IA.md) e [AUTH-SUPABASE.md](AUTH-SUPABASE.md).

## Backups e recuperação

O backup portátil do app foi exportado e importado como cópia no mesmo banco final durante o aceite. Estrutura, ordem e texto foram conferidos; o original não foi sobrescrito. A cópia e demais recursos descartáveis são limpos por IDs da execução.

Conferência de 21/10/2026: WAL-G habilitado, PITR desabilitado e nenhum backup listado pelo provedor. Portanto, nenhum ponto de restauração integral está confirmado. Não foi contratado plano adicional nem executada restauração.

Guardar os arquivos portáteis fora do projeto/computador de trabalho conforme a necessidade da equipe. Eles não substituem um backup completo do banco. A conferência do provedor e suas limitações ficam nas evidências do ticket 28 e em PUBLICACAO.md: não prometer restauração ou PITR sem ponto confirmado.

Para recuperação integral, um operador autorizado precisa de um backup validado e conexão segura compatível, como a exportação lógica documentada em PUBLICACAO.md. Validar o arquivo, schemas e permissões, definir manutenção e avaliar perda de alterações posteriores. Não foi exportado nem restaurado dado real neste aceite; restauração pode sobrescrever dados e exige autorização específica. Nunca testar restauração no banco final apagando-o.

## Incidentes comuns

| Sinal | Ação |
| --- | --- |
| Não entra ou esqueceu a senha | Conferir e-mail, usar Recuperar senha e verificar spam. O endereço Outlook da validação foi temporário; usar a conta operacional ou um novo convite. |
| Convite não chegou | Conferir endereço, estado de envio e spam; depois verificar SMTP/limite no Supabase. Reenvio respeita o intervalo exibido. Não pedir que a pessoa cole o link de acesso no chat. |
| Sem acesso à equipe | Conferir aceite, validade do convite e vínculo ativo em Equipe. Não alterar permissões no navegador para contornar a negativa do servidor. |
| Falha ao salvar | Preservar a aba e o rascunho; restabelecer a rede, entrar na mesma conta e repetir a mesma tentativa. Exportar rascunho de emergência se necessário. |
| Conflito | Preservar a versão local como cópia ou confirmar descarte após ler a versão remota. Sem mesclagem automática. |
| IA indisponível ou limitada | Conferir mensagem, segredos/modelo, cota da equipe e saldo do provedor. Não repetir chamadas indefinidamente nem desligar os limites. |
| Desativação bloqueada | Transferir os mapas da pessoa; preservar pelo menos um administrador ativo. |
| Página falha depois de publicação | Conferir deploy/alias, assets e versão. Usar o rollback do frontend compatível e repetir o smoke, preservando banco e rascunhos. |

Falhas do cliente registram apenas categoria, rota normalizada, versão e horário no console, em memória; não há coleta centralizada nem garantia de alerta automático. Logs das funções e Auth ficam no Supabase, e respostas do deploy na Vercel. Em diagnóstico, não compartilhar senhas, tokens, headers de autorização, textos de mapas ou arquivos `.env`. Risco residual conhecido: proteção do provedor contra senhas vazadas ainda não habilitada, conforme SEGURANCA.md; não foi alterada nesta entrega.

## Repetir o aceite

`npm run test:acceptance` usa a versão publicada, contas/equipes descartáveis no projeto final e **duas chamadas reais de IA**, uma por viewport. Os recursos são registrados em `.validation-runs` e removidos por IDs exatos. Precisa da configuração administrativa local privada, nunca de uma chave administrativa no navegador do produto. Senhas passam somente em memória/pipe; traces e vídeo ficam desligados.

Em interrupção, conferir os registros e executar a limpeza de cada `run_id` específico com `node scripts/validation-run.mjs cleanup <run_id>`. Não apagar usuários por prefixo ou tabelas inteiras. Consultas agregadas confirmam ausência de remanescentes; não servem como autorização de exclusão.

O aceite mede 1440×900 e 390×844 em Chromium, com conferência adicional em 768 e 360 px. É emulação móvel, não teste de aparelho físico. Navegador/versão e evidências estão no relatório de entrega; desempenho e acessibilidade anteriores em [DESEMPENHO.md](DESEMPENHO.md) e [ACESSIBILIDADE.md](ACESSIBILIDADE.md). Os testes pessoais do usuário e a futura avaliação visual ficam explicitamente para depois desta entrega.
