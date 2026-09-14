// Public config for the browser client. The anon key is meant to be public —
// per spec §6/§8, access control lives entirely in Postgres RLS, not in
// hiding this key. Never put the service_role key or OneSignal REST key here.
export const SUPABASE_URL = "https://pympzzwlaveyhnzwfomb.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5bXB6endsYXZleWhuendmb21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNDk5NjUsImV4cCI6MjEwNDkyNTk2NX0.uTKCaASxfcrwpnhzXaPVuFnnozh1pmWvhnoAj51UfKA";
