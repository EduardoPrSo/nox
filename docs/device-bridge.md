# Device Bridge e Midea

## Arquitetura escolhida

O bridge é um worker Python dentro da rede residencial. Ele mantém long polls HTTPS de saída para o NOX Core, recebe no máximo um comando pendente, fala com o Midea pela LAN, relê o estado e envia um resultado estruturado.

```text
usuário → NOX Core → Permission Engine → confirmação
                                      ↓ aprovada
                         broker de comando em memória
                                      ↑ long poll HTTPS autenticado
                         Device Bridge na rede residencial
                                      ↓ Midea LAN :6444
                         apply → refresh → comparação do estado
                                      ↓ resultado confirmado
                         audit → resposta curta → TTS
```

Não há porta aberta na residência e a VPS nunca tenta acessar um IP privado. TLS e a validação normal de hostname autenticam o Core para o bridge; um Bearer token exclusivo autentica o bridge para o Core. O token não é `NOX_API_TOKEN`, OpenRouter, Supabase ou credencial Midea.

### Trade-offs considerados

- **Long polling HTTPS — escolhido:** só exige saída HTTPS, usa o domínio/Nginx existentes, é simples de depurar e não cria um servidor na residência. O custo é um broker stateful e alguns segundos de reconexão em falhas.
- **WebSocket reverso:** reduz overhead e permite push imediato, mas adiciona lifecycle de conexão, heartbeat e configuração de proxy sem ganho material para poucos comandos domésticos.
- **Tailscale/WireGuard:** oferece uma boa rede privada e será atraente com muitos serviços locais, mas adiciona instalação, identidade de nós e roteamento entre o container e a tailnet para um único aparelho.

O broker atual é em memória e suporta uma instância do Core. Reinício, deploy, bridge offline ou resultado perdido expira o comando como falha; o NOX não declara sucesso. Multi-réplica exigirá mover fila/resultado para PostgreSQL, Redis ou broker dedicado.

## Contratos

As tools canônicas são:

- `climate.get_state` — `READ`;
- `climate.turn_on` — `ACTION`;
- `climate.turn_off` — `ACTION`;
- `climate.set_temperature` — `ACTION`;
- `climate.set_mode` — `ACTION`.

Todas as mutações continuam sujeitas ao Permission Engine e à configuração segura existente; voz não aprova nada. Na fronteira do OpenRouter, pontos são escapados para nomes function-call-safe e restaurados antes do registry. Memória, auditoria e confirmações usam somente os nomes canônicos.

O Core expõe endpoints separados da API do usuário:

```text
GET  /bridge/v1/bridges/:bridgeId/commands/next
POST /bridge/v1/bridges/:bridgeId/commands/:commandId/result
```

Um resultado com `success=true` só é aceito com `confirmed=true` e um `state` válido. O adapter Midea executa `apply()`, chama `refresh()` e compara power/temperatura/modo. Divergência retorna `STATE_NOT_CONFIRMED`. Timeout, aparelho offline, autenticação, comando recusado e resposta inválida também retornam códigos de falha distintos.

O audit trail existente registra usuário, request, tool, argumentos sanitizados, decisão de permissão, confirmação, duração e resultado. O resultado inclui `bridgeId`, `deviceId`, `commandId` e readback; tokens/key nunca entram no Core ou no payload do comando.

## Configuração do Core

Gere um segredo novo e copie o mesmo valor somente para o `.env` da VPS e o `.env` do bridge:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

No Core:

```dotenv
CLIMATE_DRIVER=bridge
NOX_DEVICE_BRIDGE_TOKEN=<segredo-exclusivo>
NOX_DEVICE_BRIDGE_ID=home
NOX_CLIMATE_DEVICE_ID=home-ac
DEVICE_BRIDGE_COMMAND_TIMEOUT_MS=45000
DEVICE_BRIDGE_LONG_POLL_MS=25000
```

`CLIMATE_DRIVER=mock` permanece o padrão de desenvolvimento/testes. O Core não recebe `MIDEA_DEVICE_IP`, token ou key.

## Instalação no Windows

Requer Python 3.10–3.14; o projeto foi validado com Python 3.13.5.

```powershell
cd apps/device-bridge
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
Copy-Item .env.example .env
```

Edite `.env` localmente. Ele é ignorado pelo Git. As dependências estão fixadas em `pyproject.toml`: `msmart-ng==2026.8.0`, `httpx==0.28.1` e `python-dotenv==1.2.2`; pytest é opcional de teste.

Descubra o aparelho na mesma rede local:

```powershell
.\.venv\Scripts\msmart-ng.exe discover
```

Confirme que o tipo é `0xAC` ou `0xCC` e `supported=true`. Salve IP, porta e ID. Dispositivos V3 também exigem token e key; trate ambos como secrets e não os cole em issues, chat, logs ou commits.

O verificador manual é somente leitura: autentica, busca capabilities, executa `refresh()` e imprime estado sem credenciais.

```powershell
.\.venv\Scripts\nox-verify-midea.exe
```

Depois do read-only funcionar, inicie o worker:

```powershell
.\.venv\Scripts\nox-device-bridge.exe
```

Os logs são JSON estruturado e mostram IDs, ação, confirmação e duração, sem secrets. Para operação contínua no Windows, configure esse executável no Agendador de Tarefas com início no diretório `apps\device-bridge` e reinício em falha. Em Raspberry Pi/mini-PC, use um serviço `systemd` com o mesmo `.env` protegido por permissões do usuário.

## Testes

Sem hardware:

```powershell
cd apps/device-bridge
.\.venv\Scripts\python.exe -m pytest
```

Core + bridge + Midea real:

1. Configure e reinicie o Core com `CLIMATE_DRIVER=bridge`.
2. Deixe `nox-device-bridge` rodando na rede do aparelho.
3. Abra `https://dudunox.duckdns.org/voice`.
4. Diga “NOX, coloca o ar em 23 graus”.
5. Confirme no cliente. O bridge deve registrar o comando, aplicar e reler 23 °C.
6. O cliente deve falar “Pronto, 23 graus.” somente após o POST de resultado confirmado.
7. Pergunte “Como está o ar?”. A resposta vem do novo readback.
8. Confira `audit_logs` para `permission`, `confirmation_created` e `tool_result` correlacionados pelo `requestId`.

O teste automatizado não requer aparelho real. A aceitação física permanece dependente de executar o verificador e o fluxo acima na LAN do Midea.

## Resiliência e riscos

- O bridge aplica backoff exponencial quando o Core fica indisponível e não reexecuta uma ação só porque o envio do resultado falhou.
- O POST de resultado tem três tentativas; se todas falharem, o Core expira o comando como falha.
- Credencial rejeitada encerra o worker para evitar loop agressivo; corrija o token e reinicie.
- A biblioteca `msmart-ng` é uma integração LAN não oficial. Atualizações devem ser deliberadas, fixadas e verificadas primeiro em modo read-only.
- O PC precisa permanecer ligado para automações reais. Um host always-on será necessário antes de tratar climate como infraestrutura doméstica confiável.
- Para o futuro Pendant, nada muda no cliente: ele continua falando apenas com o Core. Identidade, confirmação e audit ficam centralizados; o bridge permanece um executor sem autoridade.
