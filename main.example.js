const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const MCPClient = require('./mcp-client');
const { initAgent } = require('./agent');
const { getMemoryManager } = require('./memory/memory-manager');
const { MemoryExtractor } = require('./memory/memory-extractor');
const { migrate: migrateMemory } = require('./memory/migrate-memory');
const settingsManager = require('./settings-manager');
const { callLLM, detectProvider, PROVIDERS } = require('./llm-provider');

// ============================================================
// CONFIGURAÇÃO
// ============================================================
const OPENAI_API_KEY_DEFAULT = 'SUA_OPENAI_API_KEY_AQUI'; // Fallback se settings.json não existir
const OPENAI_MODEL_DEFAULT = 'gpt-4o-mini';

// Carrega settings (migra do hardcoded se necessário)
settingsManager.migrateFromMainJs(OPENAI_API_KEY_DEFAULT, OPENAI_MODEL_DEFAULT);
const settings = settingsManager.load();

// Usa settings ou fallback
let OPENAI_API_KEY = settings.openaiApiKey || OPENAI_API_KEY_DEFAULT;
let OPENAI_MODEL = settings.aiModel || OPENAI_MODEL_DEFAULT;
// ============================================================

// ============================================================
// MEMORY SYSTEM
// ============================================================
const MEMORY_DIR = path.join(__dirname, 'memory');
const MEMORY_DAILY_DIR = path.join(MEMORY_DIR, 'daily');
const SKILLS_DIR = path.join(__dirname, 'skills');

// Conteúdo padrão dos arquivos de memória
const DEFAULT_PERSONALITY = `# Personalidade do Buddy

## Nome
Buddy

## Quem é
Assistente de desktop autônomo, estilo companheiro digital.

## Personalidade
- Simpático, direto e prestativo
- Fala pt-BR de forma natural e casual
- Usa 1-2 emojis por resposta
- Respostas curtas (2-3 frases) na telinha pequena
- Quando executando tarefas, foca e só responde no final
- Tem senso de humor leve

## Tom de voz
Amigável como um colega de trabalho que manja de tecnologia. Não é formal demais nem infantil.
`;

const DEFAULT_USER = `# Sobre o Usuário

## Nome
(Buddy ainda não sabe o nome do usuário)

## Preferências
(Buddy vai aprender com o tempo)

## Notas
(Buddy vai anotar coisas importantes aqui)
`;

const DEFAULT_TASKS = `# Tarefas Pendentes

<!-- Formato: - [ ] HH:MM - Descrição da tarefa -->
<!-- Quando concluída: - [x] HH:MM - Descrição (concluída) -->
<!-- Buddy remove tarefas concluídas automaticamente -->
`;

function getTodayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function initMemory() {
  // Cria pastas
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR);
  if (!fs.existsSync(MEMORY_DAILY_DIR)) fs.mkdirSync(MEMORY_DAILY_DIR);

  // Cria arquivos padrão se não existem
  const files = {
    [path.join(MEMORY_DIR, 'personality.md')]: DEFAULT_PERSONALITY,
    [path.join(MEMORY_DIR, 'user.md')]: DEFAULT_USER,
    [path.join(MEMORY_DIR, 'tasks.md')]: DEFAULT_TASKS,
  };
  for (const [fp, content] of Object.entries(files)) {
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, content, 'utf-8');
      console.log(`[MEMORY] Criado: ${fp}`);
    }
  }

  // Cria arquivo do dia
  const todayFile = path.join(MEMORY_DAILY_DIR, `${getTodayDateStr()}.md`);
  if (!fs.existsSync(todayFile)) {
    fs.writeFileSync(todayFile, `# Memória do dia — ${getTodayDateStr()}\n\n`, 'utf-8');
    console.log(`[MEMORY] Criado diário: ${todayFile}`);
  }

  console.log('[MEMORY] Sistema de memória inicializado');

  // Limpeza automática
  cleanOldDailies(30);
  cleanCompletedTasks();
}

// Remove arquivos diários com mais de X dias
function cleanOldDailies(maxDays) {
  try {
    const files = fs.readdirSync(MEMORY_DAILY_DIR);
    const now = Date.now();
    let removed = 0;

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const dateStr = file.replace('.md', ''); // "2025-03-10"
      const fileDate = new Date(dateStr + 'T00:00:00');
      if (isNaN(fileDate.getTime())) continue;

      const ageDays = (now - fileDate.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > maxDays) {
        fs.unlinkSync(path.join(MEMORY_DAILY_DIR, file));
        removed++;
      }
    }

    if (removed > 0) console.log(`[MEMORY] Limpeza: ${removed} diário(s) antigo(s) removido(s)`);
  } catch (e) {
    console.error('[MEMORY] Erro na limpeza de diários:', e.message);
  }
}

