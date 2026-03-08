// === Atlas UI Application ===

let currentScreen = 'today';
let chatActive = false;
let cachedEmailData = null;
let cachedCalendarData = null;
let lastChatRole = null;
let streamingMessageEl = null;
let streamingContent = '';
let showArchivedGoals = false;
let openGoalMoreMenuId = null;
let pendingGoalDelete = null;
// Voice state managed in initVoice()
let isRecording = false;

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

// === Sidebar Sources Toggle ===

document.getElementById('sources-toggle').addEventListener('click', () => {
  const items = document.getElementById('sources-items');
  const arrow = document.getElementById('sources-arrow');
  items.classList.toggle('collapsed');
  arrow.classList.toggle('collapsed');
});

async function updateSourceStatuses() {
  try {
    const goals = await atlas.goals.getActive();
    const files = await atlas.files.list();

    // Email status
    const emailEl = document.getElementById('source-status-email');
    const emailGoals = goals.filter(g => g.goal_data?.context_sources?.gmail === 'included');
    if (emailGoals.length > 0) {
      emailEl.textContent = 'Active';
      emailEl.className = 'nav-source-status active';
    } else {
      emailEl.textContent = 'Inactive';
      emailEl.className = 'nav-source-status';
    }

    // Files status
    const filesEl = document.getElementById('source-status-files');
    filesEl.textContent = files.length > 0 ? `${files.length} file${files.length !== 1 ? 's' : ''}` : 'empty';
    filesEl.className = files.length > 0 ? 'nav-source-status active' : 'nav-source-status';
  } catch {}
}

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
    case 'guide': return loadGuide();
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
  updateSourceStatuses();
  updateReflectionButton();
}

