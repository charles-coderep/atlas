const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

let supabase;

function initDB() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env file');
  }

  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  return supabase;
}

function getClient() {
  if (!supabase) initDB();
  return supabase;
}

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

  const { error } = await db
    .from('goals')
    .upsert(row, { onConflict: 'id' });

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
  const { data, error } = await db
    .from('goals')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function updateGoalStatus(id, status) {
  const db = getClient();
  const { error } = await db
    .from('goals')
    .update({ status })
    .eq('id', id);

  if (error) throw error;
}

async function getAllGoals() {
  const db = getClient();
  const { data, error } = await db
    .from('goals')
    .select('*')
    .order('created_at');

  if (error) throw error;
  return data;
}

module.exports = { initDB, getClient, saveGoal, getActiveGoals, getGoal, updateGoalStatus, getAllGoals };
