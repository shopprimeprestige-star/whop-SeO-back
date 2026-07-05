// Config Supabase CONDIVISA da tutti i worker checkout whop.
//
// Bakata nel codice così ogni worker buildato da questo repo
// (whop-alx-001-checkout ... whop-alx-0018-checkout) usa lo STESSO database
// (project jizvyvehbhdakugygogv) senza dover impostare secret/var su Cloudflare.
//
// Le env var, se presenti sul worker, hanno comunque la PRIORITÀ su questi
// default (es. SUPABASE_SERVICE_ROLE_KEY per scritture admin).
//
// NB: la anon/publishable key è PUBBLICA per definizione — viaggia già nel
// bundle client — quindi non è un segreto e può stare nel repo.
// ENCRYPTION_KEY non è più richiesta: i token in DB sono salvati in chiaro.
export const SHARED_SUPABASE_URL = "https://jizvyvehbhdakugygogv.supabase.co";
export const SHARED_SUPABASE_PROJECT_ID = "jizvyvehbhdakugygogv";
export const SHARED_SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppenZ5dmVoYmhkYWt1Z3lnb2d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NjA1NDQsImV4cCI6MjA5NjIzNjU0NH0.GoS9xTt_bcM7zN3NEZWQulTnu7D0A0hkkfs3r9j4D5c";
