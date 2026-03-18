# 🚀 Buddy 2.0 — Roadmap de Evolução

> **Documento de acompanhamento do desenvolvimento**
> Baseado na análise comparativa com [Mark-XXX](https://github.com/FatihMakes/Mark-XXX)
> Início: Março 2026

---

## 📊 Resumo da Análise Mark-XXX vs Buddy

### O que o Mark-XXX faz bem (e o Buddy ainda não tem)

| Recurso | Mark-XXX | Buddy Atual |
|---------|----------|-------------|
| Agente com Planner/Executor | ✅ Planner LLM + Executor + ErrorHandler + TaskQueue | ⚠️ Agentic loop simples (25 iterações) |
| Controle de tela (Vision) | ✅ Screenshot + Webcam → Gemini Vision | ❌ Não tem |
| screen_find / screen_click | ✅ IA localiza elemento + clica | ❌ Não tem |
| Browser Automation | ✅ Playwright completo | ❌ Não tem |
| Web Search nativo | ✅ Gemini Search + DuckDuckGo fallback | ❌ Não tem |
| Catálogo de Actions | ✅ 15 módulos especializados | ⚠️ Depende só do MCP |
| Memória com extração LLM | ✅ Triagem YES/NO + extração JSON | ⚠️ Markdown manual |
| Controle do computador | ✅ PyAutoGUI + keyboard + clipboard | ⚠️ Só via MCP Desktop Commander |

### O que o Buddy faz melhor que o Mark-XXX

| Recurso | Buddy | Mark-XXX |
|---------|-------|----------|
| UI/Personalidade | ✅ Rosto SVG animado, expressões, cabelo 3D, antena tech | ❌ Tkinter básico |
| Wake word offline | ✅ Vosk + faster-whisper (100% offline) | ❌ Streaming constante via API |
| Sistema de Skills | ✅ Plugins .md dinâmicos | ❌ Tudo hardcoded |
| Proteção destrutiva | ✅ Pede confirmação antes de ações perigosas | ❌ Executa direto |
| Segurança | ✅ Sandbox via MCP | ❌ Executa código gerado sem sandbox |
| Multi-provider | ⚠️ OpenAI (fácil trocar) | ❌ Só Gemini |

---

## 🏗️ Etapas de Desenvolvimento

### Etapa 1 — Sistema de Agente Inteligente (Planner/Executor)
> **Prioridade:** 🔴 Alta | **Complexidade:** Alta | **Status:** ✅ Concluído

O coração da evolução. Transforma o Buddy de um loop simples em um agente que planeja, executa, trata erros e re-planeja.

#### Sub-etapas

- [x] **1.1 — Tool Registry dinâmico** (`agent/tool-registry.js`) ✅
  - Sistema onde cada action se auto-registra com nome, descrição e parâmetros
  - As tools do MCP Desktop Commander são carregadas automaticamente
  - Skills `.md` podem registrar novas tools
  - Hot-reload sem reiniciar o app
  - **Critério de aceite:** `toolRegistry.getAll()` retorna lista completa de tools com schemas

- [x] **1.2 — Planner** (`agent/planner.js`) ✅
  - Recebe um goal em linguagem natural
  - Usa LLM (OpenAI) para decompor em steps (máx 10)
  - Cada step tem: tool, parâmetros, descrição, flag critical
  - Recebe dinamicamente a lista de tools do registry
  - Fallback plan se LLM falha
  - **Critério de aceite:** `planner.createPlan("pesquisa X e salva em arquivo")` retorna JSON com steps válidos

- [x] **1.3 — Error Handler** (`agent/error-handler.js`) ✅
  - Analisa erros de cada step via LLM
  - Decide: RETRY (transiente), SKIP (não-crítico), REPLAN (abordagem errada), ABORT (impossível)
  - Gera sugestão de fix para REPLAN
  - Máximo de 2 replans por task
  - **Critério de aceite:** Dado um step falhado, retorna decisão coerente com razão e mensagem pro usuário

- [x] **1.4 — Executor** (`agent/executor.js`) ✅
  - Recebe plano do Planner e executa step-by-step
  - Injeta contexto de steps anteriores nos próximos (ex: resultado da busca vira conteúdo do arquivo)
  - Chama Error Handler em caso de falha
  - Pode re-planejar até 2x
  - Sumariza resultado final via LLM
  - Emite eventos para a UI (progresso, status)
  - **Critério de aceite:** Executor completa task multi-step com tratamento de erro e resumo

- [x] **1.5 — Task Queue** (`agent/task-queue.js`) ✅
  - Fila com prioridade (LOW, NORMAL, HIGH)
  - Cancelamento de tasks em andamento via `cancel_flag`
  - Status tracking (PENDING, RUNNING, COMPLETED, FAILED, CANCELLED)
  - Callback `onComplete` para notificar a UI
  - Execução single-thread (uma task por vez)
  - **Critério de aceite:** Submeter 3 tasks, executam em ordem de prioridade, cancelar uma funciona

- [x] **1.6 — Integração no main.js** ✅
  - Nova tool `agent_task` no function calling do OpenAI
  - Quando LLM detecta tarefa complexa, roteia pro agent
  - Emissão de eventos IPC para atualizar expressão do Buddy (working, thinking)
  - Progresso visível no chat
  - **Critério de aceite:** Falar "Buddy, pesquisa sobre X e salva num arquivo" dispara o agent completo

---

### Etapa 2 — Controle de Tela (Vision + Computer Control)
> **Prioridade:** 🔴 Alta | **Complexidade:** Alta | **Status:** ⬜ Não iniciado

Dá "olhos" ao Buddy — ele pode ver a tela, encontrar elementos e interagir.

#### Sub-etapas

- [x] **2.1 — Screen Capture** (`actions/screen-capture.js`) ✅
  - Usa `desktopCapturer` do Electron para capturar a tela
  - Redimensiona para resolução econômica (640x360)
  - Retorna buffer JPEG otimizado
  - Suporte a captura de webcam via getUserMedia
  - **Critério de aceite:** Captura tela e webcam em < 500ms, retorna JPEG < 100KB

- [x] **2.2 — Vision Analyzer** (`actions/vision-analyzer.js`) ✅
  - Envia screenshot para OpenAI GPT-4o (vision)
  - Prompt otimizado para análise de tela
  - Retorna descrição textual do que vê
  - Modo "find element": retorna coordenadas x,y de um elemento descrito
  - **Critério de aceite:** "O que tem na minha tela?" retorna descrição precisa

- [ ] **2.3 — Computer Control** (`actions/computer-control.js`)
  - Integrar `@nut-tree/nut-js` (ou robotjs) para controle de mouse/teclado
  - Actions: click, doubleClick, rightClick, type, hotkey, scroll, moveMouse
  - `screen_find`: descreve elemento → Vision retorna coordenadas → clica
  - `screen_click`: combinação de find + click
  - Clipboard: copiar/colar via nativeClipboard
  - **Critério de aceite:** "Buddy, clica no botão Iniciar" funciona via screen_find + click

- [ ] **2.4 — Integração como Tool**
  - Registrar `screen_process` e `computer_control` no Tool Registry
  - Planner pode usar essas tools em planos multi-step
  - Expressão do Buddy muda para "observando" durante vision
  - **Critério de aceite:** Agent executa "olha minha tela e me diz o que tá aberto"

---

### Etapa 3 — Browser Automation
> **Prioridade:** 🟡 Média | **Complexidade:** Média | **Status:** ⬜ Não iniciado

Controle programático do navegador para tarefas web.

#### Sub-etapas

- [ ] **3.1 — Browser Engine** (`actions/browser-control.js`)
  - Integrar Playwright (chromium)
  - Thread separada para não bloquear a UI
  - Lifecycle: launch → page → actions → close
  - Detecção automática do browser padrão
  - **Critério de aceite:** `browser.goTo("google.com")` abre no browser real

- [ ] **3.2 — Actions básicas**
  - `go_to`: Navegar para URL
  - `search`: Buscar no Google/Bing/DuckDuckGo
  - `click`: Clicar por seletor CSS ou texto
  - `type`: Digitar em campo por seletor
  - `scroll`: Scroll up/down
  - `get_text`: Extrair texto da página
  - `press`: Pressionar tecla
  - `close`: Fechar browser
  - **Critério de aceite:** Todas as 8 actions funcionam isoladamente

- [ ] **3.3 — Smart Actions (IA)**
  - `smart_click`: Descreve o elemento em linguagem natural → Playwright encontra
  - `smart_type`: Descreve o campo → encontra → digita
  - `fill_form`: Preenche formulário inteiro a partir de dict
  - **Critério de aceite:** "clica no botão de login" funciona sem seletor CSS

- [ ] **3.4 — Integração como Tool**
  - Registrar `browser_control` no Tool Registry
  - Planner pode criar planos que envolvem navegação web
  - **Critério de aceite:** "Buddy, busca no Google sobre X" funciona end-to-end

---

### Etapa 4 — Catálogo de Actions Expandido
> **Prioridade:** 🟡 Média | **Complexidade:** Média | **Status:** ⬜ Não iniciado

Módulos de ação especializados que ampliam as capacidades do Buddy.

#### Sub-etapas

- [ ] **4.1 — Web Search** (`actions/web-search.js`)
  - Busca via API (Google Custom Search ou SerpAPI)
  - Fallback com DuckDuckGo (ddgs)
  - Modo comparação: compara N itens por aspecto
  - Retorna resultados formatados (título, snippet, URL)
  - **Critério de aceite:** "Buddy, pesquisa sobre IA generativa" retorna top 5 resultados

- [ ] **4.2 — File Controller avançado** (`actions/file-controller.js`)
  - Ações: list, create, delete, move, copy, rename, read, write, find, disk_usage
  - Atalhos: "desktop", "downloads", "documents" resolvem pro caminho real
  - Busca por nome ou extensão
  - Top N maiores arquivos
  - **Critério de aceite:** Todas as ações funcionam com caminhos absolutos e atalhos

- [ ] **4.3 — Weather** (`actions/weather.js`)
  - API OpenWeatherMap (free tier)
  - Retorna temperatura, condição, previsão
  - Detecta cidade do usuário pela memória
  - **Critério de aceite:** "Buddy, clima em Uberlândia" retorna dados corretos

- [ ] **4.4 — Reminder/Scheduler** (`actions/reminder.js`)
  - Agenda tarefas com data/hora
  - Usa node-cron ou Windows Task Scheduler
  - Persiste em arquivo JSON
  - Notificação via TTS quando dispara
  - **Critério de aceite:** "Buddy, me lembra às 15:00 de fazer X" funciona

- [ ] **4.5 — YouTube Controller** (`actions/youtube.js`)
  - Buscar e abrir vídeos
  - Extrair info de vídeo (título, duração, views)
  - Trending por região
  - **Critério de aceite:** "Buddy, toca lofi no YouTube" abre o vídeo

- [ ] **4.6 — Send Message** (`actions/send-message.js`)
  - Enviar mensagens via WhatsApp Web (automação browser)
  - Enviar via Telegram Bot API
  - **Critério de aceite:** "Buddy, manda mensagem pro João no WhatsApp" funciona

- [ ] **4.7 — Code Helper** (`actions/code-helper.js`)
  - Escrever código (LLM gera, salva em arquivo)
  - Rodar código (subprocess com timeout)
  - Editar código existente
  - Explicar código
  - Auto-build: gera, testa, corrige em loop
  - **Critério de aceite:** "Buddy, cria um script Python que baixa imagens" funciona end-to-end

---

### Etapa 5 — Memória Inteligente 2.0
> **Prioridade:** 🔴 Alta | **Complexidade:** Média | **Status:** ⬜ Não iniciado

Evolui a memória de markdown simples para extração automática e estruturada via LLM.

#### Sub-etapas

- [ ] **5.1 — Memória Estruturada** (`memory/memory-manager.js`)
  - Formato JSON: `{ identity, preferences, relationships, notes }`
  - CRUD thread-safe com lock
  - Truncar valores longos (máx 300 chars)
  - Merge recursivo (atualiza sem perder dados existentes)
  - **Critério de aceite:** `memoryManager.update({identity: {name: {value: "Francesco"}}})` persiste corretamente

- [ ] **5.2 — Extração automática via LLM**
  - A cada N turnos de conversa, roda extração
  - **Estágio 1 (Triagem):** LLM rápido (gpt-4o-mini) faz YES/NO — "essa mensagem contém fatos pessoais?"
  - **Estágio 2 (Extração):** Se YES, LLM extrai JSON estruturado
  - Skip se mensagem < 10 chars ou idêntica à anterior
  - Thread separada para não bloquear
  - **Critério de aceite:** Dizer "Meu nome é Francesco e moro em Uberlândia" salva automaticamente

- [ ] **5.3 — Injeção de contexto no prompt**
  - `formatMemoryForPrompt()` gera bloco `[USER MEMORY]` com dados relevantes
  - Injetado no system prompt a cada sessão
  - Limite de 800 tokens para não estourar o contexto
  - **Critério de aceite:** Buddy sabe o nome do usuário sem ser lembrado

- [ ] **5.4 — Migração da memória atual**
  - Converter `memory/user.md` e `memory/personality.md` para o novo formato JSON
  - Manter compatibilidade com `memory/daily/*.md` para diário
  - Script de migração one-shot
  - **Critério de aceite:** Dados existentes preservados no novo formato

---

### Etapa 6 — Refinamentos e Integração Final
> **Prioridade:** 🟢 Baixa | **Complexidade:** Média | **Status:** ⬜ Não iniciado

Polish, testes e melhorias de UX.

#### Sub-etapas

- [ ] **6.1 — Novas expressões do Buddy**
  - "Observando" (durante vision/screen capture — olhos com scanner)
  - "Navegando" (durante browser automation — olhos focados)
  - "Pesquisando" (durante web search — olhos lendo rápido)
  - **Critério de aceite:** Cada nova ação aciona a expressão correta

- [ ] **6.2 — UI de progresso do Agent**
  - Mostrar steps do plano no chat (Step 1/5: Buscando...)
  - Indicador de progresso visual
  - Botão de cancelar task em andamento
  - **Critério de aceite:** Usuário vê progresso em tempo real de tasks multi-step

- [ ] **6.3 — Settings panel**
  - Tela de configurações acessível por ícone
  - Trocar modelo de IA (gpt-4o-mini, gpt-4o, gpt-4.1)
  - Configurar API keys (OpenAI, Google, Weather, etc)
  - Toggle de voice on/off
  - Toggle de proteção destrutiva
  - **Critério de aceite:** Todas as configs persistem e funcionam

- [ ] **6.4 — Multi-provider LLM**
  - Suporte a OpenAI, Anthropic (Claude), Google (Gemini)
  - Configurável por função (planner pode usar modelo barato, executor usa premium)
  - Fallback automático entre providers
  - **Critério de aceite:** Buddy funciona com qualquer um dos 3 providers

- [ ] **6.5 — Testes e documentação**
  - Testes unitários para cada módulo do agent
  - Testes de integração para fluxos completos
  - Atualizar README com novas funcionalidades
  - Documentação de como criar novas Actions
  - **Critério de aceite:** `npm test` passa, README reflete estado atual

---

## 📅 Ordem de Execução Sugerida

```
Etapa 1 (Agent)  ████████████░░░░░░░░  ← FAZER PRIMEIRO (fundação)
Etapa 5 (Memória) ████████░░░░░░░░░░░░  ← Junto/logo após Etapa 1
Etapa 2 (Vision)  ░░░░████████░░░░░░░░  ← Segundo bloco
Etapa 3 (Browser) ░░░░░░░░████████░░░░  ← Terceiro bloco
Etapa 4 (Actions) ░░░░░░░░░░░░████████  ← Pode ser paralelo com 3
Etapa 6 (Polish)  ░░░░░░░░░░░░░░░░████  ← Final
```

A Etapa 1 é pré-requisito para quase tudo — o Tool Registry e o Planner/Executor são a fundação sobre a qual as outras etapas se constroem.

---

## 📝 Changelog

| Data | Etapa | O que foi feito |
|------|-------|-----------------|
| 2026-03-18 | — | Criação do roadmap e análise comparativa |
| 2026-03-18 | 1.1 | Tool Registry dinâmico (`agent/tool-registry.js`) — 407 linhas, singleton EventEmitter, registro manual, loadFromMCP, loadFromSkills, hot-reload, getOpenAITools |
| 2026-03-18 | 1.2 | Planner (`agent/planner.js`) — 324 linhas, createPlan via LLM, validação de tools, fuzzy match, fallback plan, needsPlanning heuristic |
| 2026-03-18 | 1.3 | Error Handler (`agent/error-handler.js`) — 350 linhas, heurística rápida por padrões + LLM para ambíguos, RETRY/SKIP/REPLAN/ABORT, contadores de retry/replan, fallback |
| 2026-03-18 | 1.4 | Executor (`agent/executor.js`) — 397 linhas, execução step-by-step com injeção de contexto, depends_on, timeout 60s, re-planejamento até 2x, sumarização LLM, cancelamento, eventos para UI |
| 2026-03-18 | 1.5 | Task Queue (`agent/task-queue.js`) — 336 linhas, fila com prioridade (LOW/NORMAL/HIGH), execução single-thread, cancelamento, status tracking, histórico, stats |
| 2026-03-18 | 1.6 | Integração no main.js — `agent/index.js` (135 linhas), callLLMForAgent, initBuddyAgent, IPCs (agent-run-task, agent-cancel-task, agent-status), preload atualizado, cleanup no shutdown |
| 2026-03-18 | **1** | **✅ ETAPA 1 COMPLETA — Sistema de Agente Inteligente (Planner/Executor)** |
| 2026-03-18 | 2.1 | Screen Capture (`actions/screen-capture.js`) — screenshot-desktop + sharp, captura 640x360 JPEG ~15KB em <400ms, multi-display, processamento webcam, auto-reduce quality |
| 2026-03-18 | 2.2 | Vision Analyzer (`actions/vision-analyzer.js`) — 298 linhas, 3 modos (describe/findElement/readText), GPT-4o vision API, escalonamento de coordenadas, integração com ScreenCapture |

---

*Última atualização: 18/03/2026*
