# Segurança

- Secrets existem apenas no ambiente e `.env` é ignorado.
- Todo argumento de tool é não confiável e passa por Zod.
- A LLM não executa rede, shell ou integrações diretamente.
- READ é automático; ACTION segue política do usuário; EXTERNAL confirma por padrão.
- Confirmações possuem usuário, ID único, expiração, status de uso único e hash dos argumentos.
- Auditoria remove recursivamente campos com nomes sensíveis.
- Erros HTTP não expõem stack traces.
- Tool calling e chamadas ao provedor têm limites de iteração/tempo.

Limites conhecidos do MVP: identidade via header não é autenticação; stores em memória não sobrevivem a reinício e não suportam múltiplas réplicas; rate limiting ainda não existe. O servidor deve permanecer local até esses itens serem concluídos.

No Supabase, service-role e connection strings existem somente no backend. Storage será privado por padrão; RLS será ativado quando clientes tiverem acesso direto. RLS complementa, mas nunca substitui, validação do core e Permission Engine. Um `device_id` enviado pelo cliente nunca constitui prova de identidade.

Nenhuma futura tool de desenvolvimento poderá mesclar PRs, alterar secrets, fazer deploy de produção, mudar permissões ou remover controles de segurança sem aprovação humana fora da LLM.