// Remove tarefas marcadas como [x] do tasks.md
function cleanCompletedTasks() {
  try {
    const tasksPath = path.join(MEMORY_DIR, 'tasks.md');
    if (!fs.existsSync(tasksPath)) return;

    const content = fs.readFileSync(tasksPath, 'utf-8');
    const lines = content.split('\n');
    const cleaned = lines.filter(line => !line.match(/^- \[x\] /));

    if (cleaned.length < lines.length) {
      const removed = lines.length - cleaned.length;
      fs.writeFileSync(tasksPath, cleaned.join('\n'), 'utf-8');
      console.log(`[MEMORY] Limpeza: ${removed} tarefa(s) concluída(s) removida(s)`);
    }
  } catch (e) {
    console.error('[MEMORY] Erro na limpeza de tarefas:', e.message);
  }
}

function loadMemory() {
  const personality = fs.readFileSync(path.join(MEMORY_DIR, 'personality.md'), 'utf-8');
  const user = fs.readFileSync(path.join(MEMORY_DIR, 'user.md'), 'utf-8');
  const tasks = fs.readFileSync(path.join(MEMORY_DIR, 'tasks.md'), 'utf-8');
  const todayFile = path.join(MEMORY_DAILY_DIR, `${getTodayDateStr()}.md`);
  const daily = fs.existsSync(todayFile) ? fs.readFileSync(todayFile, 'utf-8') : '';
  return { personality, user, tasks, daily };
}