async function updateReflectionButton() {
  const btn = document.getElementById('btn-generate-reflection');
  const hour = new Date().getHours();
  const todaySessions = await atlas.sessions.getRecent(1);
  const hasSessions = todaySessions.length > 0;

  if (!hasSessions) {
    btn.style.display = 'none';
  } else if (hour >= 17) {
    btn.style.display = '';
    btn.className = 'btn btn-primary';
    btn.textContent = 'End-of-Day Reflection';
  } else {
    btn.style.display = '';
    btn.className = 'btn btn-sm';
    btn.textContent = 'Reflect on today';
  }
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
  const briefStartedAt = performance.now();

  btn.disabled = true;
  loading.style.display = 'flex';
  card.style.display = 'none';

  try {
    const options = {};
    if (cachedCalendarData) options.calendarData = cachedCalendarData;
    if (cachedEmailData) options.emailData = cachedEmailData;

    const brief = await atlas.brief.generate(options);
    console.log(`[Timing] Brief generated in ${Math.round(performance.now() - briefStartedAt)}ms`);
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
  const messages = document.getElementById('chat-messages');
  let typingEl = null;
  let thinkingNoteTimer = null;
  const startTime = performance.now();

  btn.disabled = true;
  document.getElementById('chat-status').textContent = 'Atlas is preparing...';
  messages.innerHTML = '';
  lastChatRole = null;
  typingEl = showTypingIndicator('chat-messages');
  thinkingNoteTimer = window.setTimeout(() => {
    appendChatMessage('chat-messages', 'system', 'Atlas is thinking - this can take a moment on first load.');
  }, 10000);

  try {
    const options = {};
    if (cachedCalendarData) options.calendarData = cachedCalendarData;
    if (cachedEmailData) options.emailData = cachedEmailData;

    const result = await atlas.chat.start(options);
    console.log(`[Timing] Session opening generated in ${Math.round(performance.now() - startTime)}ms`);
    if (result.error) {
      clearTimeout(thinkingNoteTimer);
      removeTypingIndicator(typingEl);
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
    clearTimeout(thinkingNoteTimer);
    removeTypingIndicator(typingEl);

    if (result.opening) {
      appendChatMessage('chat-messages', 'atlas', result.opening);
    } else {
      appendChatMessage('chat-messages', 'atlas', "I'm ready. What's the highest-leverage thing to work through?");
    }

    document.getElementById('chat-input').focus();
  } catch (err) {
    clearTimeout(thinkingNoteTimer);
    removeTypingIndicator(typingEl);
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
  const requestStartedAt = performance.now();
  let firstChunkLogged = false;
  let streamErrored = false;

  input.value = '';
  input.disabled = true;
  document.getElementById('btn-chat-send').disabled = true;

  appendChatMessage('chat-messages', 'user', message);

  // Reset streaming state
  streamingContent = '';
  streamingMessageEl = null;
  let streamCreated = false;

  atlas.chat.removeStreamListeners();

  atlas.chat.onStreamChunk((chunk) => {
    if (!firstChunkLogged) {
      console.log(`[Timing] Chat stream first chunk in ${Math.round(performance.now() - requestStartedAt)}ms`);
      firstChunkLogged = true;
    }
    console.log(`[Streaming] chunk received (${chunk.length} chars)`);
    streamingContent += chunk;
    if (!streamingMessageEl) {
      // Remove typing indicator on first chunk
      removeTypingIndicator(thinkingEl);
      streamingMessageEl = appendChatMessage('chat-messages', 'atlas', '');
      streamingMessageEl.classList.add('streaming');
      streamCreated = true;
    }
    const contentEl = streamingMessageEl.querySelector('.msg-content');
    if (contentEl) {
      contentEl.innerHTML = renderMarkdown(streamingContent);
      contentEl.classList.add('streaming-cursor');
    }
    const messages = document.getElementById('chat-messages');
    messages.scrollTop = messages.scrollHeight;
  });

  atlas.chat.onStreamEnd(() => {
    if (streamingMessageEl) {
      const contentEl = streamingMessageEl.querySelector('.msg-content');
      if (contentEl) {
        contentEl.innerHTML = renderMarkdown(streamingContent);
        contentEl.classList.remove('streaming-cursor');
      }
      streamingMessageEl.classList.remove('streaming');
    }
  });

  atlas.chat.onStreamError((err) => {
    streamErrored = true;
    removeTypingIndicator(thinkingEl);
    if (streamingMessageEl) {
      streamingMessageEl.remove();
      streamingMessageEl = null;
    }
    appendChatMessage('chat-messages', 'system', `Error: ${err}`);
  });

  atlas.chat.onStreamReplace((fullText) => {
    streamCreated = true;
    if (!streamingMessageEl) {
      removeTypingIndicator(thinkingEl);
      streamingMessageEl = appendChatMessage('chat-messages', 'atlas', '');
    }
    const contentEl = streamingMessageEl.querySelector('.msg-content');
    if (contentEl) {
      contentEl.innerHTML = renderMarkdown(fullText);
      contentEl.classList.remove('streaming-cursor');
    }
    streamingMessageEl.classList.remove('streaming');
  });

  const thinkingEl = showTypingIndicator('chat-messages');

  try {
    const result = await atlas.chat.sendStreaming(message);
    console.log(`[Timing] Chat request completed in ${Math.round(performance.now() - requestStartedAt)}ms`);

    // Remove typing indicator if streaming never started
    removeTypingIndicator(thinkingEl);

    if (!streamErrored && result && result.error) {
      appendChatMessage('chat-messages', 'system', `Error: ${result.error}`);
      return;
    }

    // Show markers if any
    if (result && result.markers && result.markers.length > 0) {
      for (const m of result.markers) {
        showToast(`${m.type === 'search' ? 'Web search' : m.type === 'recall' ? 'Memory recall' : 'Email search'}: ${m.query}`, 'info', 3000);
      }
    }

    // Only show buffered response if streaming never created a message
    if (!streamCreated && result && result.response) {
      appendChatMessage('chat-messages', 'atlas', result.response);
    }
  } catch (err) {
    removeTypingIndicator(thinkingEl);
    if (streamingMessageEl) {
      streamingMessageEl.remove();
    }
    appendChatMessage('chat-messages', 'system', `Error: ${err.message}`);
  }

  atlas.chat.removeStreamListeners();
  streamingMessageEl = null;
  streamingContent = '';
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
  const archiveToggle = document.getElementById('toggle-show-archived');
  if (archiveToggle) archiveToggle.checked = showArchivedGoals;
  const archivedCount = goals.filter((g) => g.status === 'archived').length;
  const visibleGoals = [...goals]
    .filter((g) => showArchivedGoals || g.status !== 'archived')
    .sort((a, b) => {
      const order = { active: 0, paused: 1, completed: 2, archived: 3 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });

  if (goals.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No goals defined yet. Click "New Goal" to get started.</p></div>';
    return;
  }

  if (visibleGoals.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No goals match the current filter.</p>
        ${archivedCount > 0 ? '<p style="color:var(--text-secondary)">You have archived goals. Turn on "Show archived goals" to see them.</p>' : ''}
      </div>
    `;
    return;
  }

  let allAgents = [];
  try { allAgents = await atlas.settings.listAgentFiles(); } catch {}

  container.innerHTML = `
    ${!showArchivedGoals && archivedCount > 0 ? `<div class="card"><div class="card-body">Archived goals are hidden by default. Turn on "Show archived goals" to review or restore ${archivedCount} archived goal${archivedCount !== 1 ? 's' : ''}.</div></div>` : ''}
    ${visibleGoals.map((g) => {
    const data = g.goal_data || {};
    const statusTag = g.status === 'active'
      ? 'tag-success'
      : g.status === 'paused'
        ? 'tag-warning'
        : 'tag-secondary';
    const statusLabel = g.status === 'completed' ? 'achieved' : g.status;
    const priorityTag = g.priority === 'primary' ? 'tag-primary' : g.priority === 'secondary' ? 'tag-warning' : 'tag-secondary';
    const goalAgents = (data.context_sources && Array.isArray(data.context_sources.agents))
      ? data.context_sources.agents : [];
    const isActive = g.status === 'active';
    const isPaused = g.status === 'paused';
    const isCompleted = g.status === 'completed';
    const isArchived = g.status === 'archived';

    let statusDescription = 'This goal is in focus. Atlas includes it in briefs and sessions.';
    if (isPaused) statusDescription = 'This goal is on hold. Atlas ignores it until you reactivate.';
    if (isCompleted) statusDescription = "You completed this goal. It's archived but can be reopened.";
    if (isArchived) statusDescription = 'This goal is hidden from normal views. Its history stays searchable and you can restore it anytime.';

    const agentBadges = allAgents.map((a) => {
      const active = goalAgents.includes(a);
      return `<span class="tag ${active ? 'tag-primary' : 'tag-secondary'}" style="cursor:pointer;font-size:12px;margin:2px" onclick="toggleGoalAgent('${g.id}', '${a}', ${active})" title="${active ? 'Click to remove perspective' : 'Click to add perspective'}">${a}${active ? '' : ' +'}</span>`;
    }).join('');

    return `<div class="card goal-card ${isArchived ? 'archived' : ''}">
      <div class="card-header">
        <span class="card-title">${escapeHtml(g.title)}</span>
        <div>
          <span class="tag ${priorityTag}">${g.priority || 'unset'}</span>
          <span class="tag ${statusTag}">${statusLabel}</span>
        </div>
      </div>
      <div class="card-body md-content">
        ${data.outcome ? `<div><strong>Outcome:</strong> ${escapeHtml(data.outcome)}</div>` : ''}
        ${data.metric ? `<div><strong>Metric:</strong> ${escapeHtml(data.metric)}</div>` : ''}
        ${data.target_date ? `<div><strong>Target:</strong> ${data.target_date}</div>` : ''}
        ${data.baseline ? `<div><strong>Baseline:</strong> ${escapeHtml(data.baseline)}</div>` : ''}
        ${data.next_milestone ? `<div><strong>Next milestone:</strong> ${escapeHtml(data.next_milestone)}</div>` : ''}
        <div class="goal-status-copy">${statusDescription}</div>
        <div style="margin-top:8px"><strong>Perspectives:</strong></div>
        <div style="margin-top:4px">${agentBadges}</div>
      </div>
      <div class="goal-actions-row">
        <div class="btn-group">
          ${renderGoalActionButtons(g)}
        </div>
        ${isActive ? renderGoalMoreMenu(g.id) : ''}
      </div>
    </div>`;
  }).join('')}
  `;
}

async function updateGoalStatus(id, status) {
  try {
    await atlas.goals.updateStatus(id, status);
    loadGoals();
    loadToday();
  } catch (err) {
    showToast(`Failed to update goal: ${err.message}`, 'error');
  }
}

function confirmAchieved(goalId) {
  if (confirm("Mark this goal as achieved? It'll move out of active focus and won't appear in briefs or sessions. You can reactivate it anytime.")) {
    updateGoalStatus(goalId, 'completed');
  }
}

function renderGoalActionButtons(goal) {
  const isActive = goal.status === 'active';
  const isPaused = goal.status === 'paused';
  const isCompleted = goal.status === 'completed';
  const isArchived = goal.status === 'archived';

  if (isActive) {
    return `
      <button class="btn btn-sm btn-primary" onclick="startGoalEdit('${goal.id}')" title="Update any details of this goal">Edit</button>
      <button class="btn btn-sm" onclick="updateGoalStatus('${goal.id}', 'paused')" title="Temporarily remove from active focus. Atlas won't include it in briefs.">Pause</button>
      <button class="btn btn-sm" onclick="confirmAchieved('${goal.id}')" title="Goal accomplished. Atlas moves it out of active focus but you can reopen it.">Mark Achieved</button>
    `;
  }

  if (isPaused) {
    return `
      <button class="btn btn-sm btn-primary" onclick="updateGoalStatus('${goal.id}', 'active')" title="Bring this goal back into active focus.">Resume</button>
      <button class="btn btn-sm" onclick="startGoalEdit('${goal.id}')" title="Update any details of this goal">Edit</button>
      <button class="btn btn-sm" onclick="archiveGoal('${goal.id}')" title="Hide this goal from normal views without losing its history.">Archive</button>
      <button class="btn btn-sm btn-danger" onclick="openGoalDeleteModal('${goal.id}')">Delete</button>
    `;
  }

  if (isCompleted) {
    return `
      <button class="btn btn-sm btn-primary" onclick="updateGoalStatus('${goal.id}', 'active')" title="Bring this goal back into active focus.">Reactivate</button>
      <button class="btn btn-sm" onclick="startGoalEdit('${goal.id}')" title="Update any details of this goal">Edit</button>
      <button class="btn btn-sm" onclick="archiveGoal('${goal.id}')" title="Hide this goal from normal views without losing its history.">Archive</button>
      <button class="btn btn-sm btn-danger" onclick="openGoalDeleteModal('${goal.id}')">Delete</button>
    `;
  }

  if (isArchived) {
    return `
      <button class="btn btn-sm btn-primary" onclick="unarchiveGoal('${goal.id}')">Unarchive</button>
      <button class="btn btn-sm" onclick="startGoalEdit('${goal.id}')" title="Update any details of this goal">Edit</button>
      <button class="btn btn-sm btn-danger" onclick="openGoalDeleteModal('${goal.id}')">Delete</button>
    `;
  }

  return `
    <button class="btn btn-sm" onclick="startGoalEdit('${goal.id}')">Edit</button>
  `;
}

function renderGoalMoreMenu(goalId) {
  const open = openGoalMoreMenuId === goalId;
  return `
    <div class="goal-more">
      <button class="btn btn-sm btn-ghost" data-goal-more-button="${goalId}" onclick="toggleGoalMoreMenu(event, '${goalId}')" title="More actions">...</button>
      ${open ? `
        <div class="goal-more-menu" data-goal-more-menu="${goalId}">
          <button class="btn btn-sm btn-ghost" onclick="archiveGoal('${goalId}')">Archive</button>
          <button class="btn btn-sm btn-danger" onclick="openGoalDeleteModal('${goalId}')">Delete</button>
        </div>
      ` : ''}
    </div>
  `;
}

function toggleGoalMoreMenu(event, goalId) {
  event.stopPropagation();
  openGoalMoreMenuId = openGoalMoreMenuId === goalId ? null : goalId;
  loadGoals();
}

async function archiveGoal(goalId) {
  try {
    openGoalMoreMenuId = null;
    await atlas.goals.archive(goalId);
    showToast('Goal archived', 'success');
    loadGoals();
    loadToday();
  } catch (err) {
    showToast(`Archive failed: ${err.message}`, 'error');
  }
}

async function unarchiveGoal(goalId) {
  try {
    await atlas.goals.unarchive(goalId);
    showToast('Goal restored to active', 'success');
    loadGoals();
    loadToday();
  } catch (err) {
    showToast(`Unarchive failed: ${err.message}`, 'error');
  }
}

async function openGoalDeleteModal(goalId) {
  try {
    const [goal, counts] = await Promise.all([
      atlas.goals.get(goalId),
      atlas.goals.countLinked(goalId),
    ]);
    if (!goal) return;

    pendingGoalDelete = { id: goalId, title: goal.title, counts };
    document.getElementById('goal-delete-title').textContent = goal.title;
    document.getElementById('goal-delete-counts').innerHTML = `
      <li>1 goal record</li>
      <li>${counts.entries || 0} memory entr${(counts.entries || 0) === 1 ? 'y' : 'ies'} linked to this goal</li>
      <li>${counts.actions || 0} action item${(counts.actions || 0) === 1 ? '' : 's'} linked to this goal</li>
      <li>${counts.overrides || 0} override${(counts.overrides || 0) === 1 ? '' : 's'} linked to this goal</li>
      <li>${counts.files || 0} file association${(counts.files || 0) === 1 ? '' : 's'}</li>
    `;

    const defaultOption = document.querySelector('input[name="goal-delete-level"][value="goal_only"]');
    if (defaultOption) defaultOption.checked = true;
    document.getElementById('modal-goal-delete').classList.add('active');
  } catch (err) {
    showToast(`Delete preview failed: ${err.message}`, 'error');
  }
}

async function confirmGoalDelete() {
  try {
    if (!pendingGoalDelete) return;
    const selected = document.querySelector('input[name="goal-delete-level"]:checked');
    const level = selected ? selected.value : 'goal_only';
    await atlas.goals.deleteCascade(pendingGoalDelete.id, level);
    closeModal('modal-goal-delete');
    pendingGoalDelete = null;
    showToast('Goal deleted permanently', 'success');
    loadGoals();
    loadToday();
    loadActions();
    loadFiles();
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'error');
  }
}

async function toggleGoalAgent(goalId, agentName, currentlyActive) {
  const goal = await atlas.goals.get(goalId);
  if (!goal) return;
  const data = goal.goal_data || {};
  const sources = data.context_sources || {};
  let agents = Array.isArray(sources.agents) ? [...sources.agents] : [];

  if (currentlyActive) {
    if (agentName === 'meta-analyst') { showToast('Meta-analyst perspective cannot be removed', 'error'); return; }
    agents = agents.filter(a => a !== agentName);
  } else {
    if (!agents.includes(agentName)) agents.push(agentName);
  }

  await atlas.goals.updateSources(goalId, { ...sources, agents });
  loadGoals();
}

// --- Conversational Goal Interview ---

document.getElementById('btn-new-goal').addEventListener('click', () => startGoalInterview());
document.getElementById('toggle-show-archived').addEventListener('change', (event) => {
  showArchivedGoals = event.target.checked;
  openGoalMoreMenuId = null;
  loadGoals();
});
document.getElementById('goal-delete-confirm').addEventListener('click', () => {
  confirmGoalDelete().catch((err) => showToast(`Delete failed: ${err.message}`, 'error'));
});

async function startGoalInterview(goalId) {
  goalInterviewActive = true;
  const isEdit = !!goalId;

  document.getElementById('goals-list').style.display = 'none';
  document.getElementById('btn-new-goal').style.display = 'none';
  document.getElementById('goals-filter-bar').style.display = 'none';
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
  document.getElementById('goals-filter-bar').style.display = '';
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
    container.innerHTML = '<div class="empty-state"><p>No actions yet. They\'ll appear here after your advisory sessions when you commit to specific next steps.</p></div>';
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
    { name: 'IDENTITY.md', label: 'Identity', content: ctx.identity, desc: 'Tell Atlas who you are so it can personalise advice. Example: your name, where you live, your professional background, and how you prefer to communicate (direct, detailed, casual).', prompt: 'Tell me about yourself — your background, where you\'re based, what you do.' },
    { name: 'SITUATION.md', label: 'Situation', content: ctx.situation, desc: 'Describe your current reality so Atlas understands your constraints. Example: employment status, approximate financial runway, living situation, and any major life factors affecting your goals.', prompt: 'What\'s your current situation? Employment, finances, anything I should know.' },
    { name: 'PREFERENCES.md', label: 'Preferences', content: ctx.preferences, desc: 'Tell Atlas how to work with you. Example: how blunt it should be, your typical working hours, any time blocks it should respect, and how detailed you want morning briefs.', prompt: 'How do you want me to work with you? How direct should I be?' },
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
            <button class="btn btn-sm btn-context-interview-trigger" style="margin-left:8px" data-filename="${escapeHtml(f.name)}" data-prompt="${escapeHtml(f.prompt)}">Talk to Atlas about this</button>
          </div>
        </div>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">${f.desc}</p>
        <textarea class="form-textarea" id="ctx-${f.name}" rows="8">${escapeHtml(f.content)}</textarea>
        <div style="margin-top:8px">
          <button class="btn btn-sm btn-primary btn-context-save" data-filename="${escapeHtml(f.name)}">Save</button>
        </div>
      </div>
    `).join('')}
    <p style="color:var(--text-muted);font-size:13px;margin-top:8px">Don't overthink these - just write naturally. Atlas uses this as background context, and you can update them anytime through the editor or by talking to Atlas.</p>
  `;

  container.querySelectorAll('.btn-context-interview-trigger').forEach((button) => {
    button.addEventListener('click', () => {
      startContextInterview(button.dataset.filename, button.dataset.prompt || '');
    });
  });

  container.querySelectorAll('.btn-context-save').forEach((button) => {
    button.addEventListener('click', () => saveContext(button.dataset.filename));
  });
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
  document.getElementById('context-interview-input-bar').style.display = 'flex';
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
  document.getElementById('context-interview-input-bar').style.display = 'flex';
  setTimeout(() => {
    closeModal('modal-context-interview');
    loadMemoryContext();
    loadMemory();
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
    case 'settings-style': return loadSettingsStyle();
    case 'settings-integrations': return loadSettingsIntegrations();
    case 'settings-agents': return loadSettingsAgents();
    case 'settings-methodology': return loadSettingsMethodology();
    case 'settings-diagnostics': return loadSettingsDiagnostics();
  }
}

async function loadSettingsStyle() {
  const container = document.getElementById('settings-style');
  let tones = [];
  try { tones = await atlas.settings.getTones(); } catch {}

  if (tones.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No adviser styles found. Atlas will fall back to Direct.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header">
        <span class="card-title">Adviser Style</span>
        <span class="tag tag-primary">${escapeHtml((tones.find((t) => t.selected) || tones[0]).name)}</span>
      </div>
      <div class="card-body">
        Choose how sharp Atlas sounds. This changes delivery, not evidence standards. Updates take effect on your next session.
      </div>
    </div>
    <div class="tone-grid">
      ${tones.map((tone) => `
        <div class="tone-card ${tone.selected ? 'selected' : ''}" onclick="selectTone('${tone.id}')">
          <div class="tone-card-title">
            <span>${escapeHtml(tone.name)}</span>
            ${tone.selected ? '<span class="tag tag-success">Selected</span>' : ''}
          </div>
          <div class="tone-card-desc">${escapeHtml(tone.description)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

async function loadSettingsAgents() {
  const container = document.getElementById('settings-agents');
  const specs = await atlas.settings.getAgentSpecs();
  const goals = await atlas.goals.getAll();

  // Build goal-to-agent mapping
  const agentGoalMap = {};
  for (const g of goals) {
    const agents = g.goal_data?.context_sources?.agents;
    if (Array.isArray(agents)) {
      for (const a of agents) {
        if (!agentGoalMap[a]) agentGoalMap[a] = [];
        agentGoalMap[a].push(g.title);
      }
    }
  }

  const specCards = specs.map((spec) => {
    const title = spec.content.split('\n')[0].replace(/^#\s*/, '').trim() || spec.name;
    const isMeta = spec.name === 'meta-analyst';
    const usedBy = agentGoalMap[spec.name] || [];
    const goalBadges = usedBy.length > 0
      ? usedBy.map(t => `<span class="tag tag-primary" style="font-size:11px">${escapeHtml(t)}</span>`).join(' ')
      : '<span style="color:var(--text-secondary);font-size:12px">No goals</span>';

    return `<div class="card">
      <div class="card-header">
        <span class="card-title">${escapeHtml(title)}</span>
        <div class="btn-group">
          <button class="btn btn-sm" onclick="editAgentSpec('${spec.name}')">Edit</button>
          ${isMeta ? '' : `<button class="btn btn-sm btn-danger" onclick="deleteAgentSpec('${spec.name}')">Delete</button>`}
        </div>
      </div>
      <div style="margin-bottom:8px;font-size:12px"><strong>Used by:</strong> ${goalBadges}</div>
      <div class="card-body md-content">${renderMarkdown(spec.content)}</div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div style="margin-bottom:16px;padding:12px 16px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;color:var(--text-secondary);line-height:1.5">
      These are the advisory perspectives Atlas uses to sharpen its thinking for your goals. They're managed automatically during goal creation — you only need to edit them if you want to fine-tune how Atlas thinks.
    </div>
    <div style="margin-bottom:12px">
      <button class="btn" onclick="openAgentModalForCreate()">New Perspective</button>
    </div>
    ${specCards || '<div class="empty-state"><p>No perspectives yet. Create a goal and Atlas will set these up automatically.</p></div>'}
  `;
}

async function editAgentSpec(name) {
  const specs = await atlas.settings.getAgentSpecs();
  const spec = specs.find(s => s.name === name);
  if (!spec) return;
  openAgentModalForEdit(spec.name, spec.content);
}

function buildAgentTemplate(name) {
  return `# ${name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}

## Role
[Describe the advisory perspective]

## Focus Areas
- [Area 1]
- [Area 2]

## Output Format
Concise bullet points. Lead with the most actionable item.`;
}

function openAgentModalForCreate() {
  document.getElementById('agent-modal-title').textContent = 'New Perspective';
  document.getElementById('agent-modal-name').value = '';
  document.getElementById('agent-modal-name').disabled = false;
  document.getElementById('agent-modal-content').value = '';
  document.getElementById('agent-modal-save').dataset.mode = 'create';
  document.getElementById('agent-modal-save').dataset.originalName = '';
  document.getElementById('modal-agent-editor').classList.add('active');
  document.getElementById('agent-modal-name').focus();
}

function openAgentModalForEdit(name, content) {
  document.getElementById('agent-modal-title').textContent = `Edit Perspective: ${name}`;
  document.getElementById('agent-modal-name').value = name;
  document.getElementById('agent-modal-name').disabled = true;
  document.getElementById('agent-modal-content').value = content;
  document.getElementById('agent-modal-save').dataset.mode = 'edit';
  document.getElementById('agent-modal-save').dataset.originalName = name;
  document.getElementById('modal-agent-editor').classList.add('active');
  document.getElementById('agent-modal-content').focus();
}

async function createAgentSpec() {
  openAgentModalForCreate();
}

function openAgentDeleteModal(name) {
  document.getElementById('agent-delete-name').textContent = name;
  document.getElementById('agent-delete-confirm').dataset.name = name;
  document.getElementById('modal-agent-delete').classList.add('active');
}

async function deleteAgentSpec(name) {
  openAgentDeleteModal(name);
}

async function loadSettingsMethodology() {
  const container = document.getElementById('settings-methodology');
  const methodology = await atlas.settings.getMethodology();

  if (!methodology || !methodology.loaded) {
    container.innerHTML = '<div class="empty-state"><p>No methodology file found at config/engine/methodology.md</p></div>';
    return;
  }
  container.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header">
        <span class="card-title">Methodology Diagnostic</span>
        <span class="tag ${methodology.loaded ? 'tag-success' : 'tag-warning'}">${methodology.loaded ? 'Loaded' : 'Empty'}</span>
      </div>
      <div class="card-body">
        <div><strong>File:</strong> <code style="font-size:11px">${escapeHtml(methodology.filePath)}</code></div>
        <div><strong>Tokens:</strong> ~${methodology.tokens}</div>
        ${methodology.lastModified ? `<div><strong>Last modified:</strong> ${new Date(methodology.lastModified).toLocaleString()}</div>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:12px">Content Preview</div>
      <div class="card-body md-content" style="max-height:600px;overflow-y:auto">${renderMarkdown(methodology.content)}</div>
    </div>
  `;
}

async function loadSettingsDiagnostics() {
  const container = document.getElementById('settings-diagnostics');
  const [diag, methodology] = await Promise.all([
    atlas.settings.getDiagnostics(),
    atlas.settings.getMethodology(),
  ]);
  if (!diag) {
    container.innerHTML = '<div class="empty-state"><p>No diagnostics yet. Diagnostics appear after Atlas assembles context for a brief or session.</p></div>';
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
        <h3 style="font-size:14px;margin:12px 0 8px">Perspectives</h3>
        <div style="margin-bottom:4px;font-size:12px;color:var(--text-secondary)">
          ${(diag.loadedAgents || []).length} loaded of ${(diag.availableAgents || []).length} available
        </div>
        ${(diag.availableAgents || []).map(a => {
          const loaded = (diag.loadedAgents || []).includes(a);
          return `<span class="tag ${loaded ? 'tag-primary' : 'tag-secondary'}" style="margin:2px">${escapeHtml(a)}</span>`;
        }).join('') || '<span style="color:var(--text-secondary)">None</span>'}
        <h3 style="font-size:14px;margin:12px 0 8px">Methodology</h3>
        ${methodology && methodology.loaded
          ? `<div style="font-size:13px"><span class="tag tag-success">Loaded</span> ~${methodology.tokens} tokens <span style="color:var(--text-secondary)">${escapeHtml(methodology.filePath || '')}</span></div>`
          : '<div style="font-size:13px"><span class="tag tag-warning">Not loaded</span> No methodology file found</div>'}
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
  // Guard context interview close if proposed changes exist
  if (id === 'modal-context-interview') {
    const proposed = document.getElementById('context-interview-proposed');
    if (proposed && proposed.style.display !== 'none') {
      if (!confirm('You have unsaved changes. Close without saving?')) return;
    }
  }
  if (id === 'modal-goal-delete') {
    pendingGoalDelete = null;
  }
  document.getElementById(id).classList.remove('active');
}

window.startContextInterview = startContextInterview;
window.closeModal = closeModal;
window.exportBriefPDF = exportBriefPDF;

document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-goal-more-menu]') && !event.target.closest('[data-goal-more-button]')) {
    if (openGoalMoreMenuId) {
      openGoalMoreMenuId = null;
      loadGoals();
    }
  }
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
  const [diag, files] = await Promise.all([
    atlas.settings.getDiagnostics(),
    atlas.files.list().catch(() => []),
  ]);
  const sources = [
    { key: 'gmail', label: 'Gmail', icon: 'Mail' },
    { key: 'calendar', label: 'Calendar', icon: 'Cal' },
    { key: 'files', label: 'Files', icon: 'File' },
    { key: 'memory', label: 'Recent memory', icon: 'Memo' },
    { key: 'web_search', label: 'Web search', icon: 'Web' },
  ];
  let googleConfigured = false;
  try { googleConfigured = await atlas.settings.isGoogleConfigured(); } catch {}
  const sourceStatus = {};
  if (diag && diag.sourcePolicy) {
    for (const s of sources) {
      sourceStatus[s.key] = diag.sourcePolicy[s.key];
    }
  }
  const describeSource = (source) => {
    const inContext = !!sourceStatus[source.key];
    if (source.key === 'gmail' || source.key === 'calendar') {
      if (!googleConfigured) {
        return { cls: 'inactive', text: `${source.label}: not connected` };
      }
      return {
        cls: inContext ? 'active' : 'inactive',
        text: inContext
          ? `${source.label}: connected, in context`
          : `${source.label}: connected, not used for current goals`,
      };
    }
    if (source.key === 'files') {
      if (!files || files.length === 0) {
        return {
          cls: 'inactive',
          text: inContext ? 'Files: enabled, no files loaded' : 'Files: no files loaded',
        };
      }
      return {
        cls: inContext ? 'active' : 'inactive',
        text: inContext ? 'Files: available, in context' : 'Files: available, not used for current goals',
      };
    }
    if (source.key === 'memory') {
      return {
        cls: inContext ? 'active' : 'inactive',
        text: inContext ? 'Recent memory: in context' : 'Recent memory: not used for current goals',
      };
    }
    return {
      cls: inContext ? 'active' : 'inactive',
      text: inContext
        ? `${source.label}: available, in context`
        : `${source.label}: available, not used for current goals`,
    };
  };
  let badgesHtml = sources.map((s) => {
    const state = describeSource(s);
    return `<div class="context-badge ${state.cls}"><span class="badge-dot"></span>${s.icon} ${state.text}</div>`;
  }).join('');
  if (!diag) {
    badgesHtml = `<div style="width:100%;font-size:13px;color:var(--text-secondary);margin-bottom:8px">Source usage appears after Atlas assembles context for a brief or session.</div>${badgesHtml}`;
  }
  if (diag && diag.loadedAgents) {
    const perspectiveBadges = diag.loadedAgents.map(a =>
      `<div class="context-badge active"><span class="badge-dot"></span>${a}</div>`
    ).join('');
    badgesHtml += `<div style="width:100%;margin-top:8px;font-size:12px;color:var(--text-secondary)">Perspectives:</div>${perspectiveBadges}`;
  }
  badges.innerHTML = badgesHtml;
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
}

// === Engine Settings ===

async function selectTone(name) {
  try {
    const result = await atlas.settings.setTone(name);
    const label = result?.tone?.name || name;
    showToast(`Adviser style updated to ${label}. Takes effect on your next session.`, 'success');
    await loadSettingsStyle();
  } catch (err) {
    showToast(`Failed to update adviser style: ${err.message}`, 'error');
  }
}

async function loadSettingsIntegrations() {
  const container = document.getElementById('settings-integrations');
  const googleConfigured = await atlas.settings.isGoogleConfigured();
  let engines = [];
  try { engines = await atlas.settings.getEngines(); } catch {}

  const activeEngine = engines.find((e) => e.active) || { name: 'claude', model: null, available: false, capabilities: {} };
  const capabilityLabel = (engine) => {
    const caps = [];
    if (engine.capabilities?.streaming) caps.push('streaming');
    if (engine.capabilities?.webSearch) caps.push('web search');
    if (engine.capabilities?.toolUse) caps.push('tool use');
    if (engine.capabilities?.localCli) caps.push('local CLI');
    return caps.length > 0 ? caps.join(' - ') : 'basic response mode';
  };
  const engineCards = engines.map((e) => `
    <div class="card" style="margin-top:12px">
      <div class="card-header">
        <span class="card-title">${escapeHtml(e.name)}</span>
        <div>
          <span class="tag ${e.available ? 'tag-success' : 'tag-warning'}">${e.available ? 'Available' : 'Unavailable'}</span>
          ${e.active ? '<span class="tag tag-primary" style="margin-left:6px">Selected</span>' : ''}
        </div>
      </div>
      <div class="card-body">
        <div style="margin-bottom:8px;color:var(--text-secondary)">${escapeHtml(capabilityLabel(e))}</div>
        ${e.model ? `<div style="margin-bottom:8px;font-size:13px;color:var(--text-secondary)">Model: <code>${escapeHtml(e.model)}</code></div>` : ''}
        <div class="btn-group">
          <button class="btn btn-sm ${e.active ? 'btn-primary' : ''}" onclick="switchEngine('${e.name}')"${e.active ? ' disabled' : ''}>${e.active ? 'Selected' : 'Use this engine'}</button>
        </div>
      </div>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">Google Calendar & Gmail</span>
        <span class="tag ${googleConfigured ? 'tag-success' : 'tag-warning'}">${googleConfigured ? 'Connected' : 'Not connected'}</span>
      </div>
      <div class="card-body">${googleConfigured
        ? "Google services are connected and available. Whether Gmail or Calendar are used in a brief or session depends on the active goals' source settings."
        : 'Not connected. Run the terminal app (<code>npm start</code>) to complete the OAuth setup flow.'}</div>
    </div>
    <div class="card">
      <div class="card-header">
        <span class="card-title">AI Engine</span>
        <span class="tag tag-primary">${escapeHtml(activeEngine.name)}</span>
      </div>
      <div class="card-body">
        <p style="margin-bottom:8px">Current engine: <strong>${escapeHtml(activeEngine.name)}</strong></p>
        ${activeEngine.model ? `<p style="margin-bottom:8px">Pinned model: <code>${escapeHtml(activeEngine.model)}</code></p>` : ''}
        <p style="color:var(--text-secondary);margin-bottom:8px">Atlas uses one engine at a time. Switching changes which local CLI Atlas uses for briefs, sessions, chat, and context interviews.</p>
        <div style="font-size:13px;color:var(--text-secondary)">Selected engine capabilities: ${escapeHtml(capabilityLabel(activeEngine))}</div>
      </div>
    </div>
    ${engines.length > 0 ? engineCards : '<div class="empty-state"><p>No engines detected.</p></div>'}
  `;
}

async function switchEngine(name) {
  try {
    await atlas.settings.setEngine(name);
    showToast(`Engine switched to ${name}`, 'success');
    await loadSettingsIntegrations();
    await runHealthCheck();
  } catch (err) {
    showToast(`Failed to switch engine: ${err.message}`, 'error');
  }
}

// === Voice Input (Push-to-Talk) ===

let whisperAvailable = false;
let mediaRecorder = null;
let audioChunks = [];

async function initVoice() {
  // Check if local Whisper is available
  try {
    whisperAvailable = await atlas.voice.isAvailable();
  } catch { whisperAvailable = false; }

  if (!whisperAvailable) {
    console.log('[Voice] Local Whisper not available — hiding mic buttons');
    document.querySelectorAll('.btn-mic').forEach((btn) => { btn.style.display = 'none'; });
    return;
  }

  console.log('[Voice] Local Whisper available — wiring mic buttons');

  // Wire all mic buttons generically
  const micWiring = [
    ['btn-chat-mic', 'chat-input'],
    ['btn-goal-mic', 'goal-interview-input'],
    ['btn-context-mic', 'context-interview-input'],
  ];
  for (const [btnId, inputId] of micWiring) {
    const btn = document.getElementById(btnId);
    if (!btn) continue;
    btn.addEventListener('mousedown', () => startVoice(inputId));
    btn.addEventListener('mouseup', stopVoice);
    btn.addEventListener('mouseleave', stopVoice);
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); startVoice(inputId); });
    btn.addEventListener('touchend', (e) => { e.preventDefault(); stopVoice(); });
  }
}

let voiceTargetInput = null;

// Map input IDs to their mic button IDs
const micButtonMap = {
  'chat-input': 'btn-chat-mic',
  'goal-interview-input': 'btn-goal-mic',
  'context-interview-input': 'btn-context-mic',
};

let voiceDotInterval = null;

function startVoiceDots(input, label, cssClass) {
  stopVoiceDots();
  input.classList.add(cssClass);
  let dots = 0;
  input.placeholder = label;
  voiceDotInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    input.placeholder = label + '.'.repeat(dots);
  }, 400);
}

function stopVoiceDots() {
  if (voiceDotInterval) { clearInterval(voiceDotInterval); voiceDotInterval = null; }
  document.querySelectorAll('.chat-input').forEach(el => {
    el.classList.remove('voice-listening', 'voice-transcribing');
  });
}

async function startVoice(inputId) {
  if (isRecording) return;
  voiceTargetInput = document.getElementById(inputId);
  if (!voiceTargetInput) return;

  // Show recording state immediately
  isRecording = true;
  const micBtn = document.getElementById(micButtonMap[inputId]);
  if (micBtn) micBtn.classList.add('recording');
  startVoiceDots(voiceTargetInput, 'Listening', 'voice-listening');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    // Capture references before async gap
    const targetInput = voiceTargetInput;

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (audioChunks.length === 0 || !targetInput) { stopVoiceDots(); return; }

      startVoiceDots(targetInput, 'Transcribing', 'voice-transcribing');
      try {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        const wavBuffer = await convertToWav(arrayBuffer);
        const result = await atlas.voice.transcribe(wavBuffer);
        if (result.text) {
          const existing = targetInput.value;
          targetInput.value = existing + (existing ? ' ' : '') + result.text.trim();
        } else if (result.error) {
          showToast(`Transcription error: ${result.error}`, 'error');
        }
      } catch (err) {
        showToast(`Voice error: ${err.message}`, 'error');
      }
      stopVoiceDots();
      targetInput.placeholder = targetInput.id === 'chat-input' ? 'Type your message...' : 'Describe your goal...';
    };

    // If user already released before getUserMedia resolved, stop immediately
    if (!isRecording) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    mediaRecorder.start();
  } catch (err) {
    showToast('Microphone access denied or unavailable', 'error');
    stopVoice();
  }
}

function stopVoice() {
  if (!isRecording) return;
  isRecording = false;

  document.querySelectorAll('.btn-mic').forEach((btn) => btn.classList.remove('recording'));
  // Don't stopVoiceDots here — let onstop handle the transition to "Transcribing"

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

// Convert webm/opus audio to 16kHz mono WAV for Whisper
async function convertToWav(webmBuffer) {
  const audioCtx = new OfflineAudioContext(1, 16000 * 30, 16000); // 30 sec max
  const audioBuffer = await audioCtx.decodeAudioData(webmBuffer);

  // Resample to 16kHz mono
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * 16000), 16000);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  const pcm = rendered.getChannelData(0);

  // Build WAV file
  const wavBuffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(wavBuffer);

  // WAV header
  const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 16000, true); // sample rate
  view.setUint32(28, 32000, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, pcm.length * 2, true);

  // Convert float32 to int16
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return wavBuffer;
}

