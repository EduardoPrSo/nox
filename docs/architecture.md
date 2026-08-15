# Arquitetura do MVP

O cliente fala somente com `apps/api`. O `AgentRuntime` monta uma janela curta de contexto, consulta um `AIProvider` e apresenta à LLM schemas JSON derivados dos schemas Zod das tools. Cada tool call é novamente localizada no registry e validada; nomes ou argumentos gerados pelo modelo nunca viram execução arbitrária.

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

**Supabase é nossa plataforma de infraestrutura de dados, mas não faz parte do domínio do JARVIS.** O JARVIS Core continua independente e portável: `AgentRuntime` depende de `AuditRepository` e `ConfirmationRepository`; adapters InMemory ou Drizzle satisfazem esses contratos. Trocar o destino PostgreSQL exige configuração, não alteração no domínio.

Este marco persiste `audit_logs` e `confirmations`, as entidades necessárias ao fluxo atual. Evoluções previstas, criadas somente quando usadas: users, devices, conversations, messages, memories, tool_calls, permissions, automations, automation_runs, media e ai_usage.

Memórias poderão ganhar `metadata` e uma coluna `vector` via pgvector para FACT, PREFERENCE, EVENT, SUMMARY e OBSERVATION. Blobs de áudio, imagem e attachments irão para Supabase Storage privado; PostgreSQL guardará caminho e metadata. Auth poderá autenticar usuários, mas o provisionamento de dispositivos terá credenciais limitadas próprias. Realtime será um adapter de um futuro EventBus, jamais uma dependência do runtime.

Custos futuros serão registrados em `ai_usage` por usuário, modelo, provider, dispositivo e conversa, incluindo tokens, custo estimado e latência.

## Multimodal e voz

`AIMessage` aceita partes textuais e imagens. `AIProvider` reserva `transcribe` e `speak`; nenhuma rota de mídia foi exposta ainda. Isso preserva o contrato sem fingir que o pipeline já está pronto.

## Automações

A LLM futuramente traduz linguagem em uma regra validada. `AutomationEngine` executará triggers, condições e ações determinísticas. O modelo não participará da avaliação contínua.
