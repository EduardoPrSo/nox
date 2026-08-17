'use client';

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  Gauge,
  Mic2,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { mockCapabilityUsage, mockModelUsage, mockUsageTrend } from '@/lib/mock-data';
import { budgetProgress, projectMonthlyCost } from '@/lib/usage';
import { PageHeader } from './page-header';

const spent = 6.87;
const budget = 15;
const projected = projectMonthlyCost(spent, 16, 31);

export function UsageDashboard() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('month');
  const maxTrend = Math.max(...mockUsageTrend.map((point) => point.cost));
  const polyline = mockUsageTrend
    .map(
      (point, index) =>
        `${(index / (mockUsageTrend.length - 1)) * 100},${50 - (point.cost / maxTrend) * 42}`,
    )
    .join(' ');

  return (
    <div className="usage-page page-stack">
      <PageHeader
        eyebrow="Observabilidade pessoal"
        title="Usage & budget"
        description="Entenda quanto seu Nox está usando, por quê e onde seu orçamento está indo."
        action={
          <div className="period-switcher" aria-label="Período">
            {(['today', 'week', 'month'] as const).map((item) => (
              <button
                key={item}
                data-active={period === item}
                type="button"
                onClick={() => setPeriod(item)}
              >
                {item === 'today' ? 'Hoje' : item === 'week' ? '7 dias' : 'Este mês'}
              </button>
            ))}
          </div>
        }
      />

      <section className="usage-overview">
        <div className="spend-hero">
          <p className="eyebrow">Gasto este mês</p>
          <div className="spend-number">
            <span>US$</span>
            <strong>{spent.toFixed(2).replace('.', ',')}</strong>
          </div>
          <p className="trend-positive">
            <ArrowDownRight aria-hidden="true" size={15} /> 12% abaixo do ritmo de julho
          </p>
          <div className="usage-sparkline" aria-label="Custo diário dos últimos sete dias">
            <svg viewBox="0 0 100 54" preserveAspectRatio="none" role="img">
              <defs>
                <linearGradient id="usage-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#9c8cff" stopOpacity=".42" />
                  <stop offset="1" stopColor="#9c8cff" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={`0,54 ${polyline} 100,54`} fill="url(#usage-gradient)" />
              <polyline
                points={polyline}
                fill="none"
                stroke="#aa9cff"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div>
              {mockUsageTrend.map((point) => (
                <span key={point.label}>{point.label}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="budget-panel">
          <div className="budget-heading">
            <div>
              <p className="eyebrow">Orçamento mensal</p>
              <h2>Com espaço para respirar.</h2>
            </div>
            <Gauge aria-hidden="true" size={22} />
          </div>
          <div className="budget-track">
            <span style={{ width: `${budgetProgress(spent, budget)}%` }} />
          </div>
          <div className="budget-scale">
            <span>US$ {spent.toFixed(2)}</span>
            <span>Soft limit · US$ 12</span>
            <span>US$ {budget.toFixed(2)}</span>
          </div>
          <div className="projection">
            <span>
              <small>Projeção</small>
              <strong>US$ {projected.toFixed(2)}</strong>
            </span>
            <p>Estimativa linear com base nos 16 dias decorridos. Pode variar conforme o uso.</p>
          </div>
        </div>
      </section>

      <section className="usage-kpis" aria-label="Indicadores">
        <article>
          <Activity aria-hidden="true" size={18} />
          <span>
            <small>Requests</small>
            <strong>314</strong>
          </span>
          <em>
            <ArrowUpRight aria-hidden="true" size={12} /> 8%
          </em>
        </article>
        <article>
          <Sparkles aria-hidden="true" size={18} />
          <span>
            <small>Tokens</small>
            <strong>255k</strong>
          </span>
          <em>~812 / request</em>
        </article>
        <article>
          <Mic2 aria-hidden="true" size={18} />
          <span>
            <small>Voice</small>
            <strong>42 min</strong>
          </span>
          <em>US$ 0,05 / interação</em>
        </article>
        <article>
          <Clock3 aria-hidden="true" size={18} />
          <span>
            <small>Eko ativo</small>
            <strong>18,4 h</strong>
          </span>
          <em>US$ 0,10 / hora</em>
        </article>
      </section>

      <div className="usage-breakdown-grid">
        <section className="capability-breakdown">
          <div className="section-heading-inline">
            <div>
              <p className="eyebrow">Por capability</p>
              <h2>Onde o Nox trabalhou</h2>
            </div>
            <span>US$ 6,87 total</span>
          </div>
          <div className="capability-bars">
            {mockCapabilityUsage.map((item) => (
              <div className="usage-bar-row" key={item.label}>
                <span className="usage-color" style={{ background: item.color }} />
                <strong>{item.label}</strong>
                <div className="usage-bar">
                  <i style={{ width: `${(item.cost / 2.11) * 100}%`, background: item.color }} />
                </div>
                <span>US$ {item.cost.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="model-breakdown">
          <div className="section-heading-inline">
            <div>
              <p className="eyebrow">Por modelo</p>
              <h2>Política Balanced</h2>
            </div>
            <button type="button">Detalhes</button>
          </div>
          <div className="model-list">
            {mockModelUsage.map((item, index) => (
              <div className="model-row" key={item.model}>
                <span className="model-rank">0{index + 1}</span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.model}</small>
                </div>
                <span>
                  <strong>{item.requests}</strong>
                  <small>requests</small>
                </span>
                <span>
                  <strong>{Math.round(item.tokens / 1000)}k</strong>
                  <small>tokens</small>
                </span>
                <span>
                  <strong>US$ {item.cost.toFixed(2)}</strong>
                  <small>custo</small>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