// === Health Check ===

async function runHealthCheck() {
  try {
    const status = await atlas.health.check();
    const bar = document.getElementById('health-status');
    const items = [
      { key: 'ai', label: 'AI' },
      { key: 'database', label: 'Database' },
      { key: 'gmail', label: 'Gmail' },
      { key: 'calendar', label: 'Calendar' },
      { key: 'voice', label: 'Voice' },
    ];
    bar.innerHTML = items.map(({ key, label }) => {
      const s = status[key];
      const cls = s.ok ? 'ok' : (s.label === 'not set up' || s.label === 'model missing') ? 'warn' : 'err';
      return `<span class="health-item"><span class="health-dot ${cls}"></span>${label}: ${s.label}</span>`;
    }).join('');
    bar.style.display = 'flex';

    if (!status.ai.ok) {
      showToast('The active AI engine is not available. Briefs, sessions, and chat require a working engine. Other features still work.', 'warning', 8000);
    }
  } catch {}
}

// === Guide ===

const GUIDE_SECTIONS = [
  {
    id: 'what-atlas-is',
    title: 'What Atlas Is',
    content: `<p>Atlas is a strategic adviser that knows your goals, your situation, and your history. It gives specific, tactical advice — not generic motivation. Think of it as a senior consultant who remembers every conversation you've had and brings that full picture to bear on whatever you're facing.</p>
<p>Atlas is not a chatbot. It doesn't just answer questions. It proactively challenges your thinking, tracks your commitments, notices when you're drifting from your goals, and tells you what it thinks you should do — even when you didn't ask.</p>`
  },
  {
    id: 'how-atlas-thinks',
    title: 'How Atlas Thinks',
    content: `<p><strong>Before every session:</strong> Atlas loads your goals, your situation, recent session history, open actions, persistent insights, and any connected sources like email or calendar. It arrives at the conversation already briefed.</p>
<p><strong>During the session:</strong> If the conversation goes somewhere unexpected, Atlas can search the web, recall past memory entries, or dig into your email for older context. It doesn't just work with what it started with.</p>
<p><strong>After every session:</strong> Atlas processes the conversation — extracting decisions, commitments, insights, and patterns. Important items are stored in memory. Action items are tracked with due dates. This is why Atlas gets sharper over time — every session makes the next one better.</p>
<svg width="520" height="160" viewBox="0 0 520 160" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="50" width="110" height="44" rx="8" stroke="#6c8cff" stroke-width="1.5" fill="rgba(108,140,255,0.08)"/>
  <text x="65" y="76" text-anchor="middle" fill="#f0f2f5" font-size="12" font-family="Segoe UI, sans-serif">Load Context</text>
  <rect x="150" y="50" width="110" height="44" rx="8" stroke="#6c8cff" stroke-width="1.5" fill="rgba(108,140,255,0.08)"/>
  <text x="205" y="76" text-anchor="middle" fill="#f0f2f5" font-size="12" font-family="Segoe UI, sans-serif">Advisory Session</text>
  <rect x="290" y="50" width="110" height="44" rx="8" stroke="#6c8cff" stroke-width="1.5" fill="rgba(108,140,255,0.08)"/>
  <text x="345" y="76" text-anchor="middle" fill="#f0f2f5" font-size="12" font-family="Segoe UI, sans-serif">Processing</text>
  <rect x="430" y="50" width="80" height="44" rx="8" stroke="#4ade80" stroke-width="1.5" fill="rgba(74,222,128,0.08)"/>
  <text x="470" y="76" text-anchor="middle" fill="#f0f2f5" font-size="12" font-family="Segoe UI, sans-serif">Memory</text>
  <path d="M120 72 L150 72" stroke="#6c8cff" stroke-width="1.5" marker-end="url(#arrowG)"/>
  <path d="M260 72 L290 72" stroke="#6c8cff" stroke-width="1.5" marker-end="url(#arrowG)"/>
  <path d="M400 72 L430 72" stroke="#4ade80" stroke-width="1.5" marker-end="url(#arrowGr)"/>
  <path d="M470 94 C470 140 65 140 65 94" stroke="#a0a4b4" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#arrowM)"/>
  <text x="120" y="62" fill="#a0a4b4" font-size="10" font-family="Segoe UI, sans-serif">before</text>
  <text x="260" y="62" fill="#a0a4b4" font-size="10" font-family="Segoe UI, sans-serif">after</text>
  <text x="270" y="148" text-anchor="middle" fill="#a0a4b4" font-size="10" font-family="Segoe UI, sans-serif">next session</text>
  <defs>
    <marker id="arrowG" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6" fill="none" stroke="#6c8cff" stroke-width="1.2"/></marker>
    <marker id="arrowGr" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6" fill="none" stroke="#4ade80" stroke-width="1.2"/></marker>
    <marker id="arrowM" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6" fill="none" stroke="#a0a4b4" stroke-width="1.2"/></marker>
  </defs>
</svg>`
  },
  {
    id: 'goals',
    title: 'Goals',
    content: `<p>A goal is the organising unit of Atlas. Everything Atlas does is oriented around your active goals. When you create a goal, Atlas interviews you conversationally to understand what you're trying to achieve, why it matters, what constraints you have, and what usually gets in your way.</p>
<p>Atlas protects your declared goals by default. If you start drifting toward distractions, Atlas will name it and challenge you — respectfully but directly. Goals can be paused, achieved, or revised when genuine evidence warrants it.</p>`
  },
  {
    id: 'actions',
    title: 'Actions and Follow-Up',
    content: `<p>Actions are commitments that Atlas extracts from your conversations. When you agree to do something during a session — "I'll follow up with that recruiter tomorrow" — Atlas logs it as an action with a due date.</p>
<p>Atlas follows up. If an action is overdue, Atlas will mention it at the start of your next session. If you've been followed up on three times with no progress, Atlas will diagnose the obstacle and recommend either doing it immediately or dropping it. This is accountability without guilt-tripping.</p>
<svg width="560" height="80" viewBox="0 0 560 80" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="20" width="80" height="36" rx="6" stroke="#6c8cff" stroke-width="1.5" fill="rgba(108,140,255,0.08)"/>
  <text x="40" y="42" text-anchor="middle" fill="#f0f2f5" font-size="10" font-family="Segoe UI, sans-serif">Session Start</text>
  <rect x="105" y="20" width="80" height="36" rx="6" stroke="#6c8cff" stroke-width="1.5" fill="rgba(108,140,255,0.08)"/>
  <text x="145" y="42" text-anchor="middle" fill="#f0f2f5" font-size="10" font-family="Segoe UI, sans-serif">Atlas Opens</text>
  <rect x="210" y="20" width="80" height="36" rx="6" stroke="#6c8cff" stroke-width="1.5" fill="rgba(108,140,255,0.08)"/>
  <text x="250" y="42" text-anchor="middle" fill="#f0f2f5" font-size="10" font-family="Segoe UI, sans-serif">Conversation</text>
  <rect x="315" y="20" width="80" height="36" rx="6" stroke="#6c8cff" stroke-width="1.5" fill="rgba(108,140,255,0.08)"/>
  <text x="355" y="42" text-anchor="middle" fill="#f0f2f5" font-size="10" font-family="Segoe UI, sans-serif">Session Ends</text>
  <rect x="420" y="20" width="80" height="36" rx="6" stroke="#fbbf24" stroke-width="1.5" fill="rgba(251,191,36,0.08)"/>
  <text x="460" y="42" text-anchor="middle" fill="#f0f2f5" font-size="10" font-family="Segoe UI, sans-serif">Processing</text>
  <rect x="525" y="20" width="30" height="36" rx="6" stroke="#4ade80" stroke-width="1.5" fill="rgba(74,222,128,0.08)"/>
  <text x="540" y="46" text-anchor="middle" fill="#4ade80" font-size="14" font-family="Segoe UI, sans-serif">&#10003;</text>
  <path d="M80 38 L105 38" stroke="#6c8cff" stroke-width="1.2" marker-end="url(#arrowG)"/>
  <path d="M185 38 L210 38" stroke="#6c8cff" stroke-width="1.2" marker-end="url(#arrowG)"/>
  <path d="M290 38 L315 38" stroke="#6c8cff" stroke-width="1.2" marker-end="url(#arrowG)"/>
  <path d="M395 38 L420 38" stroke="#fbbf24" stroke-width="1.2" marker-end="url(#arrowY)"/>
  <path d="M500 38 L525 38" stroke="#4ade80" stroke-width="1.2" marker-end="url(#arrowGr)"/>
  <text x="460" y="70" text-anchor="middle" fill="#a0a4b4" font-size="9" font-family="Segoe UI, sans-serif">Summary + Entries + Actions</text>
  <defs>
    <marker id="arrowY" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6" fill="none" stroke="#fbbf24" stroke-width="1.2"/></marker>
  </defs>
</svg>`
  },
  {
    id: 'memory',
    title: 'Memory',
    content: `<p>Atlas has two kinds of memory. Your user files (Identity, Situation, Preferences) are stable context you maintain — they describe who you are, where you are in life, and how you want Atlas to work with you. These change rarely.</p>
<p>Everything else — session summaries, extracted insights, patterns, decisions — is captured automatically by Atlas after each session. High-importance items persist indefinitely. Routine items stay in a 7-day window and fade. You can browse all of it on the Memory screen.</p>`
  },
  {
    id: 'sources',
    title: 'Sources — Email, Calendar, Files',
    content: `<p>Sources are data feeds that Atlas can draw from to give better advice. Not every source is relevant to every goal.</p>
<p><strong>Email:</strong> Atlas scans your recent inbox, ranks emails by relevance to your active goals, and deeply reads the most important ones. It summarises what it found — it doesn't dump raw emails into its thinking. You control which goals use email through source settings.</p>
<p><strong>Calendar:</strong> Atlas reads your upcoming events so it can factor your schedule into advice. "You have an interview at 2pm, so front-load applications this morning."</p>
<p><strong>Files:</strong> You can upload documents — CVs, job descriptions, bank statements, recipes, health records — and link them to specific goals. Atlas reads the content and references it in sessions.</p>
<p>Not every goal needs every source. A health goal probably doesn't need email. A job search goal probably doesn't need recipes. Atlas manages this through per-goal source settings.</p>`
  },
  {
    id: 'perspectives',
    title: 'Advisory Perspectives',
    content: `<p>When Atlas thinks about your problem, it doesn't just give one generic answer. It considers your situation through multiple specialist lenses — like having a team of advisers in one conversation.</p>
<p>For a job search goal, Atlas might think through: a job search strategist lens (application volume, skill matching), a financial lens (runway, salary requirements), a day planner lens (time allocation), and a learning lens (skill gaps). For a health goal, it might think through: a nutrition lens, a fitness lens, and a habit formation lens.</p>
<p>These perspectives are created automatically when you set up a goal. Atlas suggests which ones are relevant based on what you tell it, and you approve or adjust. You never need to manage them manually — but if you're curious, you can see them in Settings.</p>
<svg width="400" height="280" viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="145" y="10" width="110" height="40" rx="8" stroke="#6c8cff" stroke-width="2" fill="rgba(108,140,255,0.12)"/>
  <text x="200" y="35" text-anchor="middle" fill="#f0f2f5" font-size="13" font-weight="600" font-family="Segoe UI, sans-serif">Your Goal</text>
  <rect x="10" y="90" width="100" height="52" rx="6" stroke="#4ade80" stroke-width="1.2" fill="rgba(74,222,128,0.06)"/>
  <text x="60" y="112" text-anchor="middle" fill="#a0a4b4" font-size="10" font-family="Segoe UI, sans-serif">Sources</text>
  <text x="60" y="126" text-anchor="middle" fill="#6e7280" font-size="9" font-family="Segoe UI, sans-serif">email, cal, files</text>
  <rect x="150" y="90" width="100" height="52" rx="6" stroke="#fbbf24" stroke-width="1.2" fill="rgba(251,191,36,0.06)"/>
  <text x="200" y="112" text-anchor="middle" fill="#a0a4b4" font-size="10" font-family="Segoe UI, sans-serif">Memory</text>
  <text x="200" y="126" text-anchor="middle" fill="#6e7280" font-size="9" font-family="Segoe UI, sans-serif">entries, sessions</text>
  <rect x="290" y="90" width="100" height="52" rx="6" stroke="#6c8cff" stroke-width="1.2" fill="rgba(108,140,255,0.06)"/>
  <text x="340" y="112" text-anchor="middle" fill="#a0a4b4" font-size="10" font-family="Segoe UI, sans-serif">Perspectives</text>
  <text x="340" y="126" text-anchor="middle" fill="#6e7280" font-size="9" font-family="Segoe UI, sans-serif">specialist lenses</text>
  <line x1="180" y1="50" x2="60" y2="90" stroke="#a0a4b4" stroke-width="1" stroke-dasharray="3 3"/>
  <line x1="200" y1="50" x2="200" y2="90" stroke="#a0a4b4" stroke-width="1" stroke-dasharray="3 3"/>
  <line x1="220" y1="50" x2="340" y2="90" stroke="#a0a4b4" stroke-width="1" stroke-dasharray="3 3"/>
  <line x1="60" y1="142" x2="200" y2="190" stroke="#4ade80" stroke-width="1"/>
  <line x1="200" y1="142" x2="200" y2="190" stroke="#fbbf24" stroke-width="1"/>
  <line x1="340" y1="142" x2="200" y2="190" stroke="#6c8cff" stroke-width="1"/>
  <rect x="130" y="190" width="140" height="44" rx="8" stroke="#6c8cff" stroke-width="2" fill="rgba(108,140,255,0.12)"/>
  <text x="200" y="216" text-anchor="middle" fill="#f0f2f5" font-size="12" font-weight="600" font-family="Segoe UI, sans-serif">Atlas's Response</text>
</svg>
<p><strong>Why this matters:</strong> Without perspectives, Atlas might give you great career advice but forget to check whether you can afford the time investment. With perspectives, it catches blind spots that a single train of thought would miss.</p>`
  },
  {
    id: 'methodology',
    title: 'The Methodology',
    content: `<p>Atlas doesn't make up its advisory approach. It follows a research-backed methodology covering goal formation, decision-making frameworks, drift detection, accountability structures, and follow-up techniques. This methodology is based on published research in goal-setting theory, behavioural psychology, and executive advisory practice.</p>
<p>You can read the full methodology in Settings. It governs how Atlas interviews you about goals, how it challenges drift, how it scores what to remember, and how it classifies actions.</p>`
  },
  {
    id: 'user-files',
    title: 'Your User Files',
    content: `<p>Three files describe you to Atlas:</p>
<p><strong>Identity</strong> — Stable facts: your name, location, background, communication style. Changes rarely. Think of it as your professional bio for Atlas.</p>
<p><strong>Situation</strong> — Current reality: employment, finances, living situation, major life factors. Update this when your circumstances change.</p>
<p><strong>Preferences</strong> — How you want Atlas to work: directness level, working hours, protected time blocks, brief detail level. Set once, adjust as needed.</p>
<p>You can edit these directly or talk to Atlas about them — click "Talk to Atlas about this" and have a conversation. Atlas proposes updates and you approve.</p>`
  },
  {
    id: 'privacy',
    title: 'Privacy and Data',
    content: `<p>Atlas runs locally as a desktop app. Your conversations are processed through the currently selected AI engine, which Atlas runs through the local CLI integration. Session data, goals, actions, and memory are stored in your Supabase database. Email and calendar data is fetched directly from your Google account using credentials stored locally — Atlas does not send your email data to third parties.</p>
<p>Perspective files, user context files, and the methodology are stored as local files on your computer.</p>`
  },
  {
    id: 'faq',
    title: 'FAQ',
    content: 'FAQ_PLACEHOLDER'
  }
];

