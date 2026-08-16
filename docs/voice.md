# Voice MVP

O Voice MVP implementa uma interação completa em uma requisição:

```text
microfone/arquivo → POST /v1/voice → STT → AgentRuntime → TTS → texto + áudio
```

Ele não cria um agente paralelo. A transcrição é entregue ao mesmo `AgentRuntime` usado por `/v1/chat`, portanto conversa, memória, tools, Permission Engine, confirmação e auditoria se comportam da mesma forma nos dois canais.

## Providers e modelos

O adapter atual usa os endpoints dedicados do OpenRouter:

- STT: `POST /api/v1/audio/transcriptions`, default `openai/gpt-4o-mini-transcribe`, com hint de idioma `pt`;
- TTS: `POST /api/v1/audio/speech`, default `hexgrad/kokoro-82m`, voz brasileira `pf_dora` e saída MP3.

Os contratos `SpeechToTextProvider` e `TextToSpeechProvider` são independentes de `AIProvider` e um do outro. `MODEL_STT` e `MODEL_TTS` passam pelo `ConfiguredModelRouter`, permitindo trocar cada modelo ou criar outro adapter sem mudar o runtime.

Em 16 de agosto de 2026, o OpenRouter lista o GPT-4o Mini Transcribe a US$ 1,25 por milhão de tokens de entrada e US$ 5 por milhão de tokens de saída; o Kokoro 82M custa US$ 0,62 por milhão de caracteres. Preços podem mudar. O NOX persiste o custo retornado pelo STT quando disponível; para TTS persiste a quantidade de caracteres, pois o endpoint devolve bytes, sem objeto de usage. Consulte as páginas atuais de [STT](https://openrouter.ai/openai/gpt-4o-mini-transcribe/api), [TTS](https://openrouter.ai/hexgrad/kokoro-82m/api) e a [documentação de áudio do OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/stt).

Nenhum provider adicional ou nova credencial é necessário neste milestone. Ambos usam `OPENROUTER_API_KEY`.

## Contrato HTTP

`POST /v1/voice` exige `Authorization: Bearer ...` e `multipart/form-data`:

- `audio`: exatamente um arquivo;
- `conversationId`: UUID opcional para continuar uma conversa existente.

O servidor aceita, com validação de MIME e assinatura:

- WAV (`audio/wav`);
- WebM/Opus (`audio/webm`), usado pela maioria dos navegadores;
- MP3 (`audio/mpeg`);
- M4A/MP4 (`audio/mp4`), fallback para Safari/iOS.

O limite padrão é 2.000.000 bytes por arquivo. Ele fica abaixo do `client_max_body_size 2m` do proxy, considerando o overhead multipart. O cliente encerra gravações em 60 segundos. Respostas textuais acima de 4.000 caracteres são truncadas somente para síntese; o texto completo continua na resposta e em memória.

Resposta normal:

```json
{
  "type": "message",
  "transcription": "Que horas são?",
  "assistantText": "Agora são...",
  "conversationId": "uuid",
  "requestId": "uuid",
  "audio": { "mimeType": "audio/mpeg", "data": "base64..." },
  "audioTextTruncated": false,
  "latencyMs": { "stt": 420, "agent": 850, "tts": 610, "total": 1880 }
}
```

Foi escolhido JSON com áudio base64 porque mantém transcrição, resposta, IDs, confirmação e latências em um único contrato e dispensa Storage/URLs temporárias. O custo é cerca de 33% de overhead no áudio de saída, aceitável para turnos curtos do MVP; streaming futuro deverá retornar bytes/chunks diretamente.

Uma ação sensível devolve `type: "confirmation_required"`, `confirmationId`, descrição e expiração, além de uma fala pedindo confirmação. O áudio nunca aprova a ação. A decisão continua sendo um POST autenticado explícito em `/v1/confirmations/:id`.

Falhas de STT retornam `502 STT_FAILED` e podem ser repetidas. Se o agente já concluiu e o TTS falha, a API retorna `502 TTS_FAILED` com transcrição, texto e IDs, `audio: null` e `retryable: false`; repetir a interação inteira poderia duplicar uma ação já processada.

## Telemetria

Todas as chamadas usam o mesmo `requestId`. O LLM registra a capability escolhida pelo runtime; STT e TTS geram linhas separadas em `ai_usage`, com modelo, provider, usuário, dispositivo, sessão, conversa, latência, tokens/custo quando fornecidos e unidades (`seconds` ou `characters`) quando aplicáveis. Falha ao persistir telemetria é best-effort e não derruba a resposta.

A resposta expõe latências de STT, agente, TTS e total. Elas medem o tempo observado pelo NOX e incluem rede/provider; são úteis para escolher modelos e decidir quando streaming será necessário.

Smoke test real em 16 de agosto de 2026, a partir da máquina de desenvolvimento e com uma frase curta sintetizada: STT 723 ms, agente 1.874 ms, TTS 1.741 ms, total 4.338 ms; resposta MP3 de 51.120 bytes. É uma única amostra de conectividade, não um benchmark. Meça p50/p95 com tráfego real antes de otimizar ou escolher streaming.

## Cliente push-to-talk

`GET /voice` serve uma página sem build frontend. Ela funciona em desktop e mobile sobre HTTPS, solicita o microfone, grava WebM/Opus ou M4A conforme o navegador, mantém `conversationId`/`sessionId` durante a sessão e toca o MP3 retornado. O token informado fica em `sessionStorage`, nunca no HTML ou no bundle.

Para testar localmente:

```bash
pnpm dev
# abra http://127.0.0.1:3000/voice
```

Ou use um arquivo real:

```bash
VOICE_TEST_AUDIO_PATH=./sample.webm pnpm verify:voice
```

Para a VPS:

```bash
NOX_BASE_URL=https://dudunox.duckdns.org \
VOICE_TEST_AUDIO_PATH=./sample.webm \
VOICE_OUTPUT_PATH=./nox-response.mp3 \
pnpm verify:voice
```

O script lê `NOX_API_TOKEN` do ambiente, valida metadados e áudio e só grava a resposta quando `VOICE_OUTPUT_PATH` é informado.

Com uma `OPENROUTER_API_KEY` válida, o smoke test abaixo gera uma frase curta e percorre TTS → upload → STT → agente → TTS inteiramente em memória, sem tocar no PostgreSQL:

```bash
pnpm verify:voice:provider
```

## Segurança e privacidade

Principais ameaças e controles do MVP:

- **endpoint descoberto ou personificação:** `/v1/voice` usa o mesmo Bearer token e identidade server-side das outras rotas; `conversationId` não concede acesso;
- **DoS por upload:** limite no Fastify e no proxy, um único arquivo e um único campo;
- **MIME forjado/arquivo arbitrário:** allowlist e magic bytes antes de enviar ao provider;
- **prompt injection falado:** a transcrição é input não confiável; o Permission Engine continua autoritativo;
- **erro de reconhecimento com efeito externo:** EXTERNAL sempre confirma e voz nunca faz auto-approve;
- **replay/retry depois de falha:** confirmação é de uso único; falha posterior de TTS é marcada como não repetível;
- **vazamento por logs/storage:** bytes de entrada e saída não são auditados nem persistidos pelo servidor; somente transcrição, resposta e metadados entram nos stores;
- **token no cliente:** fica em `sessionStorage`; não usar a página em dispositivos compartilhados e manter somente HTTPS;
- **terceiros:** áudio de entrada e texto de saída são enviados ao OpenRouter/provider e ficam sujeitos às políticas deles.

Rate limiting, rotação de token, consentimento/retention configurável e controles por usuário ainda são lacunas antes de acesso multiusuário público.

## Fora de escopo e próximo passo

Este milestone não implementa streaming, wake word, VAD server-side, Eko, Ambient Memory, pgvector, visão operacional, firmware ou autoevolução. O próximo passo natural de voz é medir uso real e então adicionar transporte streaming/turn detection atrás das mesmas interfaces, sem alterar o `AgentRuntime` nem enfraquecer confirmações.
