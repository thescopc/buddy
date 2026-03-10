# 🤖 Buddy Desktop

Agente de desktop autônomo com rostinho animado, reconhecimento de voz local, IA conversacional, controle do computador via MCP, memória persistente e sistema de skills.

---

## O que é o Buddy?

Buddy é um agente virtual que fica como uma janelinha sempre visível na sua tela. Ele tem um rostinho animado com expressões, escuta sua voz, conversa com você usando IA (OpenAI), e executa tarefas completas no seu computador — criar arquivos, organizar pastas, abrir programas, agendar tarefas e muito mais.

Diferente de um chatbot simples, o Buddy é um **agente autônomo**: você dá uma tarefa e ele planeja, executa múltiplos passos, verifica resultados e só te responde quando terminou.

---

## Funcionalidades

- 🎤 **Reconhecimento de voz local** — Vosk (wake word) + faster-whisper (transcrição). 100% offline.
- 🤖 **Agente autônomo** — Loop agêntico com até 25 iterações. Planeja, executa e verifica.
- 🛡️ **Proteção destrutiva** — Pede confirmação antes de escrever, apagar ou executar comandos.
- 🧠 **Memória persistente** — Lembra do seu nome, preferências, e o que fez cada dia.
- 📅 **Scheduler de tarefas** — Agenda tarefas pra executar em horários específicos.
- 🔧 **Sistema de Skills** — Aprende habilidades novas via arquivos .md (Google Calendar, etc).
- 😊 **Rostinho animado** — 7 expressões com olhos que seguem o mouse.
- 🔊 **TTS em pt-BR** — Fala as respostas (clique no rosto pra parar).

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                    ELECTRON (UI)                     │
│  index.html - Rostinho animado + Chat + TTS          │
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

1. Clone o repositório:
   ```bash
   git clone https://github.com/thescopc/buddy.git
   cd buddy
   ```

2. Copie o arquivo de exemplo e insira sua API Key:
   ```bash
   cp main.example.js main.js
   ```
   Edite `main.js` e substitua `SUA_OPENAI_API_KEY_AQUI` pela sua chave.

3. Baixe o modelo Vosk pt-BR:
   - Link: https://alphacephei.com/vosk/models/vosk-model-small-pt-0.3.zip
   - Extraia e renomeie a pasta para `model/` dentro do projeto

4. Instale e rode:
   ```bash
   npm install
   npm start
   ```

O primeiro `npm start` vai:
- Instalar o Desktop Commander MCP em `mcp-tools/`
- Instalar vosk, sounddevice e faster-whisper via pip
- Baixar o modelo Whisper "base" (~150MB)
- Criar a pasta `memory/` com arquivos padrão

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

## Sistema de Memória

O Buddy lembra de tudo automaticamente:

- **Personalidade** (`memory/personality.md`) — Nome, tom de voz, comportamento
- **Usuário** (`memory/user.md`) — Seu nome, preferências (atualiza sozinho)
- **Diário** (`memory/daily/`) — Resumo de tudo que fez por dia
- **Tarefas** (`memory/tasks.md`) — Tarefas agendadas com horário

Na primeira execução, o Buddy se apresenta e pergunta seu nome.

---

## Skills (Plugins)

Skills são arquivos `.md` na pasta `skills/` que ensinam o Buddy a fazer coisas novas.

Skills incluídas:
- `google-calendar.md` — Conectar e gerenciar Google Calendar
- `abrir-programas.md` — Abrir sites e programas no Windows

### Criando uma skill

Basta criar um `.md` em `skills/` seguindo o formato:
```markdown
# Skill: Nome da Skill
## Descrição
O que essa skill faz.
## Como Usar
Instruções para o Buddy executar.
```

Ou peça pro próprio Buddy: *"Buddy, cria uma skill pra enviar emails"*

---

## Estrutura de Arquivos

```
buddy/
├── main.example.js      # Arquivo principal (copie como main.js)
├── main.js              # Seu arquivo com API Key (não versionado)
├── preload.js           # Bridge seguro (IPC)
├── index.html           # Interface completa (HTML + CSS + JS)
├── voice_listener.py    # Reconhecimento de voz (Python)
├── mcp-client.js        # Cliente MCP (JSON-RPC 2.0)
├── setup-mcp.js         # Auto-instalador do Desktop Commander
├── package.json         # Dependências
├── .gitignore
├── README.md
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

## Configuração

### Trocar modelo de IA
Em `main.js`:
```javascript
const OPENAI_MODEL = 'gpt-4o-mini';   // Barato e bom (padrão)
const OPENAI_MODEL = 'gpt-4o';        // Melhor capacidade
const OPENAI_MODEL = 'gpt-4.1';       // Mais recente
```

### Calibrar microfone
```bash
py test_noise.py
```
Ajuste o threshold em `voice_listener.py` na função `has_sound()`.

---

## Licença

Projeto pessoal — use e modifique como quiser.
