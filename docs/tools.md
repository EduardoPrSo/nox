# Tools

Uma tool declara nome estável, descrição, schema Zod, nível de permissão e executor. Registre novas tools no `ToolRegistry`; o `AgentRuntime` não precisa mudar.

| Tool                      | Nível    | Efeito                        |
| ------------------------- | -------- | ----------------------------- |
| `get_current_time`        | READ     | Horário atual                 |
| `get_weather_mock`        | READ     | Clima fictício                |
| `climate_get_status`      | READ     | Estado fictício do ar         |
| `climate_set_temperature` | ACTION   | Altera estado em memória      |
| `send_message_mock`       | EXTERNAL | Simula envio após confirmação |

Integrações reais devem ter adapters próprios, credenciais de menor privilégio, timeout, idempotência quando aplicável e sanitização específica de auditoria.
