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
```

O Compose fixa `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000`, `PERSISTENCE_DRIVER=postgres` e `RUN_DATABASE_MIGRATIONS=true`. As migrations rodam antes de a API escutar a porta.

## Execução local

```bash
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3000/health
```

O serviço usa filesystem somente leitura, remove capabilities Linux, impede privilege escalation e publica a API apenas em `127.0.0.1:3000`.

Na VPS, o daemon Docker roda como serviço de usuário com `loginctl enable-linger`. Isso substitui `screen`: o daemon inicia no boot e o Compose aplica `restart: unless-stopped`, sem conceder ao usuário de CI acesso ao Docker root da máquina.

## CI/CD

Pull requests executam typecheck, lint, testes e build. Pushes na `main` publicam duas tags no GHCR:

- `sha-<commit>`: tag imutável usada no deploy;
- `latest`: conveniência, nunca usada como referência de rollback.

O environment `production` do GitHub precisa destes secrets:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_PRIVATE_KEY`
- `VPS_KNOWN_HOSTS`

O deploy atualiza o checkout da VPS para o SHA exato, baixa a imagem, inicia o container e aguarda `/health`. Se o healthcheck falhar, `scripts/deploy.sh` restaura a imagem anterior automaticamente.

Rollback manual:

```bash
cd /opt/nox
bash scripts/rollback.sh
```

## Validação de persistência

Com `DATABASE_URL` apontando para o ambiente de teste ou desenvolvimento:

```bash
pnpm verify:persistence
```

O script cria uma confirmação, encerra a primeira instância da API, inicia outra, resolve a confirmação e confere auditoria/status diretamente no PostgreSQL. Os registros temporários são removidos ao final.
