import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, HOUSEHOLD_ID } from "./config.js";

// Shared state is kept in one row, but every save is conditional on the row's
// revision. The app retries conflicts by replaying its queued operations over
// the newest row, so edits from another phone are not silently overwritten.

const LOCAL_KEY = "chorebubbles:data:" + HOUSEHOLD_ID;
const PENDING_KEY = "chorebubbles:pending:" + HOUSEHOLD_ID;

let supa = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export const isSynced = () => !!supa;

export async function getAuthSession() {
  if (!supa) return null;
  const { data, error } = await supa.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthSessionChange(callback) {
  if (!supa) return () => {};
  const { data } = supa.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function sendMagicLink(email) {
  if (!supa) return;
  const { error } = await supa.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split("#")[0] },
  });
  if (error) throw error;
}

// Verify the 6-digit code from the email. Unlike a magic link, this completes
// sign-in inside the current context, so it works in an installed iOS PWA where
// the app has separate storage from Safari.
export async function verifyEmailOtp(email, token) {
  if (!supa) return null;
  const { data, error } = await supa.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  if (!supa) return;
  const { error } = await supa.auth.signOut();
  if (error) throw error;
}

export async function getSharedRecord() {
  if (!supa) {
    const raw = localStorage.getItem(LOCAL_KEY);
    return { value: raw ? JSON.parse(raw) : null, revision: 0 };
  }

  const { data, error } = await supa
    .from("chorebubbles")
    .select("value, revision")
    .eq("id", HOUSEHOLD_ID)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This account is not a member of the configured household.");
  return { value: data.value, revision: Number(data.revision || 0) };
}

export async function compareAndSetShared(value, expectedRevision) {
  if (!supa) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
    return { ok: true, value, revision: expectedRevision + 1 };
  }

  const nextRevision = expectedRevision + 1;
  const { data, error } = await supa
    .from("chorebubbles")
    .update({ value, revision: nextRevision, updated_at: new Date().toISOString() })
    .eq("id", HOUSEHOLD_ID)
    .eq("revision", expectedRevision)
    .select("value, revision")
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, conflict: true };
  return { ok: true, value: data.value, revision: Number(data.revision) };
}

export function getPendingOperations() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function enqueueOperation(operation) {
  const pending = getPendingOperations();
  if (!pending.some((item) => item.id === operation.id)) pending.push(operation);
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

export function removePendingOperations(ids) {
  const completed = new Set(ids);
  const remaining = getPendingOperations().filter((item) => !completed.has(item.id));
  localStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
  return remaining;
}

// Device identity ("whose phone is this") is always local.
const ME_KEY = "chorebubbles:me";
export const getMe = () => localStorage.getItem(ME_KEY);
export const setMe = (who) => localStorage.setItem(ME_KEY, who);
