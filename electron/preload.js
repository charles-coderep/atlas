const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atlas', {
  // Goals
  goals: {
    getActive: () => ipcRenderer.invoke('goals:getActive'),
    getAll: () => ipcRenderer.invoke('goals:getAll'),
    get: (id) => ipcRenderer.invoke('goals:get', id),
    save: (goal) => ipcRenderer.invoke('goals:save', goal),
    updateStatus: (id, status) => ipcRenderer.invoke('goals:updateStatus', id, status),
    generateId: () => ipcRenderer.invoke('goals:generateId'),
    updateSources: (id, sources) => ipcRenderer.invoke('goals:updateSources', id, sources),
  },

  // Actions
  actions: {
    getOpen: () => ipcRenderer.invoke('actions:getOpen'),
    getOverdue: () => ipcRenderer.invoke('actions:getOverdue'),
    getCompleted: () => ipcRenderer.invoke('actions:getCompleted'),
    getAll: () => ipcRenderer.invoke('actions:getAll'),
    update: (id, updates) => ipcRenderer.invoke('actions:update', id, updates),
    save: (action) => ipcRenderer.invoke('actions:save', action),
  },

  // Sessions
  sessions: {
    getRecent: (days) => ipcRenderer.invoke('sessions:getRecent', days),
    create: (mode) => ipcRenderer.invoke('sessions:create', mode),
    update: (id, updates) => ipcRenderer.invoke('sessions:update', id, updates),
  },

  // Entries
  entries: {
    getRecent: (days) => ipcRenderer.invoke('entries:getRecent', days),
    getPersistent: () => ipcRenderer.invoke('entries:getPersistent'),
    search: (keywords, limit) => ipcRenderer.invoke('entries:search', keywords, limit),
    getByGoal: (goalId, days) => ipcRenderer.invoke('entries:getByGoal', goalId, days),
    getBySession: (sessionId) => ipcRenderer.invoke('entries:getBySession', sessionId),
  },

  // Overrides
  overrides: {
    getUnresolved: () => ipcRenderer.invoke('overrides:getUnresolved'),
    getAll: () => ipcRenderer.invoke('overrides:getAll'),
    update: (id, updates) => ipcRenderer.invoke('overrides:update', id, updates),
  },

  // Files
  files: {
    list: () => ipcRenderer.invoke('files:list'),
    get: (id) => ipcRenderer.invoke('files:get', id),
    ingest: (filePath, goalId) => ipcRenderer.invoke('files:ingest', filePath, goalId),
    delete: (id) => ipcRenderer.invoke('files:delete', id),
    pickAndIngest: (goalId) => ipcRenderer.invoke('files:pickAndIngest', goalId),
  },

  // Brief
  brief: {
    generate: (options) => ipcRenderer.invoke('brief:generate', options),
    reflection: (options) => ipcRenderer.invoke('brief:reflection', options),
  },

  // Chat
  chat: {
    start: (options) => ipcRenderer.invoke('chat:start', options),
    send: (message) => ipcRenderer.invoke('chat:send', message),
    end: () => ipcRenderer.invoke('chat:end'),
  },

  // Search
  search: {
    web: (query) => ipcRenderer.invoke('search:web', query),
    entries: (keywords, limit) => ipcRenderer.invoke('search:entries', keywords, limit),
  },

  // Email
  email: {
    fetch: () => ipcRenderer.invoke('email:fetch'),
    search: (query) => ipcRenderer.invoke('email:search', query),
    getCached: () => ipcRenderer.invoke('email:getCached'),
  },

  // Calendar
  calendar: {
    fetch: () => ipcRenderer.invoke('calendar:fetch'),
  },

  // User Context
  context: {
    load: () => ipcRenderer.invoke('context:load'),
    save: (file, content) => ipcRenderer.invoke('context:save', file, content),
    checkPlaceholders: () => ipcRenderer.invoke('context:checkPlaceholders'),
    interview: (file, message, history) => ipcRenderer.invoke('context:interview', file, message, history),
  },

  // Settings
  settings: {
    getAgentSpecs: () => ipcRenderer.invoke('settings:getAgentSpecs'),
    getMethodology: () => ipcRenderer.invoke('settings:getMethodology'),
    isGoogleConfigured: () => ipcRenderer.invoke('settings:isGoogleConfigured'),
    getDiagnostics: () => ipcRenderer.invoke('settings:getDiagnostics'),
    getEngines: () => ipcRenderer.invoke('settings:getEngines'),
    setEngine: (name) => ipcRenderer.invoke('settings:setEngine', name),
  },

  // Export
  export: {
    pdf: (htmlContent, title) => ipcRenderer.invoke('export:pdf', htmlContent, title),
  },

  // Interview (conversational)
  interview: {
    start: (options) => ipcRenderer.invoke('interview:start', options),
    send: (message) => ipcRenderer.invoke('interview:send', message),
    complete: () => ipcRenderer.invoke('interview:complete'),
    structure: (answers) => ipcRenderer.invoke('interview:structure', answers),
  },
});
