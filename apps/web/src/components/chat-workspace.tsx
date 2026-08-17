'use client';

import {
  Check,
  ChevronDown,
  Clock3,
  Mic,
  MoreHorizontal,
  Plus,
  Send,
  Snowflake,
  Sparkles,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { mockConversations } from '@/lib/mock-data';
import { NoxOrb } from './nox-orb';

export function ChatWorkspace() {
  const [confirmation, setConfirmation] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [draft, setDraft] = useState('');

  return (
    <div className="chat-shell">
      <aside className="conversation-rail" aria-label="Conversas">
        <div className="conversation-rail-heading">
          <span>Conversas</span>
          <button type="button" aria-label="Nova conversa">
            <Plus aria-hidden="true" size={17} />
          </button>
        </div>
        <label className="conversation-search">
          <span className="sr-only">Buscar conversas</span>
          <input placeholder="Buscar" />
          <kbd>⌘ K</kbd>
        </label>
        <div className="conversation-list">
          {mockConversations.map((conversation) => (
            <button
              key={conversation.id}
              className="conversation-item"
              data-current={conversation.active}
              type="button"
            >
              <span>
                <strong>{conversation.title}</strong>
                <small>{conversation.preview}</small>
              </span>
              {conversation.active ? <span className="conversation-dot" /> : null}
            </button>
          ))}
        </div>
        <div className="conversation-rail-note">
          <Sparkles aria-hidden="true" size={15} />
          <p>
            <strong>Memória conectada</strong>
            <span>5 itens relevantes neste contexto</span>
          </p>
        </div>
      </aside>

      <section className="chat-conversation" aria-label="Conversa com o Nox">
        <header className="chat-header">
          <div className="chat-identity">
            <NoxOrb state="IDLE" size="mini" label={false} />
            <div>
              <strong>Nox</strong>
              <span>
                <i /> Pronto
              </span>
            </div>
          </div>
          <button className="conversation-mobile-picker" type="button">
            Hoje <ChevronDown aria-hidden="true" size={15} />
          </button>
          <button className="icon-button" type="button" aria-label="Opções da conversa">
            <MoreHorizontal aria-hidden="true" size={19} />
          </button>
        </header>

        <div className="messages" aria-live="polite">
          <div className="date-divider">
            <span>Hoje, 22:31</span>
          </div>
          <article className="message message-user">
            <p>Como está minha manhã amanhã?</p>
          </article>
          <article className="message message-agent">
            <span className="message-mark">N</span>
            <div>
              <p>
                Você tem uma reunião com o time às 10h. O restante da manhã está livre e não
                encontrei nenhum conflito.
              </p>
              <div className="memory-provenance">
                <Sparkles aria-hidden="true" size={13} /> Agenda Google · 3 eventos consultados
              </div>
            </div>
          </article>
          <article className="message message-user">
            <p>Deixa o quarto em 23 graus.</p>
          </article>
          <article className="message message-agent">
            <span className="message-mark">N</span>
            <div>
              <p>Posso ajustar o ar do quarto para 23 °C.</p>
              <div className="confirmation-card" data-state={confirmation}>
                <div className="confirmation-icon">
                  <Snowflake aria-hidden="true" size={20} />
                </div>
                <div className="confirmation-copy">
                  <span>Confirmação necessária</span>
                  <strong>Definir ar do quarto em 23 °C</strong>
                  <small>
                    <Clock3 aria-hidden="true" size={13} /> Expira em 4:32 · Smart Home
                  </small>
                </div>
                {confirmation === 'pending' ? (
                  <div className="confirmation-actions">
                    <button type="button" onClick={() => setConfirmation('rejected')}>
                      <X aria-hidden="true" size={16} /> Cancelar
                    </button>
                    <button
                      className="confirm-primary"
                      type="button"
                      onClick={() => setConfirmation('approved')}
                    >
                      <Check aria-hidden="true" size={16} /> Confirmar
                    </button>
                  </div>
                ) : (
                  <span className="confirmation-result">
                    {confirmation === 'approved' ? (
                      <Check aria-hidden="true" size={16} />
                    ) : (
                      <X aria-hidden="true" size={16} />
                    )}
                    {confirmation === 'approved' ? 'Confirmado' : 'Cancelado'}
                  </span>
                )}
              </div>
            </div>
          </article>
        </div>

        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            setDraft('');
          }}
        >
          <label className="sr-only" htmlFor="chat-message">
            Mensagem
          </label>
          <textarea
            id="chat-message"
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Fale com o Nox…"
          />
          <div className="composer-actions">
            <button className="composer-tool" type="button" aria-label="Gravar áudio">
              <Mic aria-hidden="true" size={19} />
            </button>
            <button className="composer-send" type="submit" aria-label="Enviar">
              <Send aria-hidden="true" size={17} />
            </button>
          </div>
        </form>
        <p className="chat-footnote">
          Nox pode cometer erros. Ações externas sempre respeitam suas permissões.
        </p>
      </section>

      <aside className="context-rail" aria-label="Contexto da conversa">
        <p className="eyebrow">Contexto</p>
        <h2>O que Nox está usando</h2>
        <div className="context-item">
          <span className="context-glyph">G</span>
          <div>
            <strong>Google Calendar</strong>
            <small>3 eventos de amanhã</small>
          </div>
        </div>
        <div className="context-item">
          <span className="context-glyph context-glyph-memory">M</span>
          <div>
            <strong>Memória</strong>
            <small>Preferência por manhãs livres</small>
          </div>
        </div>
        <div className="context-divider" />
        <p className="context-privacy">Contexto limitado a esta conta e conversa.</p>
      </aside>
    </div>
  );
}