const FAQ_ITEMS = [
  {
    q: 'Is this just a chatbot?',
    a: "No. A chatbot answers questions. Atlas tracks your goals across sessions, remembers what you committed to, follows up on overdue items, challenges your reasoning, and proactively raises issues you haven't asked about. The difference is continuity, accountability, and strategic depth."
  },
  {
    q: 'How does memory work?',
    a: "After every session, Atlas extracts the important parts — decisions, commitments, insights, patterns — and stores them. High-importance items persist forever. Routine items stay for 7 days. When your next session starts, Atlas loads the relevant memory so it's already up to speed."
  },
  {
    q: 'Why does Atlas ask tough questions?',
    a: "Because that's the point. Atlas is designed to protect your goals, not your feelings. If you're drifting, avoiding, or making a decision that conflicts with what you said you wanted, Atlas will name it. It does this respectfully but directly — like a trusted adviser who cares more about your results than your comfort."
  },
  {
    q: 'Why is email included?',
    a: "Email is a source, not a core feature. It's included because for some goals — like job searching — your inbox contains critical information: recruiter messages, interview confirmations, application responses. For goals where email isn't relevant, you can exclude it through goal settings."
  },
  {
    q: 'What do the perspectives do?',
    a: "They prevent blind spots. Each perspective is a specialist lens — like having a financial adviser check the money angle while a day planner checks the time angle. Atlas considers all relevant perspectives internally and gives you one unified answer. You never interact with them directly."
  },
  {
    q: 'Can I trust the advice?',
    a: "Atlas is direct about what it knows versus what it's inferring. When it states facts, it grounds them in your data. When it's guessing, it says so. Its methodology is research-backed and visible. But ultimately, Atlas advises — you decide. It will never override your judgment on decisions that depend on your values."
  },
  {
    q: 'Do I need to read this whole guide?',
    a: "No. Just fill in your user files (Identity, Situation, Preferences), create a goal, and start talking. Everything else — memory, perspectives, sources — works automatically. Come back to this guide when you're curious about why something works the way it does."
  }
];

