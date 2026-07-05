// Pool fisso di 10 codici PRD ruotati a rotazione per i draft order Shopify.
// La rotazione è deterministica + pseudo-random: usa un seed (es. session_id, timestamp,
// o variant_id) per scegliere uno dei 10 codici. Il merchant vede sempre uno di questi 10
// titoli nel checkout invece del nome prodotto reale.

export const PRD_POOL = [
  "PRD-01484",
  "PRD-02371",
  "PRD-03928",
  "PRD-04562",
  "PRD-05819",
  "PRD-06407",
  "PRD-07193",
  "PRD-08756",
  "PRD-09231",
  "PRD-10648",
] as const;

/**
 * Sceglie un codice PRD dal pool. Se viene passato un seed, la scelta è deterministica
 * sul seed (utile per debug). Senza seed, scelta casuale.
 */
export function pickPrdCode(seed?: string | number | null): string {
  if (seed === undefined || seed === null || seed === "") {
    return PRD_POOL[Math.floor(Math.random() * PRD_POOL.length)];
  }
  const str = String(seed);
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % PRD_POOL.length;
  return PRD_POOL[idx];
}
