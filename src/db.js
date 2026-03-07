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

module.exports = {
  initDB, getClient,
  saveGoal, getActiveGoals, getGoal, updateGoalStatus, getAllGoals,
  createSession, updateSession, getRecentSessions,
  saveEntry, getRecentEntries, getPersistentEntries, getEntriesByGoal, getEntriesByType,
  saveAction, getOpenActions, updateAction, getOverdueActions, getCompletedActions, getAllActions,
  getEntriesBySession,
  saveOverride, getUnresolvedOverrides,
  saveFile, getFiles, searchEntries,
};
