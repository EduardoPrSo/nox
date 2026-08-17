'use client';

import Link from 'next/link';
import {
  ArrowUpRight,
  CalendarDays,
  Cable,
  ChevronRight,
  CloudSun,
  MemoryStick,
  Mic,
  Send,
  ShieldCheck,
  Sparkles,
  ThermometerSun,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { mockActivity } from '@/lib/mock-data';
import type { OrbState } from '@/lib/types';
import { NoxOrb } from './nox-orb';

const stateCopy: Record<OrbState, string> = {
  IDLE: 'Pronto quando você estiver',
  LISTENING: 'Estou ouvindo…',
  THINKING: 'Conectando os pontos…',
  SPEAKING: 'Aqui está o que encontrei',
  EKO_ACTIVE: 'Eko está atento ao ambiente',
  ERROR: 'Algo precisa da sua atenção',
};

export function HomeExperience() {
  const [orbState, setOrbState] = useState<OrbState>('IDLE');
  const [message, setMessage] = useState('');
  const [answer, setAnswer] = useState<string>();
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;
    timers.current.forEach(clearTimeout);
    setAnswer(undefined);
    setOrbState('THINKING');
    timers.current = [
      setTimeout(() => {
        setOrbState('SPEAKING');
        setAnswer(
          'Você tem uma reunião às 10h e o restante da manhã está livre. Posso organizar uma prioridade para esse intervalo.',
        );
      }, 850),
      setTimeout(() => setOrbState('IDLE'), 3_600),
    ];
  }

  function startListening() {
    setOrbState('LISTENING');
    setAnswer(undefined);
  }

  function stopListening() {
    setOrbState('IDLE');
  }

  return (
    <div className="home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="ambient-copy">
          <p className="eyebrow">Domingo, 16 de agosto · 22:38</p>
          <h1 id="home-title">
            Boa noite, <span>Eduardo.</span>
          </h1>
          <p>Seu espaço está tranquilo. O Nox está pronto e o Eko segue atento, sem interromper.</p>
        </div>

        <div className="orb-stage">
          <NoxOrb state={orbState} />
          <p className="orb-state-copy" aria-live="polite">
            {stateCopy[orbState]}
          </p>
        </div>

        <form className="ask-bar" onSubmit={submit}>
          <Sparkles aria-hidden="true" size={18} />
          <label className="sr-only" htmlFor="quick-message">
            Pergunte qualquer coisa ao Nox
          </label>
          <input
            id="quick-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Pergunte qualquer coisa…"
          />
          <button
            className="voice-button"
            type="button"
            aria-label="Segure para falar"
            onPointerDown={startListening}
            onPointerUp={stopListening}
            onPointerCancel={stopListening}
          >
            <Mic aria-hidden="true" size={18} />
          </button>
          <button className="send-button" type="submit" aria-label="Enviar mensagem">
            <Send aria-hidden="true" size={17} />
          </button>
        </form>

        {answer ? (
          <div className="ambient-answer" aria-live="polite">
            <span className="answer-mark">N</span>
            <p>{answer}</p>
            <Link href="/chat">
              Continuar no chat <ArrowUpRight aria-hidden="true" size={14} />
            </Link>
          </div>
        ) : null}
      </section>

      <section className="pulse-strip" aria-label="Resumo da conta">
        <Link href="/connections" className="pulse-item">
          <Cable aria-hidden="true" size={18} />
          <span>
            <small>Connections</small>
            <strong>2 ativas</strong>
          </span>
          <ChevronRight aria-hidden="true" size={15} />
        </Link>
        <div className="pulse-item">
          <ThermometerSun aria-hidden="true" size={18} />
          <span>
            <small>Casa</small>
            <strong>23 °C</strong>
          </span>
          <span className="signal-live">online</span>
        </div>
        <div className="pulse-item">
          <MemoryStick aria-hidden="true" size={18} />
          <span>
            <small>Memória</small>
            <strong>128 itens</strong>
          </span>
          <span className="signal-live">+1</span>
        </div>
        <Link href="/usage" className="pulse-item">
          <Sparkles aria-hidden="true" size={18} />
          <span>
            <small>Este mês</small>
            <strong>US$ 6,87</strong>
          </span>
          <ChevronRight aria-hidden="true" size={15} />
        </Link>
      </section>

      <div className="home-lower-grid">
        <section className="activity-stream">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Agora e antes</p>
              <h2>Atividade recente</h2>
            </div>
            <button type="button">Ver tudo</button>
          </div>
          <div className="activity-list">
            {mockActivity.map((item, index) => {
              const Icon = index === 0 ? MemoryStick : index === 1 ? ThermometerSun : CalendarDays;
              return (
                <article key={item.title} className="activity-row" data-tone={item.tone}>
                  <span className="activity-icon">
                    <Icon aria-hidden="true" size={18} />
                  </span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                  </div>
                  <time>{item.time}</time>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="day-briefing">
          <div className="briefing-glow" aria-hidden="true" />
          <div className="briefing-topline">
            <span>
              <CloudSun aria-hidden="true" size={18} /> 24 °C
            </span>
            <span className="secure-label">
              <ShieldCheck aria-hidden="true" size={14} /> privado
            </span>
          </div>
          <p className="eyebrow">Seu próximo momento</p>
          <h2>Uma manhã leve.</h2>
          <p>Reunião com o time às 10h. O trajeto costuma levar 22 minutos neste horário.</p>
          <button type="button">
            Preparar meu dia <ArrowUpRight aria-hidden="true" size={15} />
          </button>
        </aside>
      </div>
    </div>
  );
}
