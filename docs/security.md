# Segurança

- Secrets existem apenas no ambiente e `.env` é ignorado.
- Rotas `/v1/*` exigem Bearer token comparado em tempo constante. O token associa `userId` e `deviceId` no servidor; headers do cliente não definem identidade.
- `sessionId` é um UUID de correlação validado ou gerado pela API, não uma credencial.
- Todo argumento de tool é não confiável e passa por Zod.
- A LLM não executa rede, shell ou integrações diretamente.
- READ é automático; ACTION segue política do usuário; EXTERNAL confirma por padrão.
- Confirmações possuem usuário, ID único, expiração, status de uso único e hash dos argumentos.
- Auditoria remove recursivamente campos com nomes sensíveis.
- Erros HTTP não expõem stack traces.
- Tool calling e chamadas ao provedor têm limites de iteração/tempo.

Limites conhecidos do MVP: o token estático serve a uma identidade/dispositivo e ainda não possui rotação ou revogação por banco; a memória de conversa continua in-memory; rate limiting ainda não existe. A API deve permanecer atrás de HTTPS e do proxy reverso.

No Supabase, service-role e connection strings existem somente no backend. Storage será privado por padrão; RLS será ativado quando clientes tiverem acesso direto. RLS complementa, mas nunca substitui, validação do core e Permission Engine. Um `device_id` enviado pelo cliente nunca constitui prova de identidade.

Nenhuma futura tool de desenvolvimento poderá mesclar PRs, alterar secrets, fazer deploy de produção, mudar permissões ou remover controles de segurança sem aprovação humana fora da LLM.
