# Deploy do NOX

## Pré-requisitos

- PostgreSQL/Supabase migrado e acessível pela VPS.
- Docker Engine rootless com Compose para o usuário de deploy.
- Um arquivo `/opt/nox/.env` legível somente pelo usuário de deploy.
- A porta do container ligada somente a `127.0.0.1`; exposição pública deve passar por HTTPS no proxy reverso.

Variáveis obrigatórias de produção:

```dotenv
DATABASE_URL=postgresql://...
OPENROUTER_API_KEY=...
NOX_API_TOKEN=uma-chave-aleatoria-com-pelo-menos-32-caracteres
NOX_USER_ID=owner
NOX_DEVICE_ID=vps
CONVERSATION_CONTEXT_MESSAGES=20
MODEL_STT=openai/gpt-4o-mini-transcribe
MODEL_TTS=hexgrad/kokoro-82m
VOICE_LANGUAGE=pt
VOICE_TTS_VOICE=pf_dora
VOICE_MAX_UPLOAD_BYTES=2000000
VOICE_MAX_TTS_CHARACTERS=4000
```

`MODEL_DEFAULT` substitui gradualmente `OPENROUTER_MODEL`; enquanto não estiver definido, o valor antigo continua sendo usado. `MODEL_FAST`, `MODEL_REASONING`, `MODEL_CODING`, `MODEL_MEMORY` e `MODEL_VISION` são opcionais. `MODEL_STT` e `MODEL_TTS` possuem defaults explícitos e podem ser trocados independentemente. Capacidades multimodais não usam fallback silencioso para modelos de texto.

O Compose fixa `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000`, `PERSISTENCE_DRIVER=postgres` e `RUN_DATABASE_MIGRATIONS=true`. As migrations rodam antes de a API escutar a porta.

### Estratégia de migrations

A migration `0001_redundant_husk.sql` é aditiva: cria `conversations`, `messages`, `ai_usage`, seus índices e adiciona `confirmations.conversation_id` como nullable. Não altera nem remove dados existentes. Por isso ela é compatível com o mecanismo atual de migration no startup. Antes do primeiro deploy, recomenda-se confirmar backup/PITR do Supabase e executar `pnpm db:migrate` manualmente; o startup continuará idempotente caso a migration já esteja aplicada.

A migration `0002_brave_beyonder.sql` também é aditiva e acrescenta unidades faturáveis a `ai_usage` para segundos de STT e caracteres de TTS.

## Execução local

```bash
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3000/health
```

O serviço usa filesystem somente leitura, remove capabilities Linux, impede privilege escalation e publica a API apenas em `127.0.0.1:3000`.

Na VPS, o daemon Docker roda como serviço de usuário com `loginctl enable-linger`. Isso substitui `screen`: o daemon inicia no boot e o Compose aplica `restart: unless-stopped`, sem conceder ao usuário de CI acesso ao Docker root da máquina.

## CI/CD

Pull requests executam typecheck, lint, testes, build e verificação de formatação. Pushes na `main` repetem essas validações e publicam duas tags no GHCR:

- `sha-<commit>`: tag imutável usada no deploy;
- `latest`: conveniência, nunca usada como referência de rollback.

O environment `production` do GitHub precisa destes secrets:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_PRIVATE_KEY`
- `VPS_KNOWN_HOSTS`

O deploy atualiza o checkout da VPS para o SHA exato, baixa a imagem, inicia o container e aguarda `/health`. Se o healthcheck falhar, `scripts/deploy.sh` restaura a imagem anterior automaticamente.

O SHA do commit é gravado em `APP_VERSION` durante o build. O deploy só conclui quando `https://dudunox.duckdns.org/health` responde `200` e informa exatamente esse SHA. O rollback automático também confirma que a imagem anterior voltou a responder antes de encerrar.

## Fluxo de PR e proteção da main

- Mudanças normais entram por pull request.
- O CI precisa passar antes do merge.
- O merge é uma decisão humana; automações podem criar branch, implementar, testar e abrir PR, mas não fazem auto-merge.
- Somente um push já integrado à `main` publica e implanta uma imagem.
- Agentes não alteram branch protection, secrets, aprovações do environment nem autorizam o próprio deploy.

No GitHub, recomenda-se proteger `main`, exigir o check `CI / validate`, exigir pull request e bloquear force pushes. O environment `production` pode exigir aprovação humana caso se deseje uma segunda barreira antes do deploy.

Rollback manual:

```bash
cd /opt/nox
bash scripts/rollback.sh
```

O rollback manual sobe a imagem registrada em `.previous-image`, espera o healthcheck local e troca os registros de imagem atual/anterior, permitindo desfazer o rollback com o mesmo comando se necessário.

## Validação de persistência

Com `DATABASE_URL` apontando para o ambiente de teste ou desenvolvimento:

```bash
pnpm verify:persistence
```

O script cria uma confirmação, encerra a primeira instância da API, inicia outra, resolve a confirmação e confere auditoria/status diretamente no PostgreSQL. Os registros temporários são removidos ao final.
