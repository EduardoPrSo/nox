'use client';

import {
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  Languages,
  LockKeyhole,
  Mic2,
  Radio,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { mockAgentProfile } from '@/lib/mock-data';
import { PageHeader } from './page-header';

const sections = [
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'voice', label: 'Voice', icon: Mic2 },
  { id: 'models', label: 'Models', icon: Sparkles },
  { id: 'privacy', label: 'Privacy', icon: LockKeyhole },
  { id: 'eko', label: 'Eko', icon: Radio },
  { id: 'budget', label: 'Budget', icon: CircleDollarSign },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'account', label: 'Account', icon: UserRound },
] as const;

export function SettingsWorkspace() {
  const [active, setActive] = useState<(typeof sections)[number]['id']>('agent');
  const [saved, setSaved] = useState(false);
  const [ekoEnabled, setEkoEnabled] = useState(true);

  function save() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1_800);
  }

  return (
    <div className="settings-page page-stack">
      <PageHeader
        eyebrow="Seu Nox"
        title="Settings"
        description="Ajuste o agente à sua rotina sem precisar lidar com configurações técnicas."
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Seções de configuração">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                data-active={active === section.id}
                type="button"
                onClick={() => setActive(section.id)}
              >
                <Icon aria-hidden="true" size={17} />
                <span>{section.label}</span>
                <ChevronRight aria-hidden="true" size={15} />
              </button>
            );
          })}
        </nav>

        <section className="settings-content" aria-live="polite">
          {active === 'agent' ? (
            <>
              <div className="settings-section-heading">
                <span className="settings-icon">
                  <Bot aria-hidden="true" size={20} />
                </span>
                <div>
                  <h2>Agent profile</h2>
                  <p>A identidade e o jeito do seu agente pessoal.</p>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  <span>Nome do agente</span>
                  <input defaultValue={mockAgentProfile.name} />
                  <small>NOX é o produto; este é o nome que seu agente usa.</small>
                </label>
                <label>
                  <span>Idioma preferido</span>
                  <div className="select-wrap">
                    <Languages aria-hidden="true" size={16} />
                    <select defaultValue={mockAgentProfile.preferredLanguage}>
                      <option>Português (Brasil)</option>
                      <option>English (US)</option>
                      <option>Español</option>
                    </select>
                  </div>
                </label>
                <label>
                  <span>Estilo de resposta</span>
                  <select defaultValue={mockAgentProfile.responseStyle}>
                    <option>Concise</option>
                    <option>Balanced</option>
                    <option>Detailed</option>
                  </select>
                </label>
                <label>
                  <span>Fuso horário</span>
                  <select defaultValue={mockAgentProfile.timezone}>
                    <option>America/Sao_Paulo</option>
                    <option>America/New_York</option>
                    <option>Europe/Lisbon</option>
                  </select>
                </label>
              </div>
              <div className="personality-panel">
                <div>
                  <SlidersHorizontal aria-hidden="true" size={18} />
                  <span>
                    <strong>Personalidade</strong>
                    <small>Calmo, direto e atento ao contexto.</small>
                  </span>
                </div>
                <button type="button">Ajustar</button>
              </div>
            </>
          ) : null}

          {active === 'voice' ? (
            <>
              <div className="settings-section-heading">
                <span className="settings-icon">
                  <Mic2 aria-hidden="true" size={20} />
                </span>
                <div>
                  <h2>Voice</h2>
                  <p>Como seu agente fala e responde por áudio.</p>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  <span>Voz</span>
                  <select defaultValue="Dora">
                    <option>Dora</option>
                    <option>Alex</option>
                    <option>Maya</option>
                  </select>
                </label>
                <label>
                  <span>Respostas faladas</span>
                  <select defaultValue="Concisas">
                    <option>Concisas</option>
                    <option>Equilibradas</option>
                    <option>Completas</option>
                  </select>
                </label>
              </div>
              <button className="voice-preview" type="button">
                <span className="voice-bars">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>{' '}
                Ouvir amostra da voz
              </button>
            </>
          ) : null}

          {active === 'models' ? (
            <>
              <div className="settings-section-heading">
                <span className="settings-icon">
                  <Sparkles aria-hidden="true" size={20} />
                </span>
                <div>
                  <h2>Model policy</h2>
                  <p>Escolha a prioridade; o router cuida dos modelos.</p>
                </div>
              </div>
              <div className="policy-options">
                {(['Economy', 'Balanced', 'Performance'] as const).map((policy) => (
                  <label key={policy} data-current={policy === mockAgentProfile.modelPolicy}>
                    <input
                      type="radio"
                      name="policy"
                      defaultChecked={policy === mockAgentProfile.modelPolicy}
                    />
                    <span>
                      <strong>{policy}</strong>
                      <small>
                        {policy === 'Economy'
                          ? 'Menor custo para tarefas cotidianas.'
                          : policy === 'Balanced'
                            ? 'Equilíbrio recomendado entre qualidade e custo.'
                            : 'Mais capacidade quando qualidade é prioridade.'}
                      </small>
                    </span>
                    {policy === 'Balanced' ? <em>Recomendado</em> : null}
                  </label>
                ))}
              </div>
            </>
          ) : null}

          {active === 'eko' ? (
            <>
              <div className="settings-section-heading">
                <span className="settings-icon settings-icon-eko">
                  <Radio aria-hidden="true" size={20} />
                </span>
                <div>
                  <h2>Eko</h2>
                  <p>Escuta ambiental controlada e memória seletiva.</p>
                </div>
              </div>
              <div className="setting-toggle-row">
                <div>
                  <strong>Eko neste dispositivo</strong>
                  <span>
                    {ekoEnabled
                      ? 'Microfone ambiental ativo com VAD local.'
                      : 'Nenhuma captura ambiental.'}
                  </span>
                </div>
                <button
                  className="toggle"
                  data-enabled={ekoEnabled}
                  type="button"
                  role="switch"
                  aria-checked={ekoEnabled}
                  onClick={() => setEkoEnabled(!ekoEnabled)}
                >
                  <i />
                </button>
              </div>
              <div className="privacy-summary">
                <LockKeyhole aria-hidden="true" size={18} />
                <div>
                  <strong>Áudio bruto não é armazenado</strong>
                  <p>
                    Transcrições temporárias expiram em 24 horas. Só memórias selecionadas
                    permanecem.
                  </p>
                </div>
              </div>
            </>
          ) : null}

          {active === 'permissions' ? (
            <>
              <div className="settings-section-heading" id="permissions">
                <span className="settings-icon">
                  <ShieldCheck aria-hidden="true" size={20} />
                </span>
                <div>
                  <h2>Permissions</h2>
                  <p>O mesmo Permission Engine, explicado em linguagem humana.</p>
                </div>
              </div>
              <div className="permission-groups">
                <PermissionRow service="WhatsApp" capability="Localizar contatos" value="Allow" />
                <PermissionRow service="WhatsApp" capability="Enviar mensagens" value="Ask" />
                <PermissionRow
                  service="Google Calendar"
                  capability="Visualizar eventos"
                  value="Allow"
                />
                <PermissionRow service="Google Calendar" capability="Criar eventos" value="Ask" />
                <PermissionRow service="Google Calendar" capability="Excluir eventos" value="Ask" />
              </div>
            </>
          ) : null}

          {active === 'budget' ? (
            <>
              <div className="settings-section-heading">
                <span className="settings-icon">
                  <CircleDollarSign aria-hidden="true" size={20} />
                </span>
                <div>
                  <h2>Monthly budget</h2>
                  <p>Limites claros sem bloquear silenciosamente tarefas importantes.</p>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  <span>Orçamento mensal</span>
                  <div className="money-input">
                    <i>US$</i>
                    <input defaultValue="15.00" inputMode="decimal" />
                  </div>
                </label>
                <label>
                  <span>Soft limit</span>
                  <div className="money-input">
                    <i>US$</i>
                    <input defaultValue="12.00" inputMode="decimal" />
                  </div>
                </label>
              </div>
              <div className="budget-behavior">
                <strong>Ao atingir o soft limit</strong>
                <p>
                  O Nox prioriza modelos econômicos quando for seguro e mostra a mudança na
                  interface.
                </p>
              </div>
            </>
          ) : null}

          {active === 'privacy' || active === 'account' ? (
            <>
              <div className="settings-section-heading">
                <span className="settings-icon">
                  {active === 'privacy' ? (
                    <LockKeyhole aria-hidden="true" size={20} />
                  ) : (
                    <UserRound aria-hidden="true" size={20} />
                  )}
                </span>
                <div>
                  <h2>{active === 'privacy' ? 'Privacy' : 'Account'}</h2>
                  <p>
                    {active === 'privacy'
                      ? 'Retenção, memória e controles dos seus dados.'
                      : 'Identidade e segurança da sua conta NOX.'}
                  </p>
                </div>
              </div>
              <div className="coming-panel">
                <LockKeyhole aria-hidden="true" size={22} />
                <div>
                  <strong>Preparado para a etapa 6B</strong>
                  <p>
                    Esta área receberá Auth real, sessões, reset de senha e controles persistentes
                    após a aprovação visual.
                  </p>
                </div>
              </div>
            </>
          ) : null}

          <footer className="settings-footer">
            <span>
              {saved ? (
                <>
                  <Check aria-hidden="true" size={15} /> Preferências salvas neste mock
                </>
              ) : (
                'Mudanças locais de demonstração'
              )}
            </span>
            <button className="primary-button" type="button" onClick={save}>
              <Save aria-hidden="true" size={16} /> Salvar alterações
            </button>
          </footer>
        </section>
      </div>
    </div>
  );
}

function PermissionRow({
  service,
  capability,
  value,
}: {
  service: string;
  capability: string;
  value: 'Allow' | 'Ask' | 'Disable';
}) {
  return (
    <div className="permission-row">
      <div>
        <small>{service}</small>
        <strong>{capability}</strong>
      </div>
      <select defaultValue={value} aria-label={`${service}: ${capability}`}>
        <option>Allow</option>
        <option>Ask</option>
        <option>Disable</option>
      </select>
    </div>
  );
}
