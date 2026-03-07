// === Atlas UI Application ===

let currentScreen = 'today';
let chatActive = false;
let cachedEmailData = null;
let cachedCalendarData = null;
let lastChatRole = null;

// === Toast System ===

function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// === Markdown Renderer ===

function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  // Headers (## → h2, ### → h3, # → h1)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '<em>$1</em>');
  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Unordered lists
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*?<\/li>\s*)+)/g, '<ul>$1</ul>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Paragraph breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = '<p>' + html + '</p>';
  // Clean up empty paragraphs and breaks around block elements
  html = html.replace(/<p><(h[123]|ul|ol)/g, '<$1');
  html = html.replace(/<\/(h[123]|ul|ol)><\/p>/g, '</$1>');
  html = html.replace(/<br><(h[123]|ul|ol|li)/g, '<$1');
  html = html.replace(/<\/(h[123]|ul|ol|li)><br>/g, '</$1>');
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p><br>/g, '<p>');
  return html;
}

function timeNow() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// === Navigation ===

function navigateTo(screen) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  document.getElementById(`screen-${screen}`).classList.add('active');
  document.querySelector(`.nav-item[data-screen="${screen}"]`).classList.add('active');
  currentScreen = screen;
  loadScreen(screen);
}

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => navigateTo(item.dataset.screen));
});

// === Tab Navigation ===

document.querySelectorAll('.tabs').forEach((tabBar) => {
  tabBar.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const parent = tab.closest('.screen');
      parent.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      parent.querySelectorAll('.tab-content').forEach((c) => { c.style.display = 'none'; c.classList.remove('active'); });
      tab.classList.add('active');
      const content = parent.querySelector(`#${tab.dataset.tab}`);
      if (content) { content.style.display = 'block'; content.classList.add('active'); }
      if (parent.id === 'screen-memory') loadMemory();
      if (parent.id === 'screen-settings') loadSettings();
    });
  });
});

// === Screen Loaders ===

async function loadScreen(screen) {
  switch (screen) {
    case 'today': return loadToday();
    case 'goals': return loadGoals();
    case 'actions': return loadActions();
    case 'memory': return loadMemory();
    case 'sessions': return loadSessions();
    case 'files': return loadFiles();
    case 'email': return loadEmail();
    case 'settings': return loadSettings();
  }
}

// === TODAY ===

async function loadToday() {
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  document.getElementById('today-date').textContent = today;

  const [goals, actions, overdue] = await Promise.all([
    atlas.goals.getActive(),
    atlas.actions.getOpen(),
    atlas.actions.getOverdue(),
  ]);

  document.getElementById('stat-goals').textContent = goals.length;
  document.getElementById('stat-actions').textContent = actions.length;
  document.getElementById('stat-overdue').textContent = overdue.length;

  const badge = document.getElementById('overdue-badge');
  if (overdue.length > 0) {
    badge.textContent = overdue.length;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }

  renderCalendarPanel();
  renderContextSummary();
}

