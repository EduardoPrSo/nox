# NOX Core

Fundação do backend de um agente pessoal multimodal, independente dos clientes e orientado a ferramentas. O core suporta conversas persistentes por texto e o Voice MVP request/response com o mesmo runtime, memória, tools e confirmações.

## Decisões do MVP

- **Monorepo pnpm:** separa contratos por responsabilidade sem criar serviços distribuídos prematuramente.
- **Supabase PostgreSQL + Drizzle:** Supabase é o destino gerenciado de produção; o core enxerga apenas repositories e PostgreSQL tipado.
- **Ports e adapters:** IA, memória, auditoria e confirmações são interfaces substituíveis. Os adapters em memória facilitam desenvolvimento e testes; o schema PostgreSQL prepara persistência.
- **Autorização fora da LLM:** toda chamada passa por validação Zod e pelo Permission Engine. EXTERNAL sempre confirma; ACTION depende de configuração.
- **Confirmação vinculada:** ID aleatório, usuário, tool call, argumentos validados, hash e expiração impedem reutilização para outra ação.

## Estrutura

```text
apps/api                 Fastify e rotas HTTP
apps/web                 frontend oficial Next.js/PWA
packages/agent           loop de tool calling
packages/ai              contrato AIProvider e OpenRouter
packages/embeddings      contrato e adapters de embedding
packages/eko             state machine, VAD, ring buffer e pipeline ambiental
packages/tools           registry e cinco mocks
packages/permissions     decisões ALLOW/DENY/REQUIRE_CONFIRMATION
packages/confirmations   fluxo de aprovação vinculado
packages/climate         provider, tools e broker outbound de dispositivos
packages/audit           eventos e sanitização
packages/memory          conversa, classifier e memória semântica
packages/database        schema Drizzle/PostgreSQL
packages/usage           observabilidade de IA e contratos de budget
packages/voice           contratos STT/TTS, adapter OpenRouter e orquestração
apps/device-bridge       worker Python para Midea LAN
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

O frontend de produto do Milestone 6A usa dados mockados e roda separadamente no desenvolvimento:

```bash
pnpm dev:web
```

Abra `http://localhost:3000` e consulte [docs/frontend.md](docs/frontend.md) para arquitetura, rotas, design system e limites do 6A.

Em produção, `https://dudunox.duckdns.org/` serve a PWA. O proxy mantém `/health`, `/v1/*`, `/bridge/*`, `/voice` e `/eko` direcionados para a API.

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

Para voz, abra `http://127.0.0.1:3000/voice` (ou a URL HTTPS da VPS), informe o mesmo Bearer token e segure o botão para falar. A rota autenticada `POST /v1/voice` também aceita multipart com `audio` e `conversationId` opcional. Consulte [docs/voice.md](docs/voice.md) para contrato, formatos, privacidade e verificação real.

Para conectar o Core na VPS a um Midea dentro da rede residencial sem port forwarding, consulte [docs/device-bridge.md](docs/device-bridge.md). O mock continua sendo o driver padrão.

Para Ambient Memory, abra `http://127.0.0.1:3000/eko`. A rota autenticada `POST /v1/eko/segments` nunca passa pelo AgentRuntime, tools ou TTS. Controles, retenção, custos e pgvector estão em [docs/eko.md](docs/eko.md).

## Qualidade

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm build:web
pnpm format:check
```

As rotas `/v1/*` exigem Bearer token. `userId` e `deviceId` vêm da configuração autenticada do servidor; `sessionId` é validado ou gerado pela API e devolvido no header `x-session-id`.

Para executar com Docker ou operar deploy/rollback na VPS, consulte [docs/deployment.md](docs/deployment.md).
