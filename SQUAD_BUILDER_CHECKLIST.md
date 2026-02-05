# Squad Builder - Checklist Atualizada

**Última atualização**: 04/02/2026

---

## Fase 0-3: Infraestrutura Base
- [x] Conta Cloudflare Workers Paid ($5/mês)
- [x] Conta Anthropic com créditos ($30)
- [x] Worker `squad-builder` deployado e funcionando
- [x] Discord Bot "Squad Orchestrator" configurado
- [x] Comandos `/ping` e `/task` funcionando
- [x] Integração Claude API (modelo Haiku)

## Fase 4: Banco de Dados
- [x] Supabase configurado
- [x] Tabelas criadas: squads, agentes, tasks, mensagens

## Fase 5: Dashboard
- [x] Dashboard criada na Lovable
- [x] Kanban com 5 colunas
- [x] Tela de configuração de agentes

## Fase 6: Moltworker/OpenClaw
- [x] Fork do repositório: github.com/lord-filipelima/moltworker
- [x] Secrets configurados no GitHub Actions
- [x] R2 Storage habilitado no Cloudflare
- [x] Deploy via GitHub Actions - SUCESSO
- [x] **Cloudflare Zero Trust configurado**
- [x] **CF_ACCESS_TEAM_DOMAIN e CF_ACCESS_AUD configurados**
- [x] **Device Pairing funcionando**
- [x] **Chat do Moltworker OPERACIONAL** (Health: OK)
- [ ] Configurar R2 Storage para persistência (opcional)
- [ ] Conectar Discord Bot Token ao Moltworker

---

## URLs e Recursos

| Recurso | URL/Status |
|---------|------------|
| Worker squad-builder | https://squad-builder.filipelima.workers.dev |
| **Moltworker** | https://moltbot-sandbox.filipelima.workers.dev |
| Moltworker Admin | https://moltbot-sandbox.filipelima.workers.dev/_admin/ |
| Moltworker Chat | https://moltbot-sandbox.filipelima.workers.dev/health/chat |
| GitHub Fork | github.com/lord-filipelima/moltworker |
| Discord Server | Forja Squad Builder |
| Discord Bot | Squad Orchestrator |
| Account ID Cloudflare | ac5d41e2ce675a394d6adf16e1fb8038 |

---

## Próximos Passos

### Imediato (Melhorias Moltworker)
- [ ] **Configurar R2 Storage** - Para persistir conversas e dispositivos pareados
  - Criar bucket R2 no Cloudflare
  - Gerar API Token com permissões
  - Adicionar secrets: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CF_ACCOUNT_ID`

- [ ] **Conectar Discord ao Moltworker** (opcional)
  - Adicionar `DISCORD_BOT_TOKEN` como secret
  - Testar integração Discord ↔ Moltworker

### Fase 7: Integração dos Sistemas
- [ ] Criar skill customizado para integrar Moltbot com Supabase
- [ ] Conectar Dashboard Lovable ao Moltworker via API
- [ ] Implementar endpoint para receber tasks da Dashboard
- [ ] Configurar webhook para atualizar status no Supabase

### Fase 8: Sistema Multi-Agente
- [ ] Definir Soul/Personalidade de cada agente:
  - Maestro (orquestrador)
  - Criativo (gerador de ideias)
  - Crítico (revisor)
  - Polidor (refinamento final)
- [ ] Implementar fluxo: Maestro → Criativo → Crítico → Polidor
- [ ] Criar regras e limitadores por agente
- [ ] Implementar gatilhos de bloqueio

### Fase 9: Testes e Refinamento
- [ ] Testes end-to-end do fluxo completo
- [ ] Ajustar prompts dos agentes
- [ ] Otimizar custos de API
- [ ] Documentar sistema

---

## Arquitetura Atual

```
┌─────────────────────────────────────────────────────────────┐
│                    DASHBOARD (Lovable)                       │
│         Kanban, Config de Agentes, Visualização              │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    SUPABASE                                  │
│         squads, agentes, tasks, mensagens                    │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
┌─────────────────────┐   ┌─────────────────────┐
│   SQUAD-BUILDER     │   │     MOLTWORKER      │
│   (Worker simples)  │   │    (Clawdbot)       │
│                     │   │                     │
│ • Discord Commands  │   │ • Multi-agente ✓    │
│ • /ping, /task      │   │ • Chat UI ✓         │
│ • Estável ✓         │   │ • Admin UI ✓        │
└─────────────────────┘   │ • Device Pairing ✓  │
                          └─────────────────────┘
                                    │
                                    ▼
                              CLAUDE API
```

---

## Custos Mensais Estimados

| Serviço | Custo |
|---------|-------|
| Cloudflare Workers Paid | $5 |
| Anthropic API | $20-80 (uso) |
| Supabase Free | $0 |
| Lovable Free/Starter | $0-20 |
| Discord | $0 |
| GitHub | $0 |
| **TOTAL** | **$25-105/mês** |

---

## Comando para Próximo Chat

```
Olá! Continuando projeto Squad Builder.

SITUAÇÃO ATUAL:
- Moltworker 100% operacional: https://moltbot-sandbox.filipelima.workers.dev
- Zero Trust e Device Pairing configurados
- Chat funcionando (Health: OK)

FALTA:
- Configurar R2 Storage para persistência
- Integrar Dashboard Lovable com Moltworker
- Implementar sistema multi-agente

PRÓXIMO PASSO: [descrever o que quer fazer]
```
