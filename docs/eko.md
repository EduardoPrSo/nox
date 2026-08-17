# Eko / Ambient Memory

Eko separa rigorosamente **ouvir** de **agir**:

```text
AMBIENT: microfone -> VAD local -> segmento -> STT -> transcript temporário
         -> classifier -> embedding -> memória
         -> nunca AgentRuntime, tools, confirmação ou TTS

ACTIVE:  botão/push-to-talk (wake word futuramente) -> AgentRuntime
         -> retrieval -> tools/permissões -> TTS
```

## Estados e response gating

- `OFF`: sem captura ambiental, STT ou memória ambiental.
- `AMBIENT`: captura segmentos e pode formar memória, mas não responde nem executa ações.
- `ACTIVE`: transição explícita e temporária iniciada por botão/push-to-talk. É o único estado que alcança o `AgentRuntime`.

O estado persistido por usuário/dispositivo é apenas `OFF` ou `AMBIENT`. `ACTIVE` pertence a uma interação explícita e volta ao estado anterior quando termina. O Core rejeita `POST /v1/eko/segments` se o estado persistido não for `AMBIENT`.

O `EkoAmbientService` não recebe referências ao `AgentRuntime`, registry de tools, Permission Engine, confirmações ou TTS. Assim, o gating é estrutural e também coberto por testes.

## VAD e ring buffer

A bancada `/eko` usa Web Audio para calcular RMS localmente a cada 50 ms. Somente quando o nível ultrapassa o threshold começa um `MediaRecorder`; silêncio suficiente ou duração máxima fecha o segmento.

```env
EKO_VAD_SPEECH_THRESHOLD=0.025
EKO_VAD_MINIMUM_SPEECH_MS=600
EKO_VAD_SILENCE_TIMEOUT_MS=900
EKO_VAD_MAXIMUM_SEGMENT_MS=30000
EKO_RING_BUFFER_SECONDS=45
```

O ring buffer guarda frames PCM apenas na RAM da página e os descarta continuamente. Ele prepara a futura UX “Nox, lembra disso”, mas o lookback ainda não é enviado neste milestone.

Escolhemos RMS/Web Audio para não adicionar agora ONNX Runtime + modelo Silero de vários megabytes. É leve, transparente e suficiente para diagnóstico, mas menos robusto contra TV, música e ruído. A abstração e os parâmetros permitem substituir o detector por Silero VAD no cliente nativo/Pendant.

## Wake word

O browser usa ativação explícita por botão/push-to-talk. Não há detector baseado em upload contínuo.

- Porcupine Web/WASM executa localmente, mas exige AccessKey e modelo customizado por plataforma.
- sherpa-onnx/openWakeWord têm bons caminhos nativos, porém sem combinação browser + português + “Nox” madura o bastante para este milestone.
- Web Speech API não garante processamento local e não atende a regra de privacidade.

A state machine aceita `explicitActivation`, permitindo conectar depois um `WakeWordDetector` local sem alterar o Core. Para Pendant, a escolha deve ser benchmarkada no hardware e nunca depender de OpenRouter.

## Pipeline ambiental

`POST /v1/eko/segments` é autenticado e multipart:

- `audio`: WAV, WebM/Opus, MP3 ou M4A, com as mesmas validações do Voice;
- `durationMs`: usado pelos controles de custo e limitado pela duração máxima;
- `sourceContext` opcional: `unknown` ou `media`.

O retorno contém transcript temporário, decisão e memória criada/reforçada. Não contém áudio/TTS e não cria mensagem conversacional.

O classifier usa `ModelCapability.MEMORY` (Luna por padrão), `response_format: json_schema` e validação Zod. Saída inválida, baixa confiança ou baixa importância vira `DISCARD`.

Tipos: `FACT`, `EVENT`, `PREFERENCE`, `PLAN`, `LOCATION`, `RELATIONSHIP` e `OBSERVATION`.

Filtros determinísticos descartam antes do modelo fala trivial, secrets, senhas, tokens, API keys, cartões válidos por Luhn, OTP/2FA, identificadores bancários explícitos e conteúdo muito longo ou marcado como mídia.

Como não há speaker identification, conteúdo Eko persistido usa “Foi mencionado que…” e metadata `speakerIdentity=unknown`.

## Persistência e pgvector

Migration `0003_parched_jackal.sql`:

- habilita `vector` no schema `extensions`;
- cria `eko_device_states`, `ambient_transcripts` e `long_term_memories`;
- usa `extensions.vector(1536)`;
- adiciona `operation` a `ai_usage`.

O Supabase em uso foi validado com pgvector `0.8.2`. A busca inicial é cosine exata (`<=>`) com filtro obrigatório por `user_id`. Não há HNSW ainda: para o volume pessoal inicial, sequential scan é simples e exato. HNSW passa a valer quando o conjunto crescer significativamente.

Embeddings usam a interface `EmbeddingProvider`. O adapter atual chama OpenRouter com `openai/text-embedding-3-small`, `data_collection=deny`, 1536 dimensões. Uma chamada real de validação com 20 tokens custou US$ 0,0000004. Conteúdo e query devem usar sempre o mesmo modelo/dimensão.