// Lista skills disponíveis (só nomes, não carrega conteúdo)
function listSkills() {
  try {
    if (!fs.existsSync(SKILLS_DIR)) return [];
    const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'));
    return files.map(f => {
      const content = fs.readFileSync(path.join(SKILLS_DIR, f), 'utf-8');
      // Pega a primeira linha do # como nome da skill
      const titleMatch = content.match(/^# (?:Skill: )?(.+)/m);
      const descMatch = content.match(/^## Descrição\s*\n(.+)/m);
      return {
        file: f,
        name: titleMatch ? titleMatch[1].trim() : f.replace('.md', ''),
        description: descMatch ? descMatch[1].trim() : '',
        path: path.join(SKILLS_DIR, f).replace(/\\/g, '/')
      };
    });
  } catch (e) {
    console.error('[SKILLS] Erro ao listar:', e.message);
    return [];
  }
}

// ============================================================
// TASK SCHEDULER
// ============================================================
let schedulerInterval = null;
let isSchedulerRunning = false;

function startTaskScheduler() {
  // Checa a cada 1 minuto
  schedulerInterval = setInterval(() => {
    checkScheduledTasks();
  }, 60000);

  // Também checa 10s após iniciar (pra pegar tarefas atrasadas)
  setTimeout(() => checkScheduledTasks(), 10000);
  console.log('[SCHEDULER] Iniciado — checando tarefas a cada 1 minuto');
}

function checkScheduledTasks() {
  if (isSchedulerRunning) return; // Já executando uma tarefa

  try {
    const tasksPath = path.join(MEMORY_DIR, 'tasks.md');
    if (!fs.existsSync(tasksPath)) return;

    const content = fs.readFileSync(tasksPath, 'utf-8');
    // Separa tarefas grudadas (o Buddy às vezes escreve sem \n)
    const normalized = content.replace(/(- \[[ x]\])/g, '\n$1').trim();
    const lines = normalized.split('\n');
    const now = new Date();
    const currentHH = String(now.getHours()).padStart(2, '0');
    const currentMM = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${currentHH}:${currentMM}`;

    console.log(`[SCHEDULER] Hora atual: ${currentTime}, checando ${lines.length} linhas`);

    for (const line of lines) {
      // Formato: - [ ] HH:MM - Descrição da tarefa
      const match = line.trim().match(/^- \[ \] (\d{2}:\d{2})\s*[-–]\s*(.+)$/);
      if (!match) continue;

      const taskTime = match[1];
      const taskDesc = match[2].trim();

      console.log(`[SCHEDULER] Tarefa encontrada: ${taskTime} - ${taskDesc} (hora atual: ${currentTime})`);

      // Dispara se o horário já passou (ou é agora) e não foi executada
      if (taskTime <= currentTime) {
        console.log(`[SCHEDULER] DISPARANDO: ${taskTime} - ${taskDesc}`);
        executeScheduledTask(taskDesc, taskTime);
        return; // Uma tarefa por vez
      }
    }
  } catch (e) {
    console.error('[SCHEDULER] Erro ao checar tarefas:', e.message);
  }
}

async function executeScheduledTask(taskDesc, taskTime) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  isSchedulerRunning = true;

  // Notifica o renderer que uma tarefa agendada está começando
  mainWindow.webContents.send('scheduled-task', { task: taskDesc, time: taskTime });

  try {
    const message = `[TAREFA AGENDADA - ${taskTime}]

TAREFA: ${taskDesc}

INSTRUÇÕES (siga nesta ORDEM EXATA):
1. PRIMEIRO: Interprete a tarefa. Se for um lembrete (ex: "tomar água", "fazer backup", "reunião"), FALE para o usuário imediatamente. Exemplo: "Ei! São ${taskTime}, hora de tomar água! 💧"
2. Se a tarefa envolve uma AÇÃO no computador (criar arquivo, abrir programa, etc), execute a ação usando as ferramentas.
3. SOMENTE DEPOIS de ter respondido/executado a tarefa, marque como concluída no tasks.md usando edit_block, trocando "- [ ] ${taskTime} - ${taskDesc}" por "- [x] ${taskTime} - ${taskDesc} (concluída)".
4. Anote no daily de hoje que executou esta tarefa.

IMPORTANTE: NÃO marque como concluída antes de executar/responder. A prioridade é FALAR com o usuário primeiro.`;
    
    // Envia pro renderer executar via agente
    mainWindow.webContents.send('trigger-agent-message', { message });
  } catch (e) {
    console.error('[SCHEDULER] Erro ao executar tarefa:', e.message);
  }

  // Libera após 2 minutos (tempo máximo pro agente executar uma tarefa agendada)
  // Isso evita que o scheduler trave caso algo dê errado
  setTimeout(() => { isSchedulerRunning = false; }, 120000);
}

// Renderer avisa que terminou a tarefa agendada
ipcMain.on('scheduler-task-done', () => {
  isSchedulerRunning = false;
  console.log('[SCHEDULER] Tarefa concluída, scheduler liberado');
});
// ============================================================

// ============================================================
// IPC: Settings
// ============================================================
ipcMain.handle('get-settings', () => {
  return settingsManager.getAllSafe();
});

ipcMain.handle('save-settings', (event, newSettings) => {
  const result = settingsManager.save(newSettings);
  if (result) {
    // Atualiza variáveis em runtime
    const s = settingsManager.load();
    if (s.openaiApiKey) OPENAI_API_KEY = s.openaiApiKey;
    if (s.aiModel) OPENAI_MODEL = s.aiModel;
    // Atualiza extractor com nova API key
    if (memoryExtractor && s.openaiApiKey) {
      memoryExtractor.apiKey = s.openaiApiKey;
    }
  }
  return result;
});
// ============================================================

let mainWindow;
let voiceProcess = null;
let mcpClient = null;
let buddyAgent = null;
let memoryManager = null;
let memoryExtractor = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 320, height: 420,
    frame: false, transparent: true,
    resizable: false, alwaysOnTop: true,
    skipTaskbar: false, hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadFile('index.html');
  const { screen } = require('electron');
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow.setPosition(width - 340, height - 440);
}

// ============================================================
// MCP - Desktop Commander Buddy
// ============================================================
async function startMCP() {
  mcpClient = new MCPClient();
  try {
    await mcpClient.start();
    const tools = mcpClient.getTools();
    console.log('[MCP] Ferramentas:', tools.map(t => t.name).join(', '));
  } catch (e) {
    console.error('[MCP] Falha ao iniciar:', e.message);
    mcpClient = null;
  }
}

// IPC: Chamar tool do MCP
ipcMain.handle('mcp-call-tool', async (event, toolName, args) => {
  if (!mcpClient || !mcpClient.ready) return { error: 'MCP não disponível' };
  try {
    const result = await mcpClient.callTool(toolName, args);
    return { result };
  } catch (e) {
    return { error: e.message };
  }
});

// IPC: Listar tools do MCP
ipcMain.handle('mcp-list-tools', async () => {
  if (!mcpClient) return [];
  return mcpClient.getTools();
});

// ============================================================
// VOICE LISTENER (Python + Vosk)
// ============================================================
const { execSync } = require('child_process');

// Detecta qual comando de Python está disponível no sistema
function findPythonCommand() {
  const candidates = ['py', 'python', 'python3'];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore' });
      console.log(`[PYTHON] Encontrado: ${cmd}`);
      return cmd;
    } catch (e) { /* não encontrado, tenta próximo */ }
  }
  console.error('[PYTHON] Nenhum Python encontrado! Instale Python 3.10+');
  return null;
}

function startVoiceListener() {
  const pythonCmd = findPythonCommand();
  if (!pythonCmd) {
    console.error('[VOICE] Não foi possível iniciar — Python não encontrado');
    return;
  }

  const scriptPath = path.join(__dirname, 'voice_listener.py');
  voiceProcess = spawn(pythonCmd, ['-u', scriptPath], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  });

  let buffer = '';
  voiceProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        console.log('[VOSK]', msg.type, msg.text || '');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('voice-event', msg);
        }
      } catch(e) {}
    }
  });

  voiceProcess.stderr.on('data', (data) => {
    const t = data.toString().trim();
    if (t) {
      console.log('[VOSK-ERR]', t);
      // Envia erros importantes pro renderer
      if (t.includes('No module') || t.includes('ModuleNotFoundError') || t.includes('Error') || t.includes('error')) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('voice-event', { type: 'error', text: `Voz: ${t.substring(0, 100)}` });
        }
      }
    }
  });
  voiceProcess.on('close', (code) => {
    console.log(`[VOICE] Processo encerrou com código ${code}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (code !== 0) {
        mainWindow.webContents.send('voice-event', { type: 'error', text: `Microfone indisponível. Use o chat por texto.` });
      }
    }
  });

  voiceProcess.on('error', (err) => {
    console.error('[VOICE] Erro ao iniciar processo:', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('voice-event', { type: 'error', text: `Erro de voz: ${err.message}` });
    }
  });
}