function renderCalendarPanel() {
  const panel = document.getElementById('today-calendar');
  const container = document.getElementById('today-calendar-events');

  if (!cachedCalendarData || !cachedCalendarData.today || cachedCalendarData.today.length === 0) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  container.innerHTML = cachedCalendarData.today.map((event) => {
    const time = event.start && event.start.dateTime
      ? new Date(event.start.dateTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : 'All day';
    const endTime = event.end && event.end.dateTime
      ? new Date(event.end.dateTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : '';
    return `<div class="list-item">
      <div class="item-main">
        <div class="item-title">${escapeHtml(event.summary || 'Untitled')}</div>
        <div class="item-subtitle">${time}${endTime ? ' – ' + endTime : ''}${event.location ? ' | ' + escapeHtml(event.location) : ''}</div>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('btn-generate-brief').addEventListener('click', async () => {
  const btn = document.getElementById('btn-generate-brief');
  const loading = document.getElementById('today-loading');
  const card = document.getElementById('brief-card');

  btn.disabled = true;
  loading.style.display = 'flex';
  card.style.display = 'none';

  try {
    const options = {};
    if (cachedCalendarData) options.calendarData = cachedCalendarData;
    if (cachedEmailData) options.emailData = cachedEmailData;

    const brief = await atlas.brief.generate(options);
    if (brief) {
      document.getElementById('brief-content').innerHTML = renderMarkdown(brief);
      document.getElementById('brief-time').textContent = timeNow();
      card.style.display = 'block';
    } else {
      document.getElementById('brief-content').textContent = 'No brief generated. Make sure you have at least one active goal.';
      card.style.display = 'block';
    }
  } catch (err) {
    console.error('Brief generation error:', err);
    document.getElementById('brief-content').textContent = `Error: ${err.message}`;
    card.style.display = 'block';
  }

  btn.disabled = false;
  loading.style.display = 'none';
});

// === CHAT ===

document.getElementById('btn-chat-start').addEventListener('click', async () => {
  const btn = document.getElementById('btn-chat-start');
  btn.disabled = true;
  document.getElementById('chat-status').textContent = 'Starting session...';

  try {
    const options = {};
    if (cachedCalendarData) options.calendarData = cachedCalendarData;
    if (cachedEmailData) options.emailData = cachedEmailData;

    const result = await atlas.chat.start(options);
    if (result.error) {
      document.getElementById('chat-status').textContent = result.error;
      btn.disabled = false;
      return;
    }

    chatActive = true;
    lastChatRole = null;
    document.getElementById('chat-status').textContent = 'Session active';
    document.getElementById('btn-chat-start').style.display = 'none';
    document.getElementById('btn-chat-end').style.display = 'inline-flex';
    document.getElementById('chat-input-bar').style.display = 'flex';
    document.getElementById('chat-messages').innerHTML = '';

    if (result.opening) {
      appendChatMessage('chat-messages', 'atlas', result.opening);
    }

    document.getElementById('chat-input').focus();
  } catch (err) {
    document.getElementById('chat-status').textContent = `Error: ${err.message}`;
    btn.disabled = false;
  }
});

document.getElementById('btn-chat-end').addEventListener('click', async () => {
  if (!chatActive) return;
  document.getElementById('btn-chat-end').disabled = true;
  document.getElementById('chat-status').textContent = 'Processing session...';

  try {
    const result = await atlas.chat.end();
    if (result) {
      appendChatMessage('chat-messages', 'system', `Session ended. ${result.entries} entries extracted, ${result.actions} action items tracked.`);
    }
  } catch {}

  chatActive = false;
  lastChatRole = null;
  document.getElementById('btn-chat-start').style.display = 'inline-flex';
  document.getElementById('btn-chat-start').disabled = false;
  document.getElementById('btn-chat-end').style.display = 'none';
  document.getElementById('btn-chat-end').disabled = false;
  document.getElementById('chat-input-bar').style.display = 'none';
  document.getElementById('chat-status').textContent = 'Session ended.';
});

document.getElementById('btn-chat-send').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message || !chatActive) return;

  input.value = '';
  input.disabled = true;
  document.getElementById('btn-chat-send').disabled = true;

  appendChatMessage('chat-messages', 'user', message);
  const thinkingEl = showTypingIndicator('chat-messages');

  try {
    const result = await atlas.chat.send(message);

    // Show markers above the response
    if (result.markers && result.markers.length > 0) {
      for (const m of result.markers) {
        const markerDiv = document.createElement('div');
        markerDiv.className = 'chat-marker';
        markerDiv.textContent = `${m.type === 'search' ? 'Web search' : m.type === 'recall' ? 'Memory recall' : 'Email search'}: ${m.query}`;
        thinkingEl.before(markerDiv);
      }
    }

    // Replace typing indicator with actual message
    removeTypingIndicator(thinkingEl);
    appendChatMessage('chat-messages', 'atlas', result.response || result.error);
  } catch (err) {
    removeTypingIndicator(thinkingEl);
    appendChatMessage('chat-messages', 'system', `Error: ${err.message}`);
  }

  input.disabled = false;
  document.getElementById('btn-chat-send').disabled = false;
  input.focus();
}

// === Shared message rendering ===

function appendChatMessage(containerId, role, content) {
  const messages = document.getElementById(containerId);
  const div = document.createElement('div');
  const isGrouped = (role === lastChatRole && role !== 'system');
  div.className = `chat-message ${role}${isGrouped ? ' grouped' : ''}`;

  const roleLabel = role === 'user' ? 'You' : role === 'atlas' ? 'Atlas' : 'System';
  const rendered = (role === 'atlas') ? renderMarkdown(content) : escapeHtml(content);
  const time = timeNow();

  div.innerHTML = `
    <div class="msg-role">${roleLabel}<span class="msg-time">${time}</span></div>
    <div class="msg-content md-content">${rendered}</div>
  `;

  if (containerId === 'chat-messages') lastChatRole = role;

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function showTypingIndicator(containerId) {
  const messages = document.getElementById(containerId);
  const div = document.createElement('div');
  div.className = 'chat-message atlas typing';
  div.innerHTML = `
    <div class="msg-role">Atlas<span class="msg-time">${timeNow()}</span></div>
    <div class="msg-content"><div class="typing-indicator"><span></span><span></span><span></span></div></div>
  `;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function removeTypingIndicator(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

// === GOALS ===

let goalInterviewActive = false;
let goalInterviewExchanges = 0;

async function loadGoals() {
  if (goalInterviewActive) return;
  const goals = await atlas.goals.getAll();
  const container = document.getElementById('goals-list');

  if (goals.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No goals defined yet. Click "New Goal" to get started.</p></div>';
    return;
  }

  container.innerHTML = goals.map((g) => {
    const data = g.goal_data || {};
    const statusTag = g.status === 'active' ? 'tag-success' : g.status === 'paused' ? 'tag-warning' : 'tag-secondary';
    const priorityTag = g.priority === 'primary' ? 'tag-primary' : g.priority === 'secondary' ? 'tag-warning' : 'tag-secondary';

    return `<div class="card">
      <div class="card-header">
        <span class="card-title">${escapeHtml(g.title)}</span>
        <div>
          <span class="tag ${priorityTag}">${g.priority || 'unset'}</span>
          <span class="tag ${statusTag}">${g.status}</span>
        </div>
      </div>
      <div class="card-body md-content">
        ${data.outcome ? `<div><strong>Outcome:</strong> ${escapeHtml(data.outcome)}</div>` : ''}
        ${data.metric ? `<div><strong>Metric:</strong> ${escapeHtml(data.metric)}</div>` : ''}
        ${data.target_date ? `<div><strong>Target:</strong> ${data.target_date}</div>` : ''}
        ${data.baseline ? `<div><strong>Baseline:</strong> ${escapeHtml(data.baseline)}</div>` : ''}
        ${data.next_milestone ? `<div><strong>Next milestone:</strong> ${escapeHtml(data.next_milestone)}</div>` : ''}
      </div>
      <div style="margin-top:10px" class="btn-group">
        <button class="btn btn-sm" onclick="startGoalEdit('${g.id}')">Edit</button>
        ${g.status === 'active' ? `<button class="btn btn-sm" onclick="updateGoalStatus('${g.id}', 'paused')">Pause</button>` : ''}
        ${g.status === 'paused' ? `<button class="btn btn-sm" onclick="updateGoalStatus('${g.id}', 'active')">Resume</button>` : ''}
        ${g.status === 'completed' ? `<button class="btn btn-sm" onclick="updateGoalStatus('${g.id}', 'active')">Reactivate</button>` : ''}
        ${g.status !== 'completed' ? `<button class="btn btn-sm btn-primary" onclick="updateGoalStatus('${g.id}', 'completed')">Complete</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function updateGoalStatus(id, status) {
  await atlas.goals.updateStatus(id, status);
  loadGoals();
  loadToday();
}

// --- Conversational Goal Interview ---

document.getElementById('btn-new-goal').addEventListener('click', () => startGoalInterview());

async function startGoalInterview(goalId) {
  goalInterviewActive = true;
  const isEdit = !!goalId;

  document.getElementById('goals-list').style.display = 'none';
  document.getElementById('btn-new-goal').style.display = 'none';
  document.getElementById('goal-interview-panel').style.display = 'flex';
  document.getElementById('goal-interview-messages').innerHTML = '';
  document.getElementById('goal-interview-title').textContent = isEdit ? 'Updating goal...' : 'Defining a new goal...';
  document.getElementById('btn-goal-interview-save').style.display = 'none';
  goalInterviewExchanges = 0;

  const typingEl = showTypingIndicator('goal-interview-messages');

  try {
    const result = await atlas.interview.start(goalId ? { goalId } : {});
    removeTypingIndicator(typingEl);

    if (result.error) {
      appendInterviewMessage('system', result.error);
      return;
    }

    appendInterviewMessage('atlas', result.opening);
    document.getElementById('goal-interview-input').focus();
  } catch (err) {
    removeTypingIndicator(typingEl);
    appendInterviewMessage('system', `Error: ${err.message}`);
  }
}

async function startGoalEdit(goalId) {
  navigateTo('goals');
  await startGoalInterview(goalId);
}

function cancelGoalInterview() {
  goalInterviewActive = false;
  document.getElementById('goal-interview-panel').style.display = 'none';
  document.getElementById('goals-list').style.display = '';
  document.getElementById('btn-new-goal').style.display = '';
  document.getElementById('goal-interview-messages').innerHTML = '';
  loadGoals();
}

let interviewLastRole = null;

function appendInterviewMessage(role, content) {
  const messages = document.getElementById('goal-interview-messages');
  const div = document.createElement('div');
  const isGrouped = (role === interviewLastRole && role !== 'system');
  div.className = `chat-message ${role}${isGrouped ? ' grouped' : ''}`;
  const roleLabel = role === 'user' ? 'You' : role === 'atlas' ? 'Atlas' : 'System';
  const rendered = (role === 'atlas') ? renderMarkdown(content) : escapeHtml(content);

  div.innerHTML = `
    <div class="msg-role">${roleLabel}<span class="msg-time">${timeNow()}</span></div>
    <div class="msg-content md-content">${rendered}</div>
  `;

  interviewLastRole = role;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

document.getElementById('btn-goal-interview-send').addEventListener('click', sendGoalInterviewMessage);
document.getElementById('goal-interview-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendGoalInterviewMessage(); }
});

async function sendGoalInterviewMessage() {
  const input = document.getElementById('goal-interview-input');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  input.disabled = true;
  document.getElementById('btn-goal-interview-send').disabled = true;

  appendInterviewMessage('user', message);
  const typingEl = showTypingIndicator('goal-interview-messages');

  try {
    const result = await atlas.interview.send(message);
    removeTypingIndicator(typingEl);
    appendInterviewMessage('atlas', result.response);
    goalInterviewExchanges++;

    // Show manual save button after 2+ exchanges as a fallback
    if (goalInterviewExchanges >= 2) {
      document.getElementById('btn-goal-interview-save').style.display = '';
    }

    if (result.isReady) {
      // Goal is ready — save it
      input.disabled = true;
      document.getElementById('btn-goal-interview-send').disabled = true;
      const typingEl2 = showTypingIndicator('goal-interview-messages');

      try {
        const saved = await atlas.interview.complete();
        removeTypingIndicator(typingEl2);
        appendInterviewMessage('system', `Goal "${saved.title}" saved successfully.`);

        setTimeout(() => {
          cancelGoalInterview();
          loadToday();
        }, 1500);
      } catch (err) {
        removeTypingIndicator(typingEl2);
        appendInterviewMessage('system', `Error saving goal: ${err.message}`);
        input.disabled = false;
        document.getElementById('btn-goal-interview-send').disabled = false;
      }
      return;
    }
  } catch (err) {
    removeTypingIndicator(typingEl);
    appendInterviewMessage('system', `Error: ${err.message}`);
  }

  input.disabled = false;
  document.getElementById('btn-goal-interview-send').disabled = false;
  input.focus();
}

// Manual save button — fallback when GOAL_READY isn't triggered
document.getElementById('btn-goal-interview-save').addEventListener('click', async () => {
  const btn = document.getElementById('btn-goal-interview-save');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  document.getElementById('goal-interview-input').disabled = true;
  document.getElementById('btn-goal-interview-send').disabled = true;

  const typingEl = showTypingIndicator('goal-interview-messages');

  try {
    const saved = await atlas.interview.complete();
    removeTypingIndicator(typingEl);
    appendInterviewMessage('system', `Goal "${saved.title}" saved successfully.`);

    setTimeout(() => {
      cancelGoalInterview();
      loadToday();
    }, 1500);
  } catch (err) {
    removeTypingIndicator(typingEl);
    appendInterviewMessage('system', `Error saving goal: ${err.message}`);
    document.getElementById('goal-interview-input').disabled = false;
    document.getElementById('btn-goal-interview-send').disabled = false;
  }

  btn.disabled = false;
  btn.textContent = 'Save Goal';
});

// === ACTIONS ===

async function loadActions() {
  const status = document.getElementById('actions-filter-status').value;
  const goalFilter = document.getElementById('actions-filter-goal').value;

  let actions;
  if (status === 'all') {
    actions = await atlas.actions.getAll();
  } else if (status === 'completed') {
    actions = await atlas.actions.getCompleted();
  } else {
    actions = await atlas.actions.getOpen();
  }

  if (goalFilter) {
    actions = actions.filter((a) => a.goal_id === goalFilter);
  }

  const goals = await atlas.goals.getActive();
  const goalSelect = document.getElementById('actions-filter-goal');
  const currentVal = goalSelect.value;
  goalSelect.innerHTML = '<option value="">All Goals</option>' +
    goals.map((g) => `<option value="${g.id}">${escapeHtml(g.title)}</option>`).join('');
  goalSelect.value = currentVal;

  const container = document.getElementById('actions-list');
  const today = new Date().toISOString().split('T')[0];

  if (actions.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No actions to show.</p></div>';
    return;
  }

  container.innerHTML = actions.map((a) => {
    const isOverdue = a.due_date && a.due_date < today && a.status === 'open';
    const followups = a.follow_up_count > 0 ? ` <span class="tag tag-warning">${a.follow_up_count}x follow-up</span>` : '';
    const statusTag = a.status === 'completed' ? '<span class="tag tag-success">completed</span>' :
                      a.status === 'deferred' ? '<span class="tag tag-warning">deferred</span>' :
                      a.status === 'dropped' ? '<span class="tag tag-secondary">dropped</span>' : '';

    return `<div class="list-item">
      <div class="item-main">
        <div class="item-title ${isOverdue ? 'overdue' : ''}">${escapeHtml(a.description)}${followups}</div>
        <div class="item-subtitle">
          ${a.due_date ? `Due: <span class="${isOverdue ? 'overdue' : ''}">${a.due_date}</span>` : 'No due date'}
          ${a.goal_id ? ` | Goal: ${a.goal_id}` : ''}
          ${statusTag ? ` | ${statusTag}` : ''}
        </div>
      </div>
      ${a.status === 'open' ? `<div class="btn-group">
        <button class="btn btn-sm btn-primary" onclick="completeAction('${a.id}')">Complete</button>
        <button class="btn btn-sm" onclick="deferAction('${a.id}')">Defer</button>
        <button class="btn btn-sm btn-danger" onclick="dropAction('${a.id}')">Drop</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

async function completeAction(id) {
  await atlas.actions.update(id, { status: 'completed' });
  loadActions();
  loadToday();
}

async function deferAction(id) {
  await atlas.actions.update(id, { status: 'deferred' });
  loadActions();
}

async function dropAction(id) {
  await atlas.actions.update(id, { status: 'dropped' });
  loadActions();
}

document.getElementById('actions-filter-status').addEventListener('change', loadActions);
document.getElementById('actions-filter-goal').addEventListener('change', loadActions);

// === MEMORY ===

async function loadMemory() {
  const activeTab = document.querySelector('#screen-memory .tab.active');
  if (!activeTab) return;
  switch (activeTab.dataset.tab) {
    case 'memory-context': return loadMemoryContext();
    case 'memory-entries': return loadMemoryEntries();
    case 'memory-overrides': return loadMemoryOverrides();
  }
}

async function loadMemoryContext() {
  const ctx = await atlas.context.load();
  const warnings = await atlas.context.checkPlaceholders();
  const container = document.getElementById('memory-context');

  const files = [
    { name: 'IDENTITY.md', label: 'Identity', content: ctx.identity, desc: 'Your stable identity — name, background, communication style.', prompt: 'Tell me about yourself — your background, where you\'re based, what you do.' },
    { name: 'SITUATION.md', label: 'Situation', content: ctx.situation, desc: 'Your current situation — employment, finances, living.', prompt: 'What\'s your current situation? Employment, finances, anything I should know.' },
    { name: 'PREFERENCES.md', label: 'Preferences', content: ctx.preferences, desc: 'Your advisory preferences — directness, working style.', prompt: 'How do you want me to work with you? How direct should I be?' },
  ];

  container.innerHTML = `
    <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">
      These are <strong>user-maintained</strong> files. Atlas reads them but does not edit them. You can edit directly or let Atlas interview you.
    </p>
    ${warnings.length > 0 ? `<div class="card" style="border-color:var(--warning);margin-bottom:16px">
      <div class="card-body" style="color:var(--warning)">Some files still have placeholder content. Click "Talk to Atlas about this" to fill them in conversationally.</div>
    </div>` : ''}
    ${files.map((f) => `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${f.label}</span>
          <div>
            <span class="tag tag-primary">user-maintained</span>
            <button class="btn btn-sm" style="margin-left:8px" onclick="startContextInterview('${f.name}', '${escapeHtml(f.prompt)}')">Talk to Atlas about this</button>
          </div>
        </div>
        <p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">${f.desc}</p>
        <textarea class="form-textarea" id="ctx-${f.name}" rows="8">${escapeHtml(f.content)}</textarea>
        <div style="margin-top:8px">
          <button class="btn btn-sm btn-primary" onclick="saveContext('${f.name}')">Save</button>
        </div>
      </div>
    `).join('')}
  `;
}

async function saveContext(filename) {
  const textarea = document.getElementById(`ctx-${filename}`);
  await atlas.context.save(filename, textarea.value);
  textarea.style.borderColor = 'var(--success)';
  setTimeout(() => { textarea.style.borderColor = ''; }, 1000);
}

// --- Conversational Context Update ---

let contextInterviewFile = null;
let contextInterviewHistory = [];

function startContextInterview(filename, openingPrompt) {
  contextInterviewFile = filename;
  contextInterviewHistory = [];
  document.getElementById('context-interview-title').textContent = `Update ${filename.replace('.md', '')}`;
  document.getElementById('context-interview-messages').innerHTML = '';
  document.getElementById('context-interview-proposed').style.display = 'none';
  document.getElementById('context-interview-input').value = '';
  document.getElementById('modal-context-interview').classList.add('active');

  // Send opening message from Atlas
  const typingEl = showTypingIndicator('context-interview-messages');

  atlas.context.interview(filename, openingPrompt, []).then((result) => {
    removeTypingIndicator(typingEl);
    appendContextInterviewMessage('atlas', result.response);
    contextInterviewHistory.push({ role: 'Atlas', content: result.response });
    document.getElementById('context-interview-input').focus();
  }).catch((err) => {
    removeTypingIndicator(typingEl);
    appendContextInterviewMessage('system', `Error: ${err.message}`);
  });
}

function appendContextInterviewMessage(role, content) {
  const messages = document.getElementById('context-interview-messages');
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;
  const roleLabel = role === 'user' ? 'You' : role === 'atlas' ? 'Atlas' : 'System';
  const rendered = (role === 'atlas') ? renderMarkdown(content) : escapeHtml(content);
  div.innerHTML = `
    <div class="msg-role">${roleLabel}<span class="msg-time">${timeNow()}</span></div>
    <div class="msg-content md-content">${rendered}</div>
  `;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

document.getElementById('btn-context-interview-send').addEventListener('click', sendContextInterviewMessage);
document.getElementById('context-interview-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendContextInterviewMessage(); }
});

async function sendContextInterviewMessage() {
  const input = document.getElementById('context-interview-input');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  input.disabled = true;
  document.getElementById('btn-context-interview-send').disabled = true;

  appendContextInterviewMessage('user', message);
  contextInterviewHistory.push({ role: 'User', content: message });

  const typingEl = showTypingIndicator('context-interview-messages');

  try {
    const result = await atlas.context.interview(contextInterviewFile, message, contextInterviewHistory.slice(0, -1));
    removeTypingIndicator(typingEl);
    appendContextInterviewMessage('atlas', result.response);
    contextInterviewHistory.push({ role: 'Atlas', content: result.response });

    if (result.isReady && result.proposedContent) {
      document.getElementById('context-proposed-content').textContent = result.proposedContent;
      document.getElementById('context-interview-proposed').style.display = 'block';
      document.getElementById('context-interview-input-bar').style.display = 'none';
    }
  } catch (err) {
    removeTypingIndicator(typingEl);
    appendContextInterviewMessage('system', `Error: ${err.message}`);
  }

  input.disabled = false;
  document.getElementById('btn-context-interview-send').disabled = false;
  input.focus();
}

document.getElementById('btn-context-accept').addEventListener('click', async () => {
  const content = document.getElementById('context-proposed-content').textContent;
  await atlas.context.save(contextInterviewFile, content);
  appendContextInterviewMessage('system', 'Saved successfully.');
  document.getElementById('context-interview-proposed').style.display = 'none';
  setTimeout(() => {
    closeModal('modal-context-interview');
    loadMemoryContext();
  }, 1000);
});

document.getElementById('btn-context-revise').addEventListener('click', () => {
  document.getElementById('context-interview-proposed').style.display = 'none';
  document.getElementById('context-interview-input-bar').style.display = 'flex';
  document.getElementById('context-interview-input').focus();
});

// --- Memory Entries ---

let allEntries = [];

async function loadMemoryEntries() {
  const container = document.getElementById('entries-list-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div> Loading entries...</div>';

  const [recent, persistent] = await Promise.all([
    atlas.entries.getRecent(30),
    atlas.entries.getPersistent(),
  ]);

  allEntries = [...persistent, ...recent].reduce((acc, e) => {
    if (!acc.find((x) => x.id === e.id)) acc.push(e);
    return acc;
  }, []);

  renderFilteredEntries();
}

function renderFilteredEntries() {
  const container = document.getElementById('entries-list-container');
  const searchTerm = (document.getElementById('entries-search').value || '').toLowerCase().trim();
  const typeFilter = document.getElementById('entries-filter-type').value;
  const domainFilter = document.getElementById('entries-filter-domain').value;

  let filtered = allEntries;
  if (searchTerm) filtered = filtered.filter((e) => (e.content || '').toLowerCase().includes(searchTerm));
  if (typeFilter) filtered = filtered.filter((e) => e.entry_type === typeFilter);
  if (domainFilter) filtered = filtered.filter((e) => e.domain === domainFilter);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No entries match the current filters.</p></div>';
    return;
  }

  container.innerHTML = filtered.map((e) => {
    const source = e.source === 'session' ? 'auto-captured' : e.source;
    const importanceTag = e.importance >= 4 ? 'tag-danger' : e.importance >= 3 ? 'tag-warning' : 'tag-secondary';
    return `<div class="list-item">
      <div class="item-main">
        <div class="item-title">${escapeHtml(e.content)}</div>
        <div class="item-subtitle">
          <span class="tag tag-secondary">${e.entry_type}</span>
          <span class="tag tag-secondary">${e.domain}</span>
          <span class="tag ${importanceTag}">importance: ${e.importance}</span>
          <span class="tag tag-primary">${source}</span>
          ${e.goal_id ? `<span class="tag tag-secondary">${e.goal_id}</span>` : ''}
          <span style="margin-left:8px;color:var(--text-muted)">${e.date || ''}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('entries-search').addEventListener('input', renderFilteredEntries);
document.getElementById('entries-filter-type').addEventListener('change', renderFilteredEntries);
document.getElementById('entries-filter-domain').addEventListener('change', renderFilteredEntries);

async function loadMemoryOverrides() {
  const container = document.getElementById('memory-overrides');
  const overrides = await atlas.overrides.getAll();

  if (!overrides || overrides.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No overrides recorded.</p></div>';
    return;
  }

  const unresolved = overrides.filter((o) => !o.outcome);
  const resolved = overrides.filter((o) => o.outcome);

  let html = '';

  if (unresolved.length > 0) {
    html += '<h3 style="font-size:14px;margin-bottom:12px">Pending Calibration</h3>';
    html += unresolved.map((o) => `
      <div class="card" style="border-left:3px solid var(--warning)">
        <div class="card-header">
          <span class="card-title">Override</span>
          <span class="card-meta">${new Date(o.created_at).toLocaleDateString()}</span>
        </div>
        <div class="card-body md-content">
          <div><strong>Atlas recommended:</strong> ${renderMarkdown(o.atlas_recommendation || '')}</div>
          <div><strong>You decided:</strong> ${renderMarkdown(o.user_decision || '')}</div>
          ${o.user_reasoning ? `<div><strong>Reasoning:</strong> ${escapeHtml(o.user_reasoning)}</div>` : ''}
        </div>
        <div class="btn-group" style="margin-top:8px">
          <button class="btn btn-sm btn-primary" onclick="calibrateOverride('${o.id}', 'user_right')">I was right</button>
          <button class="btn btn-sm" onclick="calibrateOverride('${o.id}', 'atlas_right')">Atlas was right</button>
          <button class="btn btn-sm" onclick="calibrateOverride('${o.id}', 'mixed')">Mixed / unclear</button>
        </div>
      </div>
    `).join('');
  }

  if (resolved.length > 0) {
    const atlasRight = resolved.filter((o) => o.outcome === 'atlas_right').length;
    const userRight = resolved.filter((o) => o.outcome === 'user_right').length;
    const mixed = resolved.filter((o) => o.outcome === 'mixed').length;

    html += `<h3 style="font-size:14px;margin:16px 0 12px">Calibration History</h3>
      <div class="grid grid-3" style="margin-bottom:12px">
        <div class="stat-card"><div class="stat-value">${userRight}</div><div class="stat-label">You Were Right</div></div>
        <div class="stat-card"><div class="stat-value">${atlasRight}</div><div class="stat-label">Atlas Was Right</div></div>
        <div class="stat-card"><div class="stat-value">${mixed}</div><div class="stat-label">Mixed</div></div>
      </div>`;

    html += resolved.map((o) => {
      const outcomeTag = o.outcome === 'user_right' ? 'tag-success' : o.outcome === 'atlas_right' ? 'tag-warning' : 'tag-secondary';
      const outcomeLabel = o.outcome === 'user_right' ? 'You were right' : o.outcome === 'atlas_right' ? 'Atlas was right' : 'Mixed';
      return `<div class="list-item">
        <div class="item-main">
          <div class="item-title" style="font-size:13px">${escapeHtml((o.user_decision || '').substring(0, 100))}</div>
          <div class="item-subtitle">
            <span class="tag ${outcomeTag}">${outcomeLabel}</span>
            <span style="margin-left:8px">${new Date(o.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  container.innerHTML = html || '<div class="empty-state"><p>No overrides recorded.</p></div>';
}

async function calibrateOverride(id, outcome) {
  try {
    await atlas.overrides.update(id, { outcome });
    showToast('Override calibrated', 'success');
    loadMemoryOverrides();
  } catch (err) {
    showToast(`Calibration failed: ${err.message}`, 'error');
  }
}

// === SESSIONS ===

async function loadSessions() {
  const sessions = await atlas.sessions.getRecent(30);
  const container = document.getElementById('sessions-list');

  if (sessions.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No sessions yet.</p></div>';
    return;
  }

  container.innerHTML = sessions.map((s) => `
    <div class="card session-card" onclick="toggleSessionDetail('${s.id}', this)" style="cursor:pointer">
      <div class="card-header">
        <span class="card-title">${s.date}</span>
        <div>
          <span class="tag tag-secondary">${s.mode || 'advisory'}</span>
          ${s.duration_minutes ? `<span class="tag tag-secondary">${s.duration_minutes} min</span>` : ''}
        </div>
      </div>
      <div class="card-body md-content">${s.summary ? renderMarkdown(s.summary) : '<em>No summary</em>'}</div>
      <div class="session-detail" id="session-detail-${s.id}" style="display:none;margin-top:12px;border-top:1px solid var(--border);padding-top:12px">
        <div class="loading"><div class="spinner"></div> Loading...</div>
      </div>
    </div>
  `).join('');
}

async function toggleSessionDetail(sessionId, cardEl) {
  const detail = document.getElementById(`session-detail-${sessionId}`);
  if (detail.style.display !== 'none') {
    detail.style.display = 'none';
    return;
  }

  detail.style.display = 'block';

  try {
    const entries = await atlas.entries.getBySession(sessionId);
    if (entries.length === 0) {
      detail.innerHTML = '<div style="color:var(--text-secondary);font-size:13px">No entries extracted from this session.</div>';
      return;
    }

    detail.innerHTML = `
      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px"><strong>${entries.length}</strong> entries extracted:</div>
      ${entries.map((e) => {
        const importanceTag = e.importance >= 4 ? 'tag-danger' : e.importance >= 3 ? 'tag-warning' : 'tag-secondary';
        return `<div class="list-item" style="padding:6px 0">
          <div class="item-main">
            <div style="font-size:13px">${escapeHtml(e.content)}</div>
            <div class="item-subtitle">
              <span class="tag tag-secondary">${e.entry_type}</span>
              <span class="tag tag-secondary">${e.domain}</span>
              <span class="tag ${importanceTag}">imp: ${e.importance}</span>
            </div>
          </div>
        </div>`;
      }).join('')}
    `;
  } catch (err) {
    detail.innerHTML = `<div style="color:var(--danger);font-size:13px">Failed to load: ${escapeHtml(err.message)}</div>`;
  }
}

// === FILES ===

async function loadFiles() {
  const files = await atlas.files.list();
  const container = document.getElementById('files-list');

  if (files.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No files ingested. Upload a document to get started.</p></div>';
    return;
  }

  container.innerHTML = files.map((f) => `
    <div class="list-item">
      <div class="item-main">
        <div class="item-title">${escapeHtml(f.filename)}</div>
        <div class="item-subtitle">
          <span class="tag tag-secondary">${f.file_type}</span>
          ${f.goal_id ? `<span class="tag tag-primary">${f.goal_id}</span>` : ''}
          <span style="margin-left:8px">${new Date(f.uploaded_at).toLocaleDateString()}</span>
        </div>
      </div>
      <button class="btn btn-sm btn-danger" onclick="deleteFile('${f.id}')">Delete</button>
    </div>
  `).join('');
}

document.getElementById('btn-upload-file').addEventListener('click', async () => {
  try {
    const result = await atlas.files.pickAndIngest(null);
    if (result) loadFiles();
  } catch (err) {
    showToast(`Upload failed: ${err.message}`, 'error');
  }
});

async function deleteFile(id) {
  if (!confirm('Delete this file?')) return;
  await atlas.files.delete(id);
  loadFiles();
}

// === EMAIL ===

async function loadEmail() {
  const data = await atlas.email.getCached();
  renderEmailData(data);
}

function renderEmailData(data) {
  const stats = document.getElementById('email-stats');
  const list = document.getElementById('email-list');

  if (!data) {
    stats.innerHTML = '';
    list.innerHTML = '<div class="empty-state"><p>No email data. Gmail may not be configured, or emails haven\'t been fetched yet.</p></div>';
    return;
  }

  stats.innerHTML = `
    <div class="stat-card"><div class="stat-value">${data.triageCount || 0}</div><div class="stat-label">Scanned (72h)</div></div>
    <div class="stat-card"><div class="stat-value">${data.deepReadCount || 0}</div><div class="stat-label">Deeply Read</div></div>
    <div class="stat-card"><div class="stat-value">${data.unreadCount || 0}</div><div class="stat-label">Inbox Unread</div></div>
  `;

  if (!data.summaries || data.summaries.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>No goal-relevant emails found.</p></div>';
    return;
  }

  list.innerHTML = data.summaries.map((s) => `
    <div class="card">
      <div class="card-header">
        <span class="card-title">${escapeHtml(s.subject)}</span>
        <span class="tag ${s.isUnread ? 'tag-warning' : 'tag-secondary'}">${s.isUnread ? 'UNREAD' : 'read'}</span>
      </div>
      <div class="card-body">
        <div><strong>From:</strong> ${escapeHtml(s.from)}</div>
        <div><strong>Date:</strong> ${s.date}</div>
        ${s.threadExpanded && s.threadMessages ? `
          <div style="margin-top:8px"><strong>Thread (${s.threadMessages.length} messages):</strong></div>
          ${s.threadMessages.map((m) => `
            <div style="margin:4px 0;padding:8px;background:var(--bg);border-radius:4px;font-size:12px">
              <div style="color:var(--text-secondary)">${escapeHtml(m.from)} — ${m.date}</div>
              <div style="margin-top:4px;white-space:pre-wrap">${escapeHtml(m.body.substring(0, 300))}</div>
            </div>
          `).join('')}
        ` : `
          <div style="margin-top:8px;white-space:pre-wrap;font-size:13px">${escapeHtml((s.body || '').substring(0, 500))}</div>
        `}
      </div>
    </div>
  `).join('');
}

document.getElementById('btn-refresh-email').addEventListener('click', async () => {
  const btn = document.getElementById('btn-refresh-email');
  btn.disabled = true;
  btn.textContent = 'Fetching...';
  try {
    const data = await atlas.email.fetch();
    cachedEmailData = data;
    renderEmailData(data);
  } catch (err) {
    showToast(`Email fetch failed: ${err.message}`, 'error');
  }
  btn.disabled = false;
  btn.textContent = 'Refresh';
});

// === SETTINGS ===

async function loadSettings() {
  const activeTab = document.querySelector('#screen-settings .tab.active');
  if (!activeTab) return;
  switch (activeTab.dataset.tab) {
    case 'settings-integrations': return loadSettingsIntegrations();
    case 'settings-agents': return loadSettingsAgents();
    case 'settings-methodology': return loadSettingsMethodology();
    case 'settings-diagnostics': return loadSettingsDiagnostics();
  }
}

// loadSettingsIntegrations is defined above (near engine settings section)

async function loadSettingsAgents() {
  const container = document.getElementById('settings-agents');
  const specs = await atlas.settings.getAgentSpecs();
  if (specs.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No agent specs found.</p></div>';
    return;
  }
  container.innerHTML = specs.map((spec, i) => {
    const title = spec.split('\n')[0].replace(/^#\s*/, '').trim() || `Perspective ${i + 1}`;
    return `<div class="card">
      <div class="card-title" style="margin-bottom:8px">${escapeHtml(title)}</div>
      <div class="card-body md-content">${renderMarkdown(spec)}</div>
    </div>`;
  }).join('');
}

async function loadSettingsMethodology() {
  const container = document.getElementById('settings-methodology');
  const methodology = await atlas.settings.getMethodology();
  if (!methodology) {
    container.innerHTML = '<div class="empty-state"><p>No methodology file found.</p></div>';
    return;
  }
  container.innerHTML = `
    <div class="card">
      <div class="card-title" style="margin-bottom:12px">Advisory Methodology</div>
      <div class="card-body md-content" style="max-height:600px;overflow-y:auto">${renderMarkdown(methodology)}</div>
    </div>
  `;
}

async function loadSettingsDiagnostics() {
  const container = document.getElementById('settings-diagnostics');
  const diag = await atlas.settings.getDiagnostics();
  if (!diag) {
    container.innerHTML = '<div class="empty-state"><p>No diagnostics yet. Generate a brief or start a chat session first.</p></div>';
    return;
  }
  const pct = Math.round((diag.totalTokens / diag.tokenCeiling) * 100);
  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">Context Assembly Diagnostics</span>
        <span class="card-meta">${new Date(diag.timestamp).toLocaleString()}</span>
      </div>
      <div class="card-body">
        <div class="grid grid-3" style="margin-bottom:16px">
          <div class="stat-card"><div class="stat-value">${diag.totalTokens}</div><div class="stat-label">Total Tokens (${pct}%)</div></div>
          <div class="stat-card"><div class="stat-value">${diag.coreTokens}</div><div class="stat-label">Core (fixed)</div></div>
          <div class="stat-card"><div class="stat-value">${diag.tokenCeiling}</div><div class="stat-label">Ceiling</div></div>
        </div>
        <h3 style="font-size:14px;margin-bottom:8px">Data Counts</h3>
        <div class="grid grid-3" style="margin-bottom:16px">
          <div><strong>Goals:</strong> ${diag.counts.goals}</div>
          <div><strong>Open Actions:</strong> ${diag.counts.openActions}</div>
          <div><strong>Overdue:</strong> ${diag.counts.overdueActions}</div>
          <div><strong>Persistent Entries:</strong> ${diag.counts.persistentEntries}</div>
          <div><strong>Recent Entries:</strong> ${diag.counts.recentEntries}</div>
          <div><strong>Recent Sessions:</strong> ${diag.counts.recentSessions}</div>
          <div><strong>Calendar:</strong> ${diag.counts.hasCalendar ? diag.counts.calendarEvents + ' events' : 'No'}</div>
          <div><strong>Email Triaged:</strong> ${diag.counts.emailTriaged}</div>
          <div><strong>Email Deep Read:</strong> ${diag.counts.emailDeepRead}</div>
        </div>
        <h3 style="font-size:14px;margin-bottom:8px">Included Sections</h3>
        ${diag.includedSections.length > 0 ? diag.includedSections.map((s) => `
          <div class="list-item" style="padding:4px 0">
            <div class="item-main"><div style="font-size:13px">${escapeHtml(s.label)} — ${s.tokens} tokens, ${s.items} items${s.trimmed ? ' <span class="tag tag-warning">trimmed</span>' : ''}</div></div>
          </div>
        `).join('') : '<div style="color:var(--text-secondary)">None</div>'}
        ${diag.trimmedSections.length > 0 ? `
          <h3 style="font-size:14px;margin:12px 0 8px">Dropped Sections</h3>
          ${diag.trimmedSections.map((s) => `<div class="tag tag-danger" style="margin-right:4px">${escapeHtml(s)}</div>`).join('')}
        ` : ''}
      </div>
    </div>
  `;
}

// === Utilities ===

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
});

// === PDF Export ===

async function exportBriefPDF() {
  const content = document.getElementById('brief-content').innerHTML;
  if (!content) {
    showToast('No brief content to export', 'warning');
    return;
  }
  try {
    const cardTitle = document.querySelector('#brief-card .card-title');
    const title = cardTitle ? cardTitle.textContent : 'Brief';
    const result = await atlas.export.pdf(content, title);
    if (result) showToast('PDF exported successfully', 'success');
  } catch (err) {
    showToast(`PDF export failed: ${err.message}`, 'error');
  }
}

// === End-of-Day Reflection ===

document.getElementById('btn-generate-reflection').addEventListener('click', async () => {
  const btn = document.getElementById('btn-generate-reflection');
  const loading = document.getElementById('today-loading');
  const card = document.getElementById('brief-card');

  btn.disabled = true;
  loading.style.display = 'flex';
  loading.querySelector('div:last-child') && (loading.innerHTML = '<div class="spinner"></div> Generating reflection...');
  card.style.display = 'none';

  try {
    const options = {};
    if (cachedCalendarData) options.calendarData = cachedCalendarData;
    if (cachedEmailData) options.emailData = cachedEmailData;

    const reflection = await atlas.brief.reflection(options);
    if (reflection) {
      document.getElementById('brief-content').innerHTML = renderMarkdown(reflection);
      document.getElementById('brief-time').textContent = `Reflection — ${timeNow()}`;
      card.style.display = 'block';
      card.querySelector('.card-title').textContent = 'End-of-Day Reflection';
      showToast('Reflection generated', 'success');
    } else {
      document.getElementById('brief-content').textContent = 'No reflection generated. Make sure you have at least one active goal.';
      card.style.display = 'block';
    }
  } catch (err) {
    showToast(`Reflection error: ${err.message}`, 'error');
  }

  btn.disabled = false;
  loading.style.display = 'none';
});

// === Context Visibility ===

async function renderContextSummary() {
  const panel = document.getElementById('today-context-summary');
  const badges = document.getElementById('today-context-badges');
  const diag = await atlas.settings.getDiagnostics();

  const sources = [
    { key: 'gmail', label: 'Gmail', icon: '✉' },
    { key: 'calendar', label: 'Calendar', icon: '📅' },
    { key: 'files', label: 'Files', icon: '📄' },
    { key: 'memory', label: 'Memory', icon: '🧠' },
    { key: 'web_search', label: 'Web Search', icon: '🔍' },
  ];

  // Check integration availability
  let googleConfigured = false;
  try { googleConfigured = await atlas.settings.isGoogleConfigured(); } catch {}

  const sourceStatus = {};
  if (diag && diag.sourcePolicy) {
    for (const s of sources) {
      sourceStatus[s.key] = diag.sourcePolicy[s.key];
    }
  }

  badges.innerHTML = sources.map((s) => {
    const active = sourceStatus[s.key];
    const unavailable = (s.key === 'gmail' || s.key === 'calendar') && !googleConfigured;
    const cls = unavailable ? 'inactive' : active ? 'active' : 'inactive';
    const label = unavailable ? `${s.label} (not configured)` : active ? s.label : `${s.label} (excluded)`;
    return `<div class="context-badge ${cls}"><span class="badge-dot"></span>${s.icon} ${label}</div>`;
  }).join('');

  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
}

// === Engine Settings ===

async function loadSettingsIntegrations() {
  const container = document.getElementById('settings-integrations');
  const googleConfigured = await atlas.settings.isGoogleConfigured();
  let engines = [];
  try { engines = await atlas.settings.getEngines(); } catch {}

  const activeEngine = engines.find((e) => e.active) || { name: 'claude' };

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">Google Calendar & Gmail</span>
        <span class="tag ${googleConfigured ? 'tag-success' : 'tag-warning'}">${googleConfigured ? 'Connected' : 'Not connected'}</span>
      </div>
      <div class="card-body">${googleConfigured
        ? 'Google services are connected. Calendar and email data will be included in sessions and briefs.'
        : 'Not connected. Run the terminal app (<code>npm start</code>) to complete the OAuth setup flow.'}</div>
    </div>
    <div class="card">
      <div class="card-header">
        <span class="card-title">AI Engine</span>
        <span class="tag tag-primary">${escapeHtml(activeEngine.name)}</span>
      </div>
      <div class="card-body">
        <p style="margin-bottom:8px">Current engine: <strong>${escapeHtml(activeEngine.name)}</strong></p>
        ${engines.length > 1 ? `<div class="btn-group">${engines.map((e) =>
          `<button class="btn btn-sm ${e.active ? 'btn-primary' : ''}" onclick="switchEngine('${e.name}')"${e.active ? ' disabled' : ''}>${escapeHtml(e.name)}</button>`
        ).join('')}</div>` : '<p style="color:var(--text-secondary);font-size:12px">Uses Claude Code CLI. Only one engine currently available.</p>'}
      </div>
    </div>
  `;
}

async function switchEngine(name) {
  try {
    await atlas.settings.setEngine(name);
    showToast(`Engine switched to ${name}`, 'success');
    loadSettingsIntegrations();
  } catch (err) {
    showToast(`Failed to switch engine: ${err.message}`, 'error');
  }
}

// === Init ===

async function init() {
  await loadToday();

  try {
    cachedCalendarData = await atlas.calendar.fetch();
    renderCalendarPanel();
  } catch {}

  try {
    cachedEmailData = await atlas.email.fetch();
  } catch {}

  loadToday();
}

init();
