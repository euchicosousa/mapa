# 26: Preparar ambiente de publicação com Auth e banco reais

**What to build:** O projeto Supabase final já usado desde o ticket 02 fica configurado para a URL publicada, com login, convites e funções verificados.

**Blocked by:** 04: Convidar uma pessoa para entrar na equipe; 25: Verificar isolamento, autoria e integridade ponta a ponta

**Status:** done — concluído em 21/10/2026; bloqueadores 04 e 25 concluídos.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Reutilizar o projeto Supabase final configurado no ticket 02. Conferir histórico/schema e aplicar somente migrações pendentes revisadas. Não criar staging nem outro banco; não resetar ou reaplicar seeds.
2. Conferir Auth e-mail/senha sem cadastro público, SMTP já usado nos tickets 03–04 e admin/equipe existentes. Acrescentar redirects exatos da URL publicada; preservar contas e dados. Segredos ficam nos recursos próprios do provedor.
3. Configurar Edge secrets e modelo/orçamento conforme contrato; publicar funções autenticadas com CORS restrito aos origins previstos. Testar autorização no servidor independentemente de CORS.
4. Registrar configuração não secreta e procedimento de recuperação/backup disponível no plano contratado; não assumir existência de PITR. Se faltarem acessos, preparar instruções e marcar blocked sem alegar publicação.

## Critérios de aceite

- [x] Conta admin real entra e convida um segundo usuário; e-mail recebido e senha definida.
- [x] Usuário sem equipe não acessa dados reais.
- [x] Schema remoto corresponde às migrações; recursos temporários de validação foram limpos por IDs exatos, preservando dados reais. Nenhum segredo entrou no bundle.
- [x] URL/chave publicável separadas de segredos, redirects e origins verificados.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Smoke com contas autorizadas de validação, inspeção de configurações e queries somente leitura depois da migração.

## Limites desta entrega

Não criar assinatura paga nem destruir/reiniciar banco existente. Acesso de destino precisa ser fornecido.

## Dependências externas

Projeto Supabase, credenciais por canal seguro, SMTP, origin de publicação, primeiro admin e configuração IA.

> Nota de sequência (19/10/2026): o SMTP listado acima é configurado antes, no ticket 03 (fase C). Aqui ele só é conferido para a URL publicada.

## Registro do executor

Preparação executada em 21/10/2026. Projeto Vercel `mapa`/`agenciacnvt` criado e vinculado, Vite/Node 22.x configurados; somente URL e chave publicável em Production/Preview. Domínio oficial informado pelo usuário: `https://mapa.cnvt.com.br`. CNAME criado pelo usuário na HostGator e confirmado pela Vercel (`configured_correctly`, sem conflitos). SPA não publicada nesta fatia.

Reutilizado o Supabase final, com 33 migrações já correspondentes; nenhuma migração, reset ou seed. Corrigido cadastro público que estava habilitado: teste antigo aceitava qualquer erro e agora exige `signup_disabled`. Auth mantém login por e-mail/SMTP, Site URL oficial e callbacks exatos, preservando valores remotos não declarados. Funções `generate-children`/`manage-invitation` publicadas com JWT obrigatório e CORS de origem exata. Segredos aprovados conferidos em memória; modelo `gpt-6-luna` e 50.000 tokens/dia preservados. Somente as listas de origem/callback foram acrescentadas.

Verificação: 128 testes unitários/componentes, 46 de RLS/integridade, três cenários de configuração remota e oito de senha/convites com Auth real (desktop/mobile), todos aprovados. Typecheck, build, lint e teste de fronteira do bundle aprovados; inspeção de oito arquivos compilados sem os três segredos locais. Evidências em `../evidence/26/`; procedimento/configuração em `docs/PUBLICACAO.md` na raiz do projeto.

Backup consultado: WAL-G habilitado, PITR desabilitado, nenhum ponto listado. Limitação e recuperação lógica documentadas, sem contratação nem restauração.

Convite real enviado às 08:41 para `and3rsonsousa@outlook.com`, autorizado pelo usuário e sem conta preexistente nesse endereço. Recebimento observado no Outlook (Lixo Eletrônico), remetente MAPA esperado. Link abriu o formulário local e removeu tokens da URL. Senha definida pelo usuário, status de salvamento observado e login real confirmado. Convite aceito, biblioteca aberta e servidor confirmou exatamente um vínculo ativo de membro e um convite aceito. O teste real foi assistido no navegador do usuário; o fluxo headless que aguardava o link foi interrompido, sem simular recebimento. Evidência sanitizada em `real-email.json`. A execução `20261021-f8bc91` foi limpa por IDs exatos; consulta posterior confirmou zero contas/espaços temporários e zero conta do destinatário, preservando o administrador real ativo. Nenhuma senha ou token foi gravado em evidências.

Resultado final: done. Ticket 27 desbloqueado para publicação da SPA e validação da URL pública; não iniciado nesta execução.