ipcMain.on('voice-control', (event, cmd) => {
  if (voiceProcess && voiceProcess.stdin.writable) voiceProcess.stdin.write(cmd + '\n');
});

// ============================================================
// AGENT SYSTEM (Buddy 2.0)
// ============================================================

/**
 * Adapta callOpenAI para o formato que o Agent espera:
 * Recebe (messages, model) e retorna string (conteúdo da resposta).
 */
function callLLMForAgent(messages, model) {
  const bodyObj = { model: model || OPENAI_MODEL, max_tokens: 1000, messages };
  return new Promise((resolve, reject) => {
    callOpenAI(bodyObj)
      .then(msg => resolve(msg.content || ''))
      .catch(reject);
  });
}

/**
 * Inicializa o sistema de agente após o MCP estar pronto.
 */
async function initBuddyAgent() {
  try {
    buddyAgent = await initAgent({
      callLLM: callLLMForAgent,
      mcpClient: mcpClient,
      skillsDir: SKILLS_DIR,
      apiKey: OPENAI_API_KEY,
      onEvent: (type, data) => {
        // Propaga eventos do agent para o renderer via IPC
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(type, data);
        }
      },
      onExpression: (expression) => {
        // Muda expressão do Buddy via IPC
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('set-expression', expression);
        }
      }
    });
    console.log('[AGENT] Sistema Buddy 2.0 inicializado!');
  } catch (e) {
    console.error('[AGENT] Falha ao inicializar:', e.message);
    buddyAgent = null;
  }
}

// IPC: Submeter task pro Agent
ipcMain.handle('agent-run-task', async (event, goal, context) => {
  if (!buddyAgent) return { error: 'Agent não inicializado' };
  try {
    const result = await buddyAgent.runTask(goal, context || {});
    return { result };
  } catch (e) {
    return { error: e.message };
  }
});

// IPC: Cancelar task do Agent
ipcMain.on('agent-cancel-task', (event, taskId) => {
  if (buddyAgent && buddyAgent.taskQueue) {
    buddyAgent.taskQueue.cancel(taskId);
  }
});

// IPC: Status do Agent
ipcMain.handle('agent-status', async () => {
  if (!buddyAgent) return { ready: false };
  return {
    ready: true,
    tools: buddyAgent.toolRegistry.getStats(),
    queue: buddyAgent.taskQueue.getStats()
  };
});

