# NOX Core

Fundação do backend de um agente pessoal multimodal, independente dos clientes e orientado a ferramentas. Este milestone implementa o fluxo texto → API → agente → OpenRouter → tool → permissão → resposta.

## Decisões do MVP

- **Monorepo pnpm:** separa contratos por responsabilidade sem criar serviços distribuídos prematuramente.
- **Supabase PostgreSQL + Drizzle:** Supabase é o destino gerenciado de produção; o core enxerga apenas repositories e PostgreSQL tipado.
- **Ports e adapters:** IA, memória, auditoria e confirmações são interfaces substituíveis. Os adapters em memória facilitam desenvolvimento e testes; o schema PostgreSQL prepara persistência.
- **Autorização fora da LLM:** toda chamada passa por validação Zod e pelo Permission Engine. EXTERNAL sempre confirma; ACTION depende de configuração.
- **Confirmação vinculada:** ID aleatório, usuário, tool call, argumentos validados, hash e expiração impedem reutilização para outra ação.

## Estrutura

```text
apps/api                 Fastify e rotas HTTP
packages/agent           loop de tool calling
packages/ai              contrato AIProvider e OpenRouter
packages/tools           registry e cinco mocks
packages/permissions     decisões ALLOW/DENY/REQUIRE_CONFIRMATION
packages/confirmations   fluxo de aprovação vinculado
packages/audit           eventos e sanitização
packages/memory          portas e adapter simples
packages/database        schema Drizzle/PostgreSQL
packages/usage           observabilidade de IA e contratos de budget
packages/identity        autenticação e contexto de identidade
packages/automations     contrato futuro
packages/shared          ambiente e utilitários
docs                     arquitetura, segurança, tools e pendant
tests                    testes do runtime e API
```

## Executar

Com `PERSISTENCE_DRIVER=postgres`, conversas, mensagens, confirmações, auditoria e uso de IA são persistidos no PostgreSQL. `PERSISTENCE_DRIVER=in-memory` mantém todos esses adapters locais para desenvolvimento e testes.

Requer Node.js 22+ e pnpm.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Preencha `OPENROUTER_API_KEY` e gere um `NOX_API_TOKEN` aleatório com pelo menos 32 caracteres. Para permitir tools ACTION sem confirmação, defina `ACTION_TOOLS_AUTO_ALLOWED=true`. EXTERNAL continua exigindo confirmação.

O padrão é `PERSISTENCE_DRIVER=in-memory`. Para Supabase, use a connection string PostgreSQL do projeto em `DATABASE_URL`, defina `PERSISTENCE_DRIVER=postgres` e aplique `pnpm db:migrate`. O backend não usa nem precisa do SDK Supabase neste milestone.

```bash
curl -X POST http://127.0.0.1:3000/v1/chat -H "authorization: Bearer $NOX_API_TOKEN" -H "content-type: application/json" -H "x-session-id: 11111111-1111-4111-8111-111111111111" -d '{"message":"Que horas são?"}'
```

A primeira resposta contém `conversationId`. Envie esse UUID nas mensagens seguintes para continuar a mesma conversa. O servidor sempre valida ownership usando o usuário autenticado; `conversationId` e `sessionId` nunca concedem acesso.

Confirme ou rejeite a resposta pendente:

```bash
curl -X POST http://127.0.0.1:3000/v1/confirmations/ID -H "authorization: Bearer $NOX_API_TOKEN" -H "content-type: application/json" -H "x-session-id: 11111111-1111-4111-8111-111111111111" -d '{"approved":true}'
```

## Qualidade

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

As rotas `/v1/*` exigem Bearer token. `userId` e `deviceId` vêm da configuração autenticada do servidor; `sessionId` é validado ou gerado pela API e devolvido no header `x-session-id`.

Para executar com Docker ou operar deploy/rollback na VPS, consulte [docs/deployment.md](docs/deployment.md).
