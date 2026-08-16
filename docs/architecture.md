# Arquitetura do MVP

O cliente fala somente com `apps/api`. O `AgentRuntime` monta uma janela curta e configurável de contexto, pede uma capacidade ao `ModelRouter`, consulta um `AIProvider` e apresenta à LLM schemas JSON derivados dos schemas Zod das tools. Cada tool call é novamente localizada no registry e validada; nomes ou argumentos gerados pelo modelo nunca viram execução arbitrária.

```text
HTTP client → Fastify → AgentRuntime → AIProvider/OpenRouter
                           ↓ tool call
                     ToolRegistry + Zod
                           ↓
                    PermissionEngine
                    ↙ allow   ↘ confirm
                 Tool          ConfirmationStore
                   ↓                  ↓ approval
                 Audit ←──────────── Tool
```

O loop tem no máximo seis iterações. Tools têm timeout lógico de dez segundos e recebem somente `userId`, `requestId` e `AbortSignal`. Confirmações são de uso único e presas ao usuário e ao hash dos argumentos.

## Persistência e Supabase

Com `PERSISTENCE_DRIVER=postgres`, `DrizzleMemoryStore` persiste `conversations` e `messages`. Toda leitura usa simultaneamente `conversationId` e o `userId` autenticado. A janela recente é limitada por `CONVERSATION_CONTEXT_MESSAGES`; retrieval semântico e Ambient Memory continuam fora deste milestone.

**Supabase é nossa plataforma de infraestrutura de dados, mas não faz parte do domínio do NOX.** O NOX Core continua independente e portátil: `AgentRuntime` depende de `AuditRepository` e `ConfirmationRepository`; adapters InMemory ou Drizzle satisfazem esses contratos. Trocar o destino PostgreSQL exige configuração, não alteração no domínio.

O core persiste `audit_logs`, `confirmations`, `conversations`, `messages` e `ai_usage`. Evoluções previstas, criadas somente quando usadas: users, devices, long-term memories, permissions, automations, automation_runs e media.

Memórias poderão ganhar `metadata` e uma coluna `vector` via pgvector para FACT, PREFERENCE, EVENT, SUMMARY e OBSERVATION. Blobs de áudio, imagem e attachments irão para Supabase Storage privado; PostgreSQL guardará caminho e metadata. Auth poderá autenticar usuários, mas o provisionamento de dispositivos terá credenciais limitadas próprias. Realtime será um adapter de um futuro EventBus, jamais uma dependência do runtime.

Cada chamada ao provider gera, em best-effort, uma linha de `ai_usage` por usuário, modelo, capability, dispositivo e conversa, incluindo tokens, custo informado pelo provider e latência. O runtime depende apenas do formato normalizado de `AIProvider`.

## Model Router

O backend escolhe uma capability (`FAST`, `DEFAULT`, `REASONING`, `CODING`, `VISION`, `MEMORY`, `STT` ou `TTS`) e o router resolve o modelo configurado. A API de chat solicita somente `DEFAULT`; o cliente e a LLM não escolhem tiers. Fallbacks são limitados e determinísticos. Capacidades multimodais sem configuração falham explicitamente em vez de usar silenciosamente um modelo de texto.

## Multimodal e voz

`AIMessage` aceita partes textuais e imagens. `AIProvider` reserva `transcribe` e `speak`; nenhuma rota de mídia foi exposta ainda. Isso preserva o contrato sem fingir que o pipeline já está pronto.

## Automações

A LLM futuramente traduz linguagem em uma regra validada. `AutomationEngine` executará triggers, condições e ações determinísticas. O modelo não participará da avaliação contínua.