// ============================================================
// APP LIFECYCLE
// ============================================================
app.whenReady().then(async () => {
  initMemory();
  createWindow();
  startVoiceListener();
  await startMCP();
  await initBuddyAgent();
  
  // Inicializa Memória Estruturada 2.0
  try { await migrateMemory(MEMORY_DIR); } catch(e) { console.error('[MIGRATE] Erro:', e.message); }
  memoryManager = getMemoryManager(MEMORY_DIR);
  await memoryManager.init();
  memoryExtractor = new MemoryExtractor({
    memoryManager,
    apiKey: OPENAI_API_KEY,
    turnInterval: 1
  });
  memoryExtractor.on('extracted', ({ facts, count }) => {
    console.log(`[MEMORY-EXT] ${count} fato(s) extraído(s):`, JSON.stringify(facts));
  });
  
  startTaskScheduler();
  globalShortcut.register('CommandOrControl+Shift+B', () => {
    if (mainWindow.isVisible()) mainWindow.hide();
    else mainWindow.show();
  });
});

app.on('window-all-closed', async () => {
  globalShortcut.unregisterAll();
  if (schedulerInterval) clearInterval(schedulerInterval);
  if (memoryExtractor) memoryExtractor.destroy();
  if (memoryManager) await memoryManager.destroy();
  if (buddyAgent) await buddyAgent.destroy();
  if (voiceProcess) voiceProcess.kill();
  if (mcpClient) mcpClient.stop();
  app.quit();
});

// IPC: Drag
ipcMain.on('drag-start', (event, mousePos) => {
  const winPos = mainWindow.getPosition();
  dragOffset.x = mousePos.x - winPos[0];
  dragOffset.y = mousePos.y - winPos[1];
  isDragging = true;
});
ipcMain.on('drag-move', (event, mousePos) => {
  if (isDragging) mainWindow.setPosition(mousePos.x - dragOffset.x, mousePos.y - dragOffset.y);
});
ipcMain.on('drag-end', () => { isDragging = false; });
ipcMain.on('close-app', () => {
  if (voiceProcess) voiceProcess.kill();
  if (mcpClient) mcpClient.stop();
  app.quit();
});
ipcMain.on('minimize-app', () => { mainWindow.minimize(); });

// ============================================================
// AGENT CONFIG
// ============================================================
const MAX_AGENT_ITERATIONS = settings.maxAgentIterations || 25;
const DANGEROUS_TOOLS = settings.destructiveProtection !== false 
  ? ['write_file', 'execute_command', 'move_file', 'edit_block'] 
  : [];

// Caminhos seguros que não precisam de confirmação (memória e tasks)
function isSafePath(toolName, toolArgs) {
  const memoryNorm = MEMORY_DIR.replace(/\\/g, '/').toLowerCase();
  const tasksNorm = path.join(MEMORY_DIR, 'tasks.md').replace(/\\/g, '/').toLowerCase();
  
  // Pega o caminho do argumento (varia por tool)
  let targetPath = '';
  if (toolName === 'write_file') targetPath = (toolArgs.path || '').replace(/\\/g, '/').toLowerCase();
  else if (toolName === 'edit_block') targetPath = (toolArgs.file_path || '').replace(/\\/g, '/').toLowerCase();
  else if (toolName === 'move_file') targetPath = (toolArgs.source || '').replace(/\\/g, '/').toLowerCase();
  
  if (!targetPath) return false;
  
  // Se é dentro da pasta memory/ → seguro
  if (targetPath.startsWith(memoryNorm)) return true;
  // Se contém /memory/ no caminho (caso o agente use caminho relativo)
  if (targetPath.includes('/memory/')) return true;
  
  return false;
}

// Flag para cancelar execução do agente
let agentCancelled = false;

// IPC: Cancelar agente
ipcMain.on('agent-cancel', () => {
  agentCancelled = true;
  console.log('[AGENT] Cancelamento solicitado pelo usuário');
});