let guideRendered = false;

function loadGuide() {
  if (guideRendered) return;
  guideRendered = true;

  const container = document.getElementById('guide-content');
  container.innerHTML = GUIDE_SECTIONS.map(section => {
    let body = section.content;
    if (body === 'FAQ_PLACEHOLDER') {
      body = FAQ_ITEMS.map(faq =>
        `<div class="faq-item collapsed">
          <div class="faq-question" onclick="this.parentElement.classList.toggle('collapsed')">
            <span>${escapeHtml(faq.q)}</span>
            <span class="faq-arrow">&#9662;</span>
          </div>
          <div class="faq-answer">${escapeHtml(faq.a)}</div>
        </div>`
      ).join('');
    }
    return `<div class="guide-section" id="guide-${section.id}" data-title="${escapeHtml(section.title)}">
      <div class="guide-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
        <h2>${section.title}</h2>
        <span class="guide-section-arrow">&#9662;</span>
      </div>
      <div class="guide-section-body">${body}</div>
    </div>`;
  }).join('');

  // Search functionality
  const searchInput = document.getElementById('guide-search');
  const clearBtn = document.getElementById('guide-search-clear');
  const noResults = document.getElementById('guide-no-results');

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    clearBtn.style.display = query ? 'inline-flex' : 'none';

    if (!query) {
      // Reset: show all, collapse all
      document.querySelectorAll('.guide-section').forEach(s => {
        s.style.display = '';
        s.classList.remove('collapsed');
        // Remove highlights
        s.querySelectorAll('.guide-highlight').forEach(h => {
          h.replaceWith(document.createTextNode(h.textContent));
        });
      });
      noResults.style.display = 'none';
      return;
    }

    let matchCount = 0;
    document.querySelectorAll('.guide-section').forEach(section => {
      const title = section.dataset.title.toLowerCase();
      const bodyEl = section.querySelector('.guide-section-body');
      const bodyText = bodyEl.textContent.toLowerCase();

      if (title.includes(query) || bodyText.includes(query)) {
        section.style.display = '';
        section.classList.remove('collapsed');
        matchCount++;
        highlightGuideMatches(bodyEl, query);
      } else {
        section.style.display = 'none';
      }
    });

    if (matchCount === 0) {
      noResults.textContent = 'No results for "' + searchInput.value.trim() + '". Try different keywords.';
      noResults.style.display = 'block';
    } else {
      noResults.style.display = 'none';
    }
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input'));
    searchInput.focus();
  });
}

