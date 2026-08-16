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
MODEL_FAST=openai/gpt-5.6-luna
MODEL_DEFAULT=openai/gpt-5.6-luna
MODEL_REASONING=openai/gpt-5.6-terra
MODEL_CODING=openai/gpt-5.6-sol
MODEL_FAST_REASONING_EFFORT=none
MODEL_DEFAULT_REASONING_EFFORT=low
MODEL_REASONING_REASONING_EFFORT=high
MODEL_CODING_REASONING_EFFORT=high
MODEL_MEMORY=
MODEL_VISION=
MODEL_STT=openai/gpt-4o-mini-transcribe
MODEL_TTS=hexgrad/kokoro-82m
```

`OPENROUTER_MODEL` continua como fallback compatível de `MODEL_DEFAULT`. Os slugs acima foram validados no catálogo `GET /api/v1/models` do OpenRouter em 16 de agosto de 2026. Capabilities expressam intenção e podem apontar para o mesmo modelo; por isso `FAST` e `DEFAULT` usam Luna inicialmente.

A seleção é responsabilidade de uma policy determinística no backend. Pedidos curtos e interações de voz usam `FAST`; sinais explícitos de análise complexa usam `REASONING`; desenvolvimento de software usa `CODING`; os demais usam `DEFAULT`. O cliente público e a LLM não recebem uma forma de escolher Terra ou Sol. Tools simples com apresentação determinística terminam a execução após o resultado confirmado; as demais voltam ao mesmo modelo da capability selecionada. Nunca há segunda chamada a um modelo superior só para reescrita.

O esforço de raciocínio também pertence à policy. Luna em `FAST` usa `none` porque o catálogo declara raciocínio opcional e o benchmark mostrou ganho relevante; `DEFAULT` usa `low`, enquanto Terra/Sol ficam preparados com `high`. Esses campos são configuráveis e enviados pelo adapter, não escolhidos pela LLM.

Em outras palavras: **Luna trabalha, Terra pensa, Sol programa.** `CODING` apenas preserva o roteamento para um futuro coding agent; este milestone não implementa self-development.

Fallbacks de **configuração** continuam finitos: `FAST → DEFAULT`, `REASONING → DEFAULT`, `CODING → REASONING → DEFAULT` e `MEMORY → FAST → DEFAULT`. `VISION`, `STT` e `TTS` não reaproveitam um modelo de texto silenciosamente. Isso é diferente de escalation: a policy escala antes da execução porque a tarefa exige outra capability.

Falha técnica do provider não dispara hoje uma cascata entre modelos: a API retorna `AI_PROVIDER_FAILED` com `retryable`, quando aplicável. Essa política limitada evita repetir silenciosamente chamadas e possíveis efeitos. Um fallback técnico futuro deverá permitir no máximo uma alternativa previamente autorizada pelo backend e nunca executar novamente uma tool já concluída.

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

Latência por modelo e capability pode ser consultada sem telemetria adicional:

```sql
select capability, model,
       count(*) as calls,
       avg(latency_ms)::numeric(12,2) as latency_avg_ms,
       percentile_cont(0.50) within group (order by latency_ms) as latency_p50_ms,
       percentile_cont(0.95) within group (order by latency_ms) as latency_p95_ms,
       sum(input_tokens) as input_tokens,
       sum(output_tokens) as output_tokens,
       sum(estimated_cost) as cost_usd
from ai_usage
where created_at >= date_trunc('month', now())
group by capability, model
order by capability, model;
```

## Benchmark de modelos

`pnpm benchmark:models` valida os slugs no catálogo vivo do OpenRouter e faz três amostras de resposta simples, consulta de clima e controle de temperatura por modelo. O relatório JSON mede p50/p95, confiabilidade da tool e dos argumentos, utilidade da resposta, aderência ao estilo de voz, tokens e custo informado pelo provider.

Por padrão são comparados Luna, GPT-5.4 Nano e GPT-4.1 Mini. Para uma rodada controlada:

```powershell
$env:MODEL_BENCHMARK_SAMPLES='5'
$env:MODEL_BENCHMARK_MODELS='openai/gpt-5.6-luna,openai/gpt-5.4-nano,openai/gpt-4.1-mini'
pnpm benchmark:models
```

Baseline local de 16 de agosto de 2026, com três amostras por cenário e 15 chamadas ao provider por modelo:

| Modelo       | p50 por cenário | p95 por cenário | Tool + argumentos | Resposta útil | Voice style | Custo médio/cenário |
| ------------ | --------------: | --------------: | ----------------: | ------------: | ----------: | ------------------: |
| GPT-5.6 Luna |        1.609 ms |        2.020 ms |              100% |          100% |        100% |        US$ 0,000097 |
| GPT-5.4 Nano |        1.553 ms |        1.969 ms |              100% |          100% |        100% |        US$ 0,000200 |
| GPT-4.1 Mini |        1.720 ms |        2.651 ms |              100% |          100% |        100% |        US$ 0,000358 |

Neste conjunto simples todos atingiram a mesma qualidade observável. Luna ficou praticamente empatada com Nano em latência e foi aproximadamente 51% mais barata que Nano e 73% mais barata que GPT-4.1 Mini por cenário. A amostra usa `reasoning.effort=none` para modelos GPT-5 em `FAST` e sustenta Luna como primeira opção operacional; não é evidência suficiente para substituir Terra ou Sol nas classes complexas que ainda precisam de benchmark próprio.