Ranking:

```text
65% cosine similarity
15% importance
10% confidence
10% recency (decaimento em 30 dias)
```

Deduplicação procura a memória mais semelhante do mesmo usuário. Tipo igual e cosine `>= 0.90` reforçam importance/confidence e incrementam `reinforcementCount` em vez de criar outra linha.

## Integração ACTIVE e provenance

Antes de uma solicitação ACTIVE, `SemanticMemorySearch` gera embedding da pergunta e retorna no máximo `EKO_MEMORY_RETRIEVAL_LIMIT` memórias. Nenhuma memória de outro `userId` entra na consulta.

O AgentRuntime recebe um bloco separado da memória conversacional recente. Cada entrada interna contém memory id, source, source timestamp e confidence. O bloco é contexto não confiável, nunca instrução. Os IDs usados ficam no audit log `memory_retrieval`, permitindo rastrear “como você sabe?” sem inventar origem.

## Retenção e exclusão

```text
Áudio bruto: RAM do browser/request -> descartado após processamento
Transcript ambiental: 24 h por padrão -> limpeza oportunista
Memória extraída: persistente -> expires_at opcional
```

Endpoints autenticados:

```text
GET    /v1/eko/config
GET    /v1/eko/state
POST   /v1/eko/state              { "state": "OFF" | "AMBIENT" }
POST   /v1/eko/segments
GET    /v1/eko/transcripts?limit=20
GET    /v1/memories?source=eko&limit=20
DELETE /v1/memories/:id
DELETE /v1/memories?source=eko
```

Listagem e exclusão sempre incluem ownership. A exclusão em massa só aceita `source=eko`.

## Custos e limites

```env
EKO_MAX_STT_MINUTES_PER_HOUR=15
EKO_MAX_SEGMENTS_PER_MINUTE=6
EKO_MAX_MEMORY_EXTRACTIONS_PER_HOUR=30
```

Estimativa conservadora no teto:

- STT: até aproximadamente US$ 0,045/h, assumindo cerca de US$ 0,003/min;
- 30 classificações Luna: aproximadamente US$ 0,0022/h para ~250 tokens de entrada e ~80 de saída;
- 30 embeddings pequenos: menos de US$ 0,0001/h;
- total ambiental aproximado: **US$ 0,05/h no teto configurado**.

É estimativa, não garantia: duração, tokenização e preços variam. `ai_usage.operation` separa `active_request`, `active_stt`, `ambient_stt`, `memory_classification`, `memory_embedding`, `memory_retrieval` e `tts`.

Os limites usam janelas locais no processo. Reiniciar ou escalar horizontalmente reinicia/divide os contadores; um rate limiter distribuído é evolução obrigatória antes de múltiplas instâncias.

## Teste local

```bash
pnpm db:migrate
pnpm dev
```

Abra `http://localhost:3000/eko`, informe `NOX_API_TOKEN`, ligue o Eko e acompanhe VAD, segmentos, transcript, KEEP/DISCARD e memória. Segure o botão ACTIVE para fazer uma pergunta; somente esse fluxo pode tocar áudio ou pedir confirmação.

Verificação real opcional, com secrets apenas no `.env`:

```bash
pnpm verify:eko -- ./sample.wav --duration-ms=5000
pnpm verify:eko -- ./question.wav --duration-ms=4000 --active
pnpm verify:memory:provider
pnpm verify:memory:provider -- --postgres
```

O verificador sempre tenta retornar Eko para `OFF` no final.

## Teste na VPS

1. Execute `pnpm db:migrate` usando a `DATABASE_URL` de produção.
2. Configure/reinicie o container com as envs acima.
3. Abra `https://dudunox.duckdns.org/eko` com permissão de microfone.
4. Em AMBIENT diga um fato específico e confirme que não há TTS/ação.
5. Consulte `GET /v1/eko/transcripts` e `GET /v1/memories?source=eko`.
6. Faça uma pergunta pelo botão ACTIVE e confira retrieval/TTS.
7. Diga ambientalmente “liga o ar” e confirme zero confirmação/ação; repita em ACTIVE e confira o Permission Engine.

## Browser e Pendant

O browser pode reduzir timers em background, suspender áudio com tela bloqueada, exigir gesto para autoplay, revogar microfone e consumir bateria. É uma bancada, não um cliente always-on.

O Pendant continuará restrito a VAD, wake word, ring buffer e transporte autenticado de segmentos. Ele não recebe OpenRouter key, não acessa Supabase, não classifica memória, não executa AgentRuntime/tools e não decide retenção. O Core permanece o cérebro e o policy boundary.

Referências: [OpenRouter embeddings](https://openrouter.ai/docs/api_reference/embeddings), [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [Supabase semantic search](https://supabase.com/docs/guides/ai/semantic-search), [Supabase vector indexes](https://supabase.com/docs/guides/ai/vector-indexes), [Porcupine Web](https://picovoice.ai/docs/quick-start/porcupine-web/).