function highlightGuideMatches(container, query) {
  // Remove old highlights
  container.querySelectorAll('.guide-highlight').forEach(h => {
    h.replaceWith(document.createTextNode(h.textContent));
  });
  container.normalize();

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const matches = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    // Skip SVG text nodes
    if (node.parentElement.closest('svg')) continue;
    const idx = node.textContent.toLowerCase().indexOf(query);
    if (idx >= 0) matches.push({ node, idx });
  }

  // Apply highlights in reverse to avoid offset issues
  for (let i = matches.length - 1; i >= 0; i--) {
    const { node, idx } = matches[i];
    const span = document.createElement('span');
    span.className = 'guide-highlight';
    const range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + query.length);
    range.surroundContents(span);
  }
}

// === Init ===

async function init() {
  await loadToday();
  initVoice();
  runHealthCheck();

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


document.getElementById('agent-modal-save').addEventListener('click', async () => {
  const mode = document.getElementById('agent-modal-save').dataset.mode;
  const name = document.getElementById('agent-modal-name').value.trim();
  let content = document.getElementById('agent-modal-content').value;
  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    showToast('Invalid name. Use lowercase letters, numbers, hyphens only.', 'error');
    return;
  }
  if (!content.trim()) {
    content = buildAgentTemplate(name);
    document.getElementById('agent-modal-content').value = content;
  }
  const existing = await atlas.settings.listAgentFiles();
  if (mode === 'create' && existing.includes(name)) {
    showToast(`Perspective "${name}" already exists`, 'error');
    return;
  }
  await atlas.settings.saveAgentSpec(name, content);
  closeModal('modal-agent-editor');
  showToast(`Perspective "${name}" ${mode === 'create' ? 'created' : 'updated'}`, 'success');
  loadSettingsAgents();
});
document.getElementById('agent-delete-confirm').addEventListener('click', async () => {
  const name = document.getElementById('agent-delete-confirm').dataset.name;
  if (!name) return;
  await atlas.settings.deleteAgentSpec(name);
  const goals = await atlas.goals.getAll();
  for (const g of goals) {
    const agents = g.goal_data?.context_sources?.agents;
    if (Array.isArray(agents) && agents.includes(name)) {
      const updated = agents.filter(a => a !== name);
      await atlas.goals.updateSources(g.id, { ...g.goal_data.context_sources, agents: updated });
    }
  }
  closeModal('modal-agent-delete');
  showToast(`Perspective "${name}" deleted`, 'success');
  loadSettingsAgents();
});
