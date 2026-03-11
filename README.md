<p align="center">
  <img src="docs/screenshot.png" alt="Buddy Desktop" width="280"/>
</p>

<h1 align="center">🤖 Buddy Desktop</h1>

<p align="center">
  <strong>Agente de desktop autônomo com rostinho animado, reconhecimento de voz local, IA conversacional, controle do computador via MCP, memória persistente e sistema de skills.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white" alt="Electron"/>
  <img src="https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white" alt="Python"/>
  <img src="https://img.shields.io/badge/OpenAI-412991?logo=openai&logoColor=white" alt="OpenAI"/>
</p>

---

## O que é o Buddy?

Buddy é um agente virtual que fica como uma janelinha sempre visível na sua tela. Ele tem um rostinho animado SVG com expressões, cabelo 3D em PNG, escuta sua voz, conversa com você usando IA (OpenAI), e executa tarefas completas no seu computador.

Diferente de um chatbot simples, o Buddy é um **agente autônomo**: você dá uma tarefa e ele planeja, executa múltiplos passos, verifica resultados e só te responde quando terminou.

---

## Funcionalidades

| | Funcionalidade | Descrição |
|---|---|---|
| 🎤 | **Voz local** | Vosk (wake word) + faster-whisper (transcrição). 100% offline |
| 🤖 | **Agente autônomo** | Loop agêntico com até 25 iterações. Planeja, executa e verifica |
| 🛡️ | **Proteção destrutiva** | Pede confirmação antes de escrever, apagar ou executar comandos |
| 🧠 | **Memória persistente** | Lembra do seu nome, preferências, e o que fez cada dia |
| 📅 | **Scheduler** | Agenda tarefas pra executar em horários específicos |
| 🔧 | **Skills** | Aprende habilidades novas via arquivos .md |
| 😊 | **Rostinho SVG** | Rosto animado com expressões + cabelo 3D em PNG |
| 🔊 | **TTS pt-BR** | Fala as respostas (clique no rosto pra parar) |

---

## Expressões do Buddy

O rosto do Buddy é feito em SVG com múltiplas expressões animadas:

| Expressão | Quando aparece |
|---|---|
| 😊 **Feliz** | Estado padrão, acordado |
| 🗣️ **Falando** | Enquanto o Buddy fala (TTS) |
| 🤔 **Pensando** | Processando sua pergunta |
| 😴 **Dormindo** | Após 60s sem interação (com Zzz animados) |
| 💻 **Trabalhando** | Executando tarefas (olhos lendo) |
| 😠 **Com raiva** | Quando você clica nele pra parar de falar |
| 😮 **Surpreso** | Reações de surpresa |
| 🎤 **Ouvindo** | Captando sua voz |

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                    ELECTRON (UI)                     │
│  index.html - Rosto SVG animado + Chat + TTS         │
│  main.js    - Agente autônomo + Memória + Scheduler  │
│  preload.js - Bridge seguro (IPC)                    │
├─────────────────────────────────────────────────────┤
│              VOICE LISTENER (Python)                 │
│  voice_listener.py                                   │
│  ├── Vosk (grammar restrita) → Wake word "Buddy"     │
│  └── faster-whisper (modelo base) → Transcrição      │
├─────────────────────────────────────────────────────┤
│                 IA (OpenAI API)                       │
│  GPT-4o-mini com function calling (agentic loop)     │
├─────────────────────────────────────────────────────┤
│           MCP - Desktop Commander                    │
│  mcp-client.js → JSON-RPC 2.0 via stdio              │
│  26+ ferramentas: arquivos, comandos, processos      │
├─────────────────────────────────────────────────────┤
│              MEMÓRIA PERSISTENTE                     │
│  memory/personality.md → Quem é o Buddy              │
│  memory/user.md → Quem é o usuário                   │
│  memory/daily/YYYY-MM-DD.md → Diário                 │
│  memory/tasks.md → Tarefas agendadas                 │
├─────────────────────────────────────────────────────┤
│              SKILLS (Plugins)                        │
│  skills/*.md → Habilidades aprendidas                │
│  skills/config/ → Credenciais e tokens               │
└─────────────────────────────────────────────────────┘
```

---

## Instalação

### Pré-requisitos
- **Node.js** v18+ — https://nodejs.org/
- **Python** 3.10+ — https://www.python.org/
- **API Key OpenAI** — https://platform.openai.com/api-keys

### Setup

```bash
git clone https://github.com/thescopc/buddy.git
cd buddy
cp main.example.js main.js
# Edite main.js e insira sua API Key
npm install
npm start
```

O primeiro `npm start` vai instalar automaticamente o Desktop Commander MCP, vosk, sounddevice, faster-whisper e baixar o modelo Whisper.

---

## Como Usar

| Ação | Como |
|---|---|
| **Comando de voz** | Diga "Buddy" + comando |
| **Modo conversa** | Diga "Ativa Buddy" (continua até "Tchau Buddy") |
| **Clique no mic** | Clique 🎤 pra gravar comando |
| **Parar de falar** | Clique no rostinho |
| **Cancelar tarefa** | Clique ✕ durante execução |
| **Esconder/Mostrar** | Ctrl+Shift+B |

### Exemplos

```
"Buddy, cria uma pasta chamada projeto no desktop e coloca um index.html dentro"
"Buddy, o que tenho no calendário hoje?"
"Buddy, me lembra às 14:30 de fazer backup"
"Buddy, lista os arquivos da minha pasta documentos"
"Buddy, abre o VS Code no projeto X"
```

---

## Estrutura de Arquivos

```
buddy/
├── main.example.js      # Arquivo principal (copie como main.js)
├── main.js              # Seu arquivo com API Key (não versionado)
├── preload.js           # Bridge seguro (IPC)
├── index.html           # Interface completa (SVG face + Chat + JS)
├── voice_listener.py    # Reconhecimento de voz (Python)
├── mcp-client.js        # Cliente MCP (JSON-RPC 2.0)
├── setup-mcp.js         # Auto-instalador do Desktop Commander
├── package.json         # Dependências
├── docs/
│   ├── screenshot.png   # Screenshot do app
│   └── cabelo.png       # Cabelo 3D (PNG transparente)
├── memory/              # Memória persistente (não versionado)
│   ├── personality.md
│   ├── user.md
│   ├── tasks.md
│   └── daily/
├── skills/              # Skills/Plugins
│   ├── google-calendar.md
│   ├── abrir-programas.md
│   └── config/          # Credenciais (não versionado)
├── model/               # Modelo Vosk pt-BR (não versionado)
└── mcp-tools/           # Desktop Commander (não versionado)
```

---

## Skills (Plugins)

Skills são arquivos `.md` na pasta `skills/` que ensinam o Buddy a fazer coisas novas.

Ou peça pro próprio Buddy: *"Buddy, cria uma skill pra enviar emails"*

---

## Configuração

### Trocar modelo de IA
Em `main.js`:
```javascript
const OPENAI_MODEL = 'gpt-4o-mini';   // Barato e bom (padrão)
const OPENAI_MODEL = 'gpt-4o';        // Melhor capacidade
const OPENAI_MODEL = 'gpt-4.1';       // Mais recente
```

---

## Licença

Projeto pessoal — use e modifique como quiser.