// ============================================================
// IPC: Chat com OpenAI (AGENTIC LOOP + proteção destrutiva)
// ============================================================
ipcMain.handle('chat-with-claude', async (event, userMessage, history) => {
  agentCancelled = false;

  // Monta lista de tools (MCP + Tool Registry do Agent)
  let openaiTools = [];
  if (buddyAgent && buddyAgent.toolRegistry) {
    // Usa o Tool Registry que tem MCP + todas as actions (44+ tools)
    openaiTools = buddyAgent.toolRegistry.getOpenAITools();
  } else if (mcpClient && mcpClient.ready) {
    // Fallback: só MCP
    openaiTools = mcpClient.getTools().map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema || { type: 'object', properties: {} }
      }
    }));
  }

  const toolNames = openaiTools.map(t => t.function.name).join(', ') || 'nenhuma';
  
  // Carrega memórias
  const memory = loadMemory();
  const memoryDir = MEMORY_DIR.replace(/\\/g, '/');
  const todayStr = getTodayDateStr();
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const isFirstUse = memory.user.includes('Buddy ainda não sabe o nome do usuário');

  // Carrega memória estruturada 2.0
  let structuredMemory = '';
  if (memoryManager) {
    try { structuredMemory = await memoryManager.formatMemoryForPrompt(); } catch(e) { /* ignora */ }
  }

  // Carrega lista de skills
  const skills = listSkills();
  const skillsText = skills.length > 0
    ? skills.map(s => `- ${s.name}: ${s.description} → Leia: ${s.path}`).join('\n')
    : '(nenhuma skill instalada)';

  const sys = {
    role: 'system',
    content: `${memory.personality}

HORA ATUAL: ${currentTime} | DATA: ${todayStr}

${memory.user}

${structuredMemory ? structuredMemory + '\n' : ''}MEMÓRIA DO DIA (${todayStr}):
${memory.daily}

TAREFAS PENDENTES:
${memory.tasks}

${isFirstUse ? `PRIMEIRO USO DETECTADO:
O user.md ainda não tem o nome do usuário. Quando receber a mensagem "[BUDDY_INIT]":
1. Se apresente com empolgação! Diga que é novo por aqui e está conhecendo tudo
2. Pergunte o NOME do usuário de forma natural e simpática
3. Pergunte como o usuário gostaria de te chamar (pode ser Buddy ou outro nome)
4. Quando o usuário responder, SALVE imediatamente no user.md usando write_file (rewrite) e se for trocar seu nome, salve no personality.md também
5. Depois pergunte: "E aí, o que vamos fazer hoje? 😄"
NÃO pule essa etapa. É importante conhecer o usuário primeiro.
` : `INICIALIZAÇÃO NORMAL:
Quando receber a mensagem "[BUDDY_INIT]", dê bom dia/boa tarde/boa noite ao usuário pelo nome.
Se tiver tarefas pendentes, mencione brevemente. Seja breve (1-2 frases).
`}
COMPORTAMENTO DE AGENTE:
- Quando receber uma tarefa, PLANEJE mentalmente antes de agir
- Divida tarefas complexas em passos menores e execute cada um
- Use ferramentas quantas vezes forem necessárias para COMPLETAR a tarefa
- VERIFIQUE o resultado de cada passo antes de prosseguir
- Se algo der errado, tente de outro jeito antes de desistir
- Só responda ao usuário quando a tarefa estiver COMPLETA ou quando precisar de informação

REGRAS:
- Nunca invente resultados — sempre use ferramentas pra verificar
- Se não conseguir completar, explique o que fez e onde parou
- Resposta FINAL curta e direta (2-3 frases + 1-2 emojis)
- Durante execução intermediária, foque na tarefa (não converse)
- Se a tarefa for simples (pergunta, conversa), responda direto sem usar ferramentas

SISTEMA DE MEMÓRIA (IMPORTANTE):
Você tem memória persistente em arquivos. Use as ferramentas para ler e escrever neles.

Caminhos dos arquivos de memória:
- ${memoryDir}/personality.md → Sua personalidade (raramente edita)
- ${memoryDir}/user.md → Info sobre o usuário (atualize quando descobrir algo novo: nome, preferências, etc)
- ${memoryDir}/daily/${todayStr}.md → Memória de hoje (APPEND um resumo curto após cada tarefa concluída)
- ${memoryDir}/tasks.md → Tarefas pendentes

REGRAS DE MEMÓRIA:
- Após COMPLETAR uma tarefa, escreva um resumo curto (1 linha) no daily de hoje usando write_file com mode append. SEMPRE comece com \\n antes do texto.
- Se o usuário disser o nome dele, atualize user.md imediatamente
- Se o usuário pedir pra lembrar algo, anote em user.md ou no daily
- Se o usuário criar uma tarefa agendada ("me lembre às 14h de...", "me avise quando...", etc), LEIA o tasks.md primeiro, depois adicione a nova tarefa usando write_file com mode append. O conteúdo DEVE começar com \\n (quebra de linha) seguido do formato: - [ ] HH:MM - Descrição. Exemplo de conteúdo para write_file append: "\\n- [ ] 14:30 - Tomar água"
- Quando completar uma tarefa de tasks.md, marque como [x] usando edit_block
- Se o usuário perguntar "o que você fez ontem/semana passada", leia os arquivos em ${memoryDir}/daily/
- HORA ATUAL DO SISTEMA: ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} (use como referência para tarefas)

FERRAMENTAS DISPONÍVEIS (via Desktop Commander MCP):
${toolNames}

VOCÊ TEM CONTROLE TOTAL DO COMPUTADOR. Pode criar, editar, ler e apagar qualquer arquivo em qualquer pasta.

Principais ferramentas:
- write_file: CRIA ou SOBRESCREVE qualquer arquivo (HTML, JS, CSS, TXT, JSON, PY, etc). Passe o caminho completo e o conteúdo. Use mode "rewrite" pra criar/sobrescrever, mode "append" pra adicionar ao final. Para arquivos grandes, escreva em chunks de 30 linhas (primeiro rewrite, depois append).
- read_file: Lê conteúdo de qualquer arquivo
- edit_block: Edita trecho específico de um arquivo existente (old_string → new_string)
- execute_command: Executa qualquer comando no terminal (abrir programas, rodar scripts, instalar pacotes, etc)
- list_directory: Lista arquivos e pastas
- search_files: Busca arquivos por nome/padrão
- search_code: Busca texto dentro de arquivos
- move_file: Move ou renomeia arquivos
- create_directory: Cria pastas

DICA IMPORTANTE PARA CRIAR ARQUIVOS:
Quando o usuário pedir pra criar um arquivo (HTML, script, documento, etc):
1. Use write_file com o caminho COMPLETO (ex: D:/Users/Desktop/meusite.html)
2. Se o usuário não especificar o caminho, pergunte onde quer salvar
3. Para arquivos grandes, quebre em chunks usando mode "append" após o primeiro write
4. Após criar, confirme o caminho completo do arquivo pro usuário

Use quantas tool_calls precisar por rodada. Você pode encadear múltiplas ações.

SKILLS (HABILIDADES ESPECIAIS):
Você tem acesso a skills que ensinam como fazer coisas específicas.
Cada skill é um arquivo .md com instruções detalhadas.

Skills disponíveis:
${skillsText}

COMO USAR SKILLS:
- Quando o usuário pedir algo que envolva uma skill, PRIMEIRO leia o arquivo .md da skill usando read_file
- Siga as instruções da skill passo a passo
- Se a skill precisar de configuração (API keys, credenciais), guie o usuário
- Se não existir uma skill pra algo, tente resolver com as ferramentas básicas
- O usuário pode criar novas skills pedindo pra você criar um arquivo .md em ${SKILLS_DIR.replace(/\\/g, '/')}/`
  };

  return new Promise(async (resolve) => {
    try {
      const msgs = [sys, ...history, { role: 'user', content: userMessage }];
      const bodyObj = { model: OPENAI_MODEL, max_tokens: 1000, messages: msgs };
      if (openaiTools.length > 0) bodyObj.tools = openaiTools;
      
      let iteration = 0;

      // ========== AGENTIC LOOP ==========
      while (iteration < MAX_AGENT_ITERATIONS) {
        iteration++;

        // Checa cancelamento
        if (agentCancelled) {
          sendAgentEvent('agent-cancelled', { iteration });
          resolve(`Parei na iteração ${iteration}. O que já fiz está feito! ✋`);
          return;
        }

        let response = await callOpenAI(bodyObj);
        console.log(`[AGENT] Iteração ${iteration}:`, response.tool_calls ? `${response.tool_calls.length} tool_calls` : 'resposta final');
        
        // Se NÃO tem tool_calls → resposta final, sai do loop
        if (!response.tool_calls || response.tool_calls.length === 0) {
          const finalResponse = response.content || 'Pronto! ✅';
          // Extração de memória assíncrona (não bloqueia resposta)
          if (memoryExtractor) {
            memoryExtractor.processMessage(userMessage, finalResponse).catch(e => 
              console.error('[MEMORY-EXT] Erro:', e.message)
            );
          }
          resolve(finalResponse);
          return;
        }

        // Tem tool_calls → executa todas e alimenta de volta
        // Adiciona a mensagem do assistant com tool_calls
        msgs.push({ role: 'assistant', content: response.content || null, tool_calls: response.tool_calls });

        for (const tc of response.tool_calls) {
          const toolName = tc.function.name;
          let toolArgs = {};
          try { toolArgs = JSON.parse(tc.function.arguments); } catch(e) {}

          console.log(`[AGENT] Tool call: ${toolName}`, JSON.stringify(toolArgs).substring(0, 200));

          // ---- PROTEÇÃO: Tool perigosa → pede confirmação (exceto memória/tasks) ----
          if (DANGEROUS_TOOLS.includes(toolName) && !isSafePath(toolName, toolArgs)) {
            sendAgentEvent('agent-step', { tool: toolName, args: toolArgs, iteration, status: 'confirming' });
            
            const allowed = await askUserConfirmation(toolName, toolArgs);
            
            if (!allowed) {
              console.log(`[AGENT] Usuário NEGOU: ${toolName}`);
              msgs.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: 'NEGADO: O usuário não permitiu esta ação. Tente uma abordagem diferente ou pergunte ao usuário o que fazer.'
              });
              sendAgentEvent('agent-step', { tool: toolName, args: toolArgs, iteration, status: 'denied' });
              continue;
            }
          }

          // ---- Executa a tool ----
          sendAgentEvent('agent-step', { tool: toolName, args: toolArgs, iteration, status: 'executing' });

          let toolResult = '';
          try {
            // Tenta executar via Tool Registry primeiro (tem todas as 44+ tools)
            if (buddyAgent && buddyAgent.toolRegistry) {
              const registryTool = buddyAgent.toolRegistry.get(toolName);
              if (registryTool && registryTool.execute) {
                toolResult = await registryTool.execute(toolArgs);
              } else if (mcpClient && mcpClient.ready) {
                toolResult = await mcpClient.callTool(toolName, toolArgs);
              } else {
                toolResult = `Erro: Tool "${toolName}" não encontrada`;
              }
            } else if (mcpClient && mcpClient.ready) {
              toolResult = await mcpClient.callTool(toolName, toolArgs);
            } else {
              toolResult = `Erro: Nenhum executor disponível para "${toolName}"`;
            }
          } catch (e) {
            toolResult = `Erro: ${e.message}`;
          }

          // Trunca resultados muito longos pra não estourar contexto
          const truncated = typeof toolResult === 'string' 
            ? toolResult.substring(0, 3000) 
            : JSON.stringify(toolResult).substring(0, 3000);

          msgs.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: truncated
          });

          sendAgentEvent('agent-step', { tool: toolName, args: toolArgs, iteration, status: 'done' });
        }

        // Atualiza bodyObj com mensagens acumuladas pra próxima iteração
        bodyObj.messages = msgs;
      }

      // Estourou o limite de iterações
      console.log(`[AGENT] Limite de ${MAX_AGENT_ITERATIONS} iterações atingido`);
      resolve(`Fiz ${MAX_AGENT_ITERATIONS} passos mas a tarefa ficou complexa demais. Veja o que já fiz e me diga como continuar! 🤔`);

    } catch (e) {
      console.error('[AGENT] Erro:', e.message);
      resolve('Algo deu errado: ' + e.message);
    }
  });
});

