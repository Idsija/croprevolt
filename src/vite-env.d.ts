/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL for the online leaderboard (optional). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon public key for the online leaderboard (optional). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
