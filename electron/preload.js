const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atlas', {
  // Goals
  goals: {
    getActive: () => ipcRenderer.invoke('goals:getActive'),
    getAll: () => ipcRenderer.invoke('goals:getAll'),
    getArchived: () => ipcRenderer.invoke('goals:getArchived'),
    get: (id) => ipcRenderer.invoke('goals:get', id),
    save: (goal) => ipcRenderer.invoke('goals:save', goal),
    updateStatus: (id, status) => ipcRenderer.invoke('goals:updateStatus', id, status),
    archive: (id) => ipcRenderer.invoke('goals:archive', id),
    unarchive: (id) => ipcRenderer.invoke('goals:unarchive', id),
    countLinked: (goalId) => ipcRenderer.invoke('goals:countLinked', goalId),
    deleteCascade: (goalId, level) => ipcRenderer.invoke('goals:deleteCascade', goalId, level),
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
    delete: (id) => ipcRenderer.invoke('sessions:delete', id),
    deleteAll: () => ipcRenderer.invoke('sessions:deleteAll'),
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
    rescue: () => ipcRenderer.invoke('brief:rescue'),
    weeklyReview: (options) => ipcRenderer.invoke('brief:weeklyReview', options),
  },

  // Decisions
  decisions: {
    save: (d) => ipcRenderer.invoke('decisions:save', d),
    getPending: () => ipcRenderer.invoke('decisions:getPending'),
    getAll: () => ipcRenderer.invoke('decisions:getAll'),
    update: (id, u) => ipcRenderer.invoke('decisions:update', id, u),
  },

  // Alerts
  alerts: {
    get: () => ipcRenderer.invoke('atlas:getAlerts'),
  },

  // Chat
  chat: {
    start: (options) => ipcRenderer.invoke('chat:start', options),
    send: (message, options) => ipcRenderer.invoke('chat:send', message, options),
    end: () => ipcRenderer.invoke('chat:end'),
    prepare: (desc) => ipcRenderer.invoke('chat:prepare', desc),
    onProcessingStatus: (callback) => ipcRenderer.on('chat:processing-status', (_, status) => callback(status)),
    onStreamChunk: (callback) => ipcRenderer.on('chat:stream-chunk', (_, chunk) => callback(chunk)),
    onStreamEnd: (callback) => ipcRenderer.on('chat:stream-end', () => callback()),
    onStreamError: (callback) => ipcRenderer.on('chat:stream-error', (_, err) => callback(err)),
    onStreamReplace: (callback) => ipcRenderer.on('chat:stream-replace', (_, text) => callback(text)),
    removeStreamListeners: () => {
      ipcRenderer.removeAllListeners('chat:stream-chunk');
      ipcRenderer.removeAllListeners('chat:stream-end');
      ipcRenderer.removeAllListeners('chat:stream-error');
      ipcRenderer.removeAllListeners('chat:stream-replace');
    },
  },

  // Voice
  voice: {
    isAvailable: () => ipcRenderer.invoke('voice:isAvailable'),
    transcribe: (audioBuffer) => ipcRenderer.invoke('voice:transcribe', audioBuffer),
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
    interview: (file, message, history, options) => ipcRenderer.invoke('context:interview', file, message, history, options),
    onStreamChunk: (callback) => ipcRenderer.on('context:stream-chunk', (_, chunk) => callback(chunk)),
    onStreamEnd: (callback) => ipcRenderer.on('context:stream-end', () => callback()),
    onStreamError: (callback) => ipcRenderer.on('context:stream-error', (_, err) => callback(err)),
    removeStreamListeners: () => {
      ipcRenderer.removeAllListeners('context:stream-chunk');
      ipcRenderer.removeAllListeners('context:stream-end');
      ipcRenderer.removeAllListeners('context:stream-error');
    },
  },

  // Settings
  settings: {
    getAgentSpecs: () => ipcRenderer.invoke('settings:getAgentSpecs'),
    listAgentFiles: () => ipcRenderer.invoke('settings:listAgentFiles'),
    saveAgentSpec: (name, content) => ipcRenderer.invoke('settings:saveAgentSpec', name, content),
    deleteAgentSpec: (name) => ipcRenderer.invoke('settings:deleteAgentSpec', name),
    getAgentDefaults: () => ipcRenderer.invoke('settings:getAgentDefaults'),
    generatePerspective: (name, domain) => ipcRenderer.invoke('settings:generatePerspective', name, domain),
    perspectiveExists: (name) => ipcRenderer.invoke('settings:perspectiveExists', name),
    getMethodology: () => ipcRenderer.invoke('settings:getMethodology'),
    isGoogleConfigured: () => ipcRenderer.invoke('settings:isGoogleConfigured'),
    getDiagnostics: () => ipcRenderer.invoke('settings:getDiagnostics'),
    getEngines: () => ipcRenderer.invoke('settings:getEngines'),
    setEngine: (name) => ipcRenderer.invoke('settings:setEngine', name),
    getTones: () => ipcRenderer.invoke('settings:getTones'),
    setTone: (name) => ipcRenderer.invoke('settings:setTone', name),
    resetAll: () => ipcRenderer.invoke('settings:resetAll'),
    regenerateUserModel: () => ipcRenderer.invoke('settings:regenerateUserModel'),
    getUserModelStatus: () => ipcRenderer.invoke('settings:getUserModelStatus'),
  },

  // Health
  health: {
    check: () => ipcRenderer.invoke('health:check'),
  },

  // Export
  export: {
    pdf: (htmlContent, title) => ipcRenderer.invoke('export:pdf', htmlContent, title),
  },

  // Interview (conversational)
  interview: {
    start: (options) => ipcRenderer.invoke('interview:start', options),
    send: (message, options) => ipcRenderer.invoke('interview:send', message, options),
    complete: () => ipcRenderer.invoke('interview:complete'),
    structure: (answers) => ipcRenderer.invoke('interview:structure', answers),
    onStreamChunk: (callback) => ipcRenderer.on('interview:stream-chunk', (_, chunk) => callback(chunk)),
    onStreamEnd: (callback) => ipcRenderer.on('interview:stream-end', () => callback()),
    onStreamError: (callback) => ipcRenderer.on('interview:stream-error', (_, err) => callback(err)),
    removeStreamListeners: () => {
      ipcRenderer.removeAllListeners('interview:stream-chunk');
      ipcRenderer.removeAllListeners('interview:stream-end');
      ipcRenderer.removeAllListeners('interview:stream-error');
    },
  },
});