// ============================================================
// AGENT HELPERS
// ============================================================

// Envia evento de step do agente pro renderer
function sendAgentEvent(type, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(type, data);
  }
}

// Pede confirmação do usuário pra ações perigosas (retorna Promise<boolean>)
function askUserConfirmation(toolName, toolArgs) {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      resolve(false);
      return;
    }

    // Envia pedido de confirmação pro renderer
    mainWindow.webContents.send('agent-confirm', { tool: toolName, args: toolArgs });

    // Espera resposta do renderer (timeout de 60s)
    const timeout = setTimeout(() => {
      ipcMain.removeAllListeners('agent-confirm-reply');
      resolve(false);
    }, 60000);

    // Escuta resposta única via send (não invoke)
    ipcMain.once('agent-confirm-reply', (event, allowed) => {
      clearTimeout(timeout);
      resolve(allowed);
    });
  });
}

// Helper: retorna API keys das settings para o llm-provider
function getApiKeys() {
  const s = settingsManager.load();
  return {
    openai: OPENAI_API_KEY || s.openaiApiKey,
    anthropic: s.anthropicApiKey || '',
    google: s.googleApiKey || ''
  };
}

// Helper: chama LLM via multi-provider e retorna message
function callOpenAI(bodyObj) {
  const s = settingsManager.load();
  const fallback = s.fallbackEnabled !== false ? s.fallbackOrder : null;
  return callLLM(bodyObj, getApiKeys(), fallback);
}
