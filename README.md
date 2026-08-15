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
packages/automations     contrato futuro
packages/shared          ambiente e utilitários
docs                     arquitetura, segurança, tools e pendant
tests                    testes do runtime e API
```

## Executar

> **Limitação atual:** `PERSISTENCE_DRIVER=postgres` persiste confirmações e auditoria, mas a memória de conversa ainda usa `InMemoryMemoryStore`. A persistência de memória em PostgreSQL faz parte do backlog imediato de Eko/Ambient Memory.

Requer Node.js 22+ e pnpm.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Preencha `OPENROUTER_API_KEY`. Para permitir tools ACTION sem confirmação, defina `ACTION_TOOLS_AUTO_ALLOWED=true`. EXTERNAL continua exigindo confirmação.

O padrão é `PERSISTENCE_DRIVER=in-memory`. Para Supabase, use a connection string PostgreSQL do projeto em `DATABASE_URL`, defina `PERSISTENCE_DRIVER=postgres` e aplique `pnpm db:migrate`. O backend não usa nem precisa do SDK Supabase neste milestone.

```bash
curl -X POST http://127.0.0.1:3000/v1/chat -H "content-type: application/json" -H "x-user-id: local-user" -d '{"message":"Que horas são?"}'
```

Confirme ou rejeite a resposta pendente:

```bash
curl -X POST http://127.0.0.1:3000/v1/confirmations/ID -H "content-type: application/json" -H "x-user-id: local-user" -d '{"approved":true}'
```

## Qualidade

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

O header `x-user-id` é apenas uma identidade local provisória. Antes de exposição em rede, substitua-o por autenticação real e use adapters PostgreSQL para confirmações, auditoria e memória.
