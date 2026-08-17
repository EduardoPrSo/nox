# NOX Web — Milestone 6A

O `apps/web` é o shell oficial do produto NOX. O 6A entrega direção visual, navegação, PWA e estados de interface com dados mockados. Ele não implementa autenticação real, migrations multi-account, connectors externos ou comunicação com a API.

## Stack

- Next.js 16 com App Router;
- React 19 e TypeScript estrito;
- Tailwind CSS 4, complementado por tokens CSS do produto;
- Lucide para ícones leves e consistentes;
- Vitest, Testing Library e JSDOM para testes de comportamento.

O app possui `package.json`, `tsconfig` e build próprios dentro do workspace pnpm. A API Fastify e seu container continuam independentes.

## Rotas do 6A

| Rota                    | Objetivo                                                                  |
| ----------------------- | ------------------------------------------------------------------------- |
| `/`                     | Home operacional, NOX Orb, quick interaction, presença do Eko e atividade |
| `/chat`                 | Conversa, contexto, voz e confirmação explícita mockada                   |
| `/connections`          | Catálogo e estados comuns de connectors                                   |
| `/connections/whatsapp` | Fluxo QR mockado, sem credenciais ou Uazapi                               |
| `/connections/google`   | Conta/scopes mockados e superfície para OAuth futuro                      |
| `/usage`                | Custo, projeção, budget e breakdowns mockados                             |
| `/settings`             | Agent Profile, Voice, Models, Privacy, Eko, Budget e Permissions          |
| `/offline`              | Fallback PWA; o agente não funciona offline                               |

Memory, Eko, Devices e Automations aparecem como destinos futuros, desabilitados e identificados como indisponíveis. Isso evita telas vazias ou rotas que parecem funcionais antes da integração real.

## Arquitetura de componentes

```text
RootLayout
└── AppShell
    ├── DesktopSidebar
    ├── MobileNavigation
    ├── Topbar
    └── route content
        ├── HomeExperience + NoxOrb
        ├── ChatWorkspace + confirmation UI
        ├── ConnectionsGrid / ConnectionDetail
        ├── UsageDashboard
        └── SettingsWorkspace
```

Dados de demonstração ficam em `src/lib/mock-data.ts`. Tipos de produto ficam em `src/lib/types.ts`; cálculos testáveis de usage ficam em `src/lib/usage.ts`. Nenhum componente contém token de API ou credential real.

## Design system

### Direção

A linguagem visual usa superfícies escuras contínuas, bordas discretas, baixa densidade de cards e glow apenas em estados vivos. O Orb é o elemento de marca e comunica `IDLE`, `LISTENING`, `THINKING`, `SPEAKING`, `EKO_ACTIVE` e `ERROR`.

### Tokens principais

```text
ink-950       #07080b    canvas
ink-900       #0b0c11    shell
ink-800       #15161e    surface
text          #f4f2fa    conteúdo principal
text-soft     #bbb8c8    conteúdo secundário
text-muted    #7f7c8d    metadata
violet        #9c8cff    inteligência/ação primária
eko           #5ee8c1    escuta/privacidade saudável
sky           #77baff    informação/integração
amber         #f6bd72    atenção/degraded
danger        #ff7e98    erro/revogação
```

Raios usam 12, 18 e 26 px. Transições usam uma curva suave `cubic-bezier(0.22, 1, 0.36, 1)`. Todas as animações são praticamente removidas quando `prefers-reduced-motion` está ativo.

## Desktop e mobile

Desktop usa sidebar permanente, área central ampla e painéis secundários apenas onde ajudam — como contexto no Chat. Mobile não comprime a sidebar: usa topbar própria, bottom navigation, telas em uma coluna, touch targets e confirmação full-width.

Breakpoints principais:

- acima de 1120 px: shell completo e contexto lateral;
- 801–1120 px: shell desktop compacto;
- até 800 px: navegação móvel e layouts touch-first;
- até 470 px: confirmação, usage e settings reorganizados para telas estreitas.

## PWA

O app expõe `manifest.webmanifest`, theme/background color, modo standalone, ícones PNG gerados pelo próprio Next para browser/iOS, SVG `any` e `maskable` no manifest, viewport com safe areas e um service worker mínimo.

O service worker só mantém o fallback `/offline` e os ícones. Ele não cacheia respostas do agente, áudio, memória, connectors ou dados privados. Permissão de notificação não é solicitada. Web Push permanece apenas como extensão arquitetural futura.

## Auth e multi-account futuros

`src/lib/auth.ts` define o contrato de sessão usado para orientar o 6B. O mock atual nunca é enviado para a API.

No 6B:

1. Supabase Auth entrega uma sessão ao frontend;
2. o access token segue no header `Authorization`;
3. a API valida assinatura, issuer, audience, expiração e revogação;
4. `userId` é derivado do `sub` autenticado;
5. nenhum endpoint aceita `userId` fornecido pelo navegador;
6. repositories continuam aplicando ownership, com RLS como defesa adicional.

Dados existentes e ownership não foram alterados no 6A. A estratégia de migração da primeira conta deve ser apresentada antes de qualquer migration correspondente.

## Mock data e limites

Os valores de conversa, memória, custo, budget, dispositivos, QR e connectors são demonstrações visuais. O QR é propositalmente não escaneável. Botões de connect/disconnect, settings e quick interaction alteram apenas estado React local.

Não existem no 6A:

- signup/login/logout;
- chamadas para Supabase, Uazapi ou Google;
- persistência de settings;
- armazenamento de connector credentials;
- realtime;
- integração real com Voice/Eko/API.

## Desenvolvimento

```bash
pnpm install
pnpm dev:web
```

Abra `http://localhost:3000`. Para usar outra porta:

```bash
pnpm --filter @nox/web dev --port 3100
```

Validação:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm build:web
pnpm format:check
```

Referências de implementação: [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps), [Tailwind with Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs) e [React versions](https://react.dev/versions).

## Produção

O frontend usa o output `standalone` do Next.js e é publicado na imagem `ghcr.io/eduardoprso/nox-web`. O container escuta apenas em `127.0.0.1:3001` na VPS; o Nginx entrega a interface em `https://dudunox.duckdns.org/` e preserva as rotas da API no mesmo domínio.

`GET /web-health` é o healthcheck operacional do frontend e informa o SHA implantado. Ele não acessa banco, sessão ou dados privados.
