# Memória, modelos e uso de IA

## Identidades e ownership

- `userId`: autoridade autenticada para acessar dados.
- `deviceId`: origem confiável da credencial atual.
- `sessionId`: correlação temporária do cliente; não concede acesso.
- `conversationId`: conversa persistente; não concede acesso.
- `requestId`: uma execução do `AgentRuntime`.

Uma conversa nova é criada quando `/v1/chat` recebe somente `message`. Para continuar, o cliente envia `{ "conversationId": "uuid", "message": "..." }`. O repository sempre combina `conversationId` com `userId`; inexistência e ownership inválido são indistinguíveis externamente.

`CONVERSATION_CONTEXT_MESSAGES` limita quantas mensagens recentes são enviadas ao modelo (padrão 20, máximo 100). O limite é por quantidade, não por tokens. Summaries, retrieval, pgvector, Long-Term Memory e Eko não fazem parte deste milestone.

## Dados persistidos e retenção

Atualmente são persistidos:

- identidade da conversa (`userId`, `deviceId` e timestamps);
- mensagens de usuário, assistente e tools necessárias para reconstruir o contexto;
- metadata normalizada de uso: identidade, provider, modelo, capability, tokens/unidades, latência e custo quando informado.

Não são persistidos headers HTTP, Bearer tokens, API keys, connection strings nem a resposta bruta do OpenRouter. Credenciais não devem ser enviadas no texto da conversa. O áudio bruto de uma interação de voz é descartado, mas sua transcrição vira uma mensagem normal da conversa e é persistida. Imagens, embeddings e transcrições ambientes não são armazenados neste milestone.

A retenção atual é indefinida porque ainda não há endpoint de exclusão. O schema prepara exclusão futura: apagar uma conversa remove suas mensagens por cascade; `ai_usage` e confirmações preservam observabilidade, mas perdem a referência da conversa com `ON DELETE SET NULL`. Uma futura operação de exclusão por usuário poderá localizar todas as linhas pelo `user_id` sem depender de busca semântica.

## Model Router

Configuração:

```dotenv
MODEL_DEFAULT=openai/gpt-4.1-mini
MODEL_FAST=
MODEL_REASONING=
MODEL_CODING=
MODEL_MEMORY=
MODEL_VISION=
MODEL_STT=openai/gpt-4o-mini-transcribe
MODEL_TTS=hexgrad/kokoro-82m
```

`OPENROUTER_MODEL` continua como fallback compatível de `MODEL_DEFAULT`. Chat normal usa `DEFAULT`; conclusão simples após confirmação usa `FAST`. `CODING` está disponível para um futuro coding agent, mas nenhuma rota pública permite ao cliente ou à LLM selecionar a capability.

Fallbacks atuais são finitos: `FAST → DEFAULT`, `REASONING → DEFAULT`, `CODING → REASONING → DEFAULT` e `MEMORY → FAST → DEFAULT`. `VISION`, `STT` e `TTS` não reaproveitam um modelo de texto silenciosamente; voz possui defaults explícitos que podem ser substituídos pelo ambiente. Não existe escalonamento recursivo ou automático neste milestone.

## AI usage e budget

Uma linha é gravada por chamada ao provider. O custo usa decimal PostgreSQL (`numeric(24,12)`), nunca ponto flutuante no domínio. STT também pode registrar segundos e TTS caracteres faturáveis. Quando o provider não informa um campo, ele fica `null`. Falha de telemetria é registrada no logger da aplicação e não altera uma resposta válida.

`BudgetPolicy` define a fronteira para limites diários, mensais e por request, incluindo decisões explícitas `ALLOW`, `DOWNGRADE` ou `DENY`. A política ainda não é aplicada porque não há agregação transacional de gastos. Nenhum downgrade ou bloqueio silencioso ocorre neste milestone.

Consultas operacionais iniciais:

```sql
select capability, model, count(*) as requests,
       sum(total_tokens) as tokens,
       sum(estimated_cost) as cost_usd
from ai_usage
where created_at >= date_trunc('month', now())
group by capability, model
order by cost_usd desc nulls last;
```
