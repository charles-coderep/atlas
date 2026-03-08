const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

let supabase;

async function initDB() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env file');
  }

  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  // Verify connection
  const { error } = await supabase.from('goals').select('id').limit(1);
  if (error) {
    throw new Error(`Cannot connect to Supabase: ${error.message}`);
  }

  return supabase;
}

function getClient() {
  if (!supabase) {
    throw new Error('Database not initialised. Call initDB() first.');
  }
  return supabase;
}

// --- Goals ---

async function saveGoal(goal) {
  const db = getClient();
  const row = {
    id: goal.id,
    title: goal.title,
    type: goal.type || null,
    priority: goal.priority || null,
    goal_data: typeof goal.goal_data === 'string' ? JSON.parse(goal.goal_data) : goal.goal_data || goal,
    status: goal.status || 'active',
  };

  const { error } = await db.from('goals').upsert(row, { onConflict: 'id' });
  if (error) throw error;
}

async function getActiveGoals() {
  const db = getClient();
  const { data, error } = await db
    .from('goals')
    .select('*')
    .eq('status', 'active')
    .order('created_at');

  if (error) throw error;
  return data;
}

async function getGoal(id) {
  const db = getClient();
  const { data, error } = await db.from('goals').select('*').eq('id', id).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function updateGoalStatus(id, status) {
  const db = getClient();
  const { error } = await db.from('goals').update({ status }).eq('id', id);
  if (error) throw error;
}

async function getAllGoals() {
  const db = getClient();
  const { data, error } = await db.from('goals').select('*').order('created_at');
  if (error) throw error;
  return data;
}

async function archiveGoal(id) {
  return updateGoalStatus(id, 'archived');
}

async function unarchiveGoal(id) {
  return updateGoalStatus(id, 'active');
}

async function getArchivedGoals() {
  const db = getClient();
  const { data, error } = await db
    .from('goals')
    .select('*')
    .eq('status', 'archived')
    .order('created_at');

  if (error) throw error;
  return data;
}

async function countTableByGoal(table, goalId) {
  const db = getClient();
  const { count, error } = await db
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('goal_id', goalId);

  if (error) throw error;
  return count || 0;
}

async function countGoalLinkedItems(goalId) {
  const [entries, actions, overrides, files] = await Promise.all([
    countTableByGoal('entries', goalId),
    countTableByGoal('actions', goalId),
    countTableByGoal('overrides', goalId),
    countTableByGoal('files', goalId),
  ]);

  return {
    goal: 1,
    entries,
    actions,
    overrides,
    files,
  };
}

async function deleteGoalCascade(goalId, level) {
  const db = getClient();
  const goal = await getGoal(goalId);
  if (!goal) {
    throw new Error(`Goal not found: ${goalId}`);
  }

  const validLevels = ['goal_only', 'goal_and_memory', 'goal_and_memory_and_files'];
  if (!validLevels.includes(level)) {
    throw new Error(`Invalid delete level "${level}"`);
  }

  if (level === 'goal_only') {
    const [entriesResult, actionsResult, overridesResult, filesResult, goalResult] = await Promise.all([
      db.from('entries').update({ goal_id: null }).eq('goal_id', goalId),
      db.from('actions').update({ goal_id: null }).eq('goal_id', goalId),
      db.from('overrides').update({ goal_id: null }).eq('goal_id', goalId),
      db.from('files').update({ goal_id: null }).eq('goal_id', goalId),
      db.from('goals').delete().eq('id', goalId),
    ]);

    for (const result of [entriesResult, actionsResult, overridesResult, filesResult, goalResult]) {
      if (result.error) throw result.error;
    }

    return { deletedGoalId: goalId, level };
  }

  const deleteFiles = level === 'goal_and_memory_and_files';
  const [entriesResult, actionsResult, overridesResult, filesResult, goalResult] = await Promise.all([
    db.from('entries').delete().eq('goal_id', goalId),
    db.from('actions').delete().eq('goal_id', goalId),
    db.from('overrides').delete().eq('goal_id', goalId),
    deleteFiles
      ? db.from('files').delete().eq('goal_id', goalId)
      : db.from('files').update({ goal_id: null }).eq('goal_id', goalId),
    db.from('goals').delete().eq('id', goalId),
  ]);

  for (const result of [entriesResult, actionsResult, overridesResult, filesResult, goalResult]) {
    if (result.error) throw result.error;
  }

  return { deletedGoalId: goalId, level };
}

// --- Sessions ---

async function createSession(mode) {
  const db = getClient();
  const { data, error } = await db
    .from('sessions')
    .insert({ date: new Date().toISOString().split('T')[0], mode })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateSession(id, updates) {
  const db = getClient();
  const { error } = await db.from('sessions').update(updates).eq('id', id);
  if (error) throw error;
}

async function getRecentSessions(days = 7) {
  const db = getClient();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await db
    .from('sessions')
    .select('*')
    .gte('date', since.toISOString().split('T')[0])
    .order('date', { ascending: false });

  if (error) throw error;
  return data;
}

async function cleanupEmptySessions(days = 30) {
  const db = getClient();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const { data, error } = await db
    .from('sessions')
    .delete()
    .lt('date', cutoffStr)
    .or('summary.is.null,summary.eq.')
    .select('id');

  if (error) throw error;
  return (data || []).length;
}

async function cleanupOldSessions(days = 30) {
  return cleanupEmptySessions(days);
}

// --- Entries ---

async function saveEntry(entry) {
  const db = getClient();
  const { data, error } = await db.from('entries').insert(entry).select().single();
  if (error) throw error;
  return data;
}

async function getRecentEntries(days = 7) {
  const db = getClient();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await db
    .from('entries')
    .select('*')
    .gte('date', since.toISOString().split('T')[0])
    .order('importance', { ascending: false });

  if (error) throw error;
  return data;
}

async function getPersistentEntries() {
  const db = getClient();
  const { data, error } = await db
    .from('entries')
    .select('*')
    .eq('is_persistent', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

async function cleanupOldEntries(days = 7) {
  const db = getClient();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();

  const { data, error } = await db
    .from('entries')
    .delete()
    .eq('is_persistent', false)
    .lt('created_at', cutoffStr)
    .select('id');

  if (error) throw error;
  return (data || []).length;
}

async function getEntriesByGoal(goalId, days = 7) {
  const db = getClient();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await db
    .from('entries')
    .select('*')
    .eq('goal_id', goalId)
    .gte('date', since.toISOString().split('T')[0])
    .order('importance', { ascending: false });

  if (error) throw error;
  return data;
}

async function getEntriesByType(entryType) {
  const db = getClient();
  const { data, error } = await db
    .from('entries')
    .select('*')
    .eq('entry_type', entryType)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

// --- Actions ---

async function saveAction(action) {
  const db = getClient();
  const { data, error } = await db.from('actions').insert(action).select().single();
  if (error) throw error;
  return data;
}

async function getOpenActions() {
  const db = getClient();
  const { data, error } = await db
    .from('actions')
    .select('*')
    .eq('status', 'open')
    .order('due_date', { ascending: true, nullsFirst: false });

  if (error) throw error;
  return data;
}

async function updateAction(id, updates) {
  const db = getClient();
  const { error } = await db.from('actions').update(updates).eq('id', id);
  if (error) throw error;
}

async function getOverdueActions() {
  const db = getClient();
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await db
    .from('actions')
    .select('*')
    .eq('status', 'open')
    .lt('due_date', today);

  if (error) throw error;
  return data;
}

async function getCompletedActions() {
  const db = getClient();
  const { data, error } = await db
    .from('actions')
    .select('*')
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

async function getAllActions() {
  const db = getClient();
  const { data, error } = await db
    .from('actions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

async function getEntriesBySession(sessionId) {
  const db = getClient();
  const { data, error } = await db
    .from('entries')
    .select('*')
    .eq('session_id', sessionId)
    .order('importance', { ascending: false });

  if (error) throw error;
  return data;
}

// --- Files ---

async function saveFile(file) {
  const db = getClient();
  const { data, error } = await db.from('files').insert(file).select().single();
  if (error) throw error;
  return data;
}

async function getFiles() {
  const db = getClient();
  const { data, error } = await db.from('files').select('*').order('uploaded_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function resetAllData() {
  const db = getClient();
  const tableConfigs = [
    { table: 'entries', dateCol: 'created_at' },
    { table: 'actions', dateCol: 'created_at' },
    { table: 'overrides', dateCol: 'created_at' },
    { table: 'files', dateCol: 'uploaded_at' },
    { table: 'sessions', dateCol: 'created_at' },
    { table: 'goals', dateCol: 'created_at' },
  ];

  for (const { table, dateCol } of tableConfigs) {
    const { error } = await db
      .from(table)
      .delete()
      .gte(dateCol, '1970-01-01T00:00:00Z');

    if (error) throw new Error(`Failed to clear ${table}: ${error.message}`);
  }
}

// --- Search entries by keyword ---

async function searchEntries(keywords, limit = 10) {
  const db = getClient();
  // Use ilike for case-insensitive search across entry content
  // Search for any keyword match
  let query = db.from('entries').select('*');

  // Build OR filter for keywords
  const filters = keywords.map((kw) => `content.ilike.%${kw}%`);
  query = query.or(filters.join(','));

  const { data, error } = await query
    .order('importance', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

// --- Overrides ---

async function saveOverride(override) {
  const db = getClient();
  const { data, error } = await db.from('overrides').insert(override).select().single();
  if (error) throw error;
  return data;
}

async function getUnresolvedOverrides() {
  const db = getClient();
  const { data, error } = await db
    .from('overrides')
    .select('*')
    .is('outcome', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

async function updateOverride(id, updates) {
  const db = getClient();
  const { data, error } = await db.from('overrides').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

async function getAllOverrides() {
  const db = getClient();
  const { data, error } = await db
    .from('overrides')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function deleteSession(id) {
  const db = getClient();
  // Unlink entries from this session (don't delete them — they may have standalone value)
  await db.from('entries').update({ session_id: null }).eq('session_id', id);
  const { error } = await db.from('sessions').delete().eq('id', id);
  if (error) throw error;
}

async function deleteAllSessions() {
  const db = getClient();
  // Unlink all session-linked entries first
  await db.from('entries').update({ session_id: null }).not('session_id', 'is', null);
  const { error } = await db.from('sessions').delete().gte('created_at', '1970-01-01T00:00:00Z');
  if (error) throw error;
}

module.exports = {
  initDB, getClient,
  saveGoal, getActiveGoals, getGoal, updateGoalStatus, getAllGoals, archiveGoal, unarchiveGoal, getArchivedGoals, countGoalLinkedItems, deleteGoalCascade,
  createSession, updateSession, getRecentSessions, cleanupEmptySessions, cleanupOldSessions, deleteSession, deleteAllSessions,
  saveEntry, getRecentEntries, getPersistentEntries, cleanupOldEntries, getEntriesByGoal, getEntriesByType,
  saveAction, getOpenActions, updateAction, getOverdueActions, getCompletedActions, getAllActions,
  getEntriesBySession,
  saveOverride, getUnresolvedOverrides, updateOverride, getAllOverrides,
  saveFile, getFiles, resetAllData, searchEntries,
};
