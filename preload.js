const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddyAPI', {
  dragStart: (mousePos) => ipcRenderer.send('drag-start', mousePos),
  dragMove: (mousePos) => ipcRenderer.send('drag-move', mousePos),
  dragEnd: () => ipcRenderer.send('drag-end'),
  closeApp: () => ipcRenderer.send('close-app'),
  minimizeApp: () => ipcRenderer.send('minimize-app'),
  chatWithClaude: (message, history) => ipcRenderer.invoke('chat-with-claude', message, history),
  voiceControl: (cmd) => ipcRenderer.send('voice-control', cmd),
  onVoiceEvent: (callback) => ipcRenderer.on('voice-event', (event, data) => callback(data)),
  // Agent events
  onAgentStep: (callback) => ipcRenderer.on('agent-step', (event, data) => callback(data)),
  onAgentConfirm: (callback) => ipcRenderer.on('agent-confirm', (event, data) => callback(data)),
  onAgentCancelled: (callback) => ipcRenderer.on('agent-cancelled', (event, data) => callback(data)),
  agentConfirmResponse: (allowed) => ipcRenderer.send('agent-confirm-reply', allowed),
  agentCancel: () => ipcRenderer.send('agent-cancel'),
  // Agent 2.0 — Sistema de Agente Inteligente
  agentRunTask: (goal, context) => ipcRenderer.invoke('agent-run-task', goal, context),
  agentCancelTask: (taskId) => ipcRenderer.send('agent-cancel-task', taskId),
  agentStatus: () => ipcRenderer.invoke('agent-status'),
  onAgentEvent: (eventName, callback) => ipcRenderer.on(eventName, (event, data) => callback(data)),
  // Scheduler events
  onScheduledTask: (callback) => ipcRenderer.on('scheduled-task', (event, data) => callback(data)),
  onTriggerAgentMessage: (callback) => ipcRenderer.on('trigger-agent-message', (event, data) => callback(data)),
  schedulerTaskDone: () => ipcRenderer.send('scheduler-task-done'),
  // Reminder events
  onReminderFired: (callback) => ipcRenderer.on('agent-reminder-fired', (event, data) => callback(data)),
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
});
