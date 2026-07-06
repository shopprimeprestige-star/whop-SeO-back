import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ponteGenerateApiKey, ponteTestCallback, ponteUpsertStore } from "@/server-fn/ponte.functions";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  ClipboardPaste,
  Copy,
  RefreshCw,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";

// Wizard "Nuovo store" per il Sito Ponte (Sito B).
// Stesso motore del Sito A: array di step, barra di progresso, "Passo X di N",
// valid per-step, hideNav per lo step provider, next() con guardia di validità.
// Ogni campo è un "Incolla" con auto-avanzamento (paste → valida → avanza).

type Provider = "native" | "shopify";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WizardStep {
  key: string;
  title: string;
  description?: string;
  hideNav?: boolean;
  valid: boolean;
  render: () => React.ReactNode;
}

export default function StoreWizard({ onSaved }: { onSaved?: (id: string) => void }) {
  const qc = useQueryClient();
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const [index, setIndex] = useState(0);
  const [provider, setProvider] = useState<Provider>("native");
  const [savedId, setSavedId] = useState<string | null>(null);

  const [form, setForm] = useState({
    display_name: "",
    site_a_store_id: "",
    bridge_site_url: origin,
    bridge_api_key: "",
    callback_url: "",
    // Nativo (Whop iframe)
    whop_api_key: "",
    whop_company_id: "",
    whop_webhook_secret: "",
    // Apple / Google Pay (opzionale, solo nativo)
    pay_public_domain: "",
    apple_pay_file: "",
    // Shopify
    shop_domain: "",
    shopify_api_key: "",
    shopify_api_secret: "",
    shopify_access_token: "",
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const base = (form.bridge_site_url || origin).replace(/\/+$/, "");
  const webhookUrl =
    provider === "native"
      ? `${base}/api/public/whop-webhook`
      : `${base}/api/public/bridge/shopify-webhook`;

  function copy(text: string, label = "Copiato") {
    navigator.clipboard.writeText(text).then(
      () => toast.success(label),
      () => toast.error("Copia non riuscita"),
    );
  }

  const genKey = useMutation({
    mutationFn: () => ponteGenerateApiKey(),
    onSuccess: (r) => {
      set({ bridge_api_key: r.key });
      toast.success("Bridge API key generata");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });

  const save = useMutation({
    mutationFn: () =>
      ponteUpsertStore({
        data: {
          site_a_store_id: form.site_a_store_id.trim(),
          shop_domain: provider === "shopify" ? form.shop_domain.trim().toLowerCase() : "",
          display_name: form.display_name.trim() || null,
          checkout_provider: provider,
          shopify_api_version: "2024-10",
          bridge_api_key: form.bridge_api_key.trim(),
          callback_url: form.callback_url.trim() || null,
          custom_domains:
            provider === "native" && form.pay_public_domain.trim()
              ? [form.pay_public_domain.trim().toLowerCase()]
              : [],
          // Nativo
          whop_api_key: provider === "native" ? form.whop_api_key.trim() || null : undefined,
          whop_company_id: provider === "native" ? form.whop_company_id.trim() || null : undefined,
          whop_webhook_secret:
            provider === "native" ? form.whop_webhook_secret.trim() || null : undefined,
          // Shopify
          shopify_api_key: provider === "shopify" ? form.shopify_api_key.trim() || null : undefined,
          shopify_api_secret:
            provider === "shopify" ? form.shopify_api_secret.trim() || null : undefined,
          shopify_access_token:
            provider === "shopify" ? form.shopify_access_token.trim() || undefined : undefined,
        },
      }),
    onSuccess: (r) => {
      toast.success("Store creato");
      qc.invalidateQueries({ queryKey: ["ponte"] });
      setSavedId(r.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore", { duration: 12000 }),
  });

  const testCallback = useMutation({
    mutationFn: () => ponteTestCallback({ data: { id: savedId! } }),
    onSuccess: (r) =>
      r.ok
        ? toast.success(`Callback OK (${r.status})`)
        : toast.error(`Callback fallito: ${r.response ?? r.status}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });

  // ------- definizione step (dinamica in base al provider) -------
  const uuidOk = UUID_RE.test(form.site_a_store_id.trim());
  const apiKeyOk = form.bridge_api_key.trim().length >= 16;

  const steps: WizardStep[] = [];

  steps.push({
    key: "provider",
    title: "Provider checkout",
    description: "Dove gestire pagamento e ordine per questo store.",
    hideNav: true,
    valid: true,
    render: () => (
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            {
              id: "native",
              title: "Nativo (Whop iframe)",
              desc: "Checkout integrato on-site tramite iframe Whop. L'utente non lascia il sito.",
              icon: <Boxes className="h-5 w-5" />,
            },
            {
              id: "shopify",
              title: "Shopify",
              desc: "Checkout ufficiale Shopify (draft order + invoice_url).",
              icon: <ShoppingBag className="h-5 w-5" />,
            },
          ] as { id: Provider; title: string; desc: string; icon: React.ReactNode }[]
        ).map((opt) => {
          const active = provider === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setProvider(opt.id);
                setIndex((i) => i + 1);
              }}
              className={`flex flex-col gap-2 rounded-xl border p-5 text-left transition-all ${
                active
                  ? "border-zinc-900 bg-zinc-50 ring-2 ring-zinc-900/10"
                  : "border-zinc-200 hover:border-zinc-400"
              }`}
            >
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-zinc-900 text-white">
                {opt.icon}
              </span>
              <span className="text-sm font-semibold text-zinc-900">{opt.title}</span>
              <span className="text-xs text-zinc-500">{opt.desc}</span>
            </button>
          );
        })}
      </div>
    ),
  });

  steps.push({
    key: "bridge_name",
    title: "Bridge Name",
    description: "Nome interno per riconoscere lo store (facoltativo).",
    valid: true,
    render: () => (
      <FieldShell label="Bridge Name (facoltativo)">
        <PasteInput
          value={form.display_name}
          placeholder="Es. Acme Shop IT"
          onChange={(v) => set({ display_name: v })}
          onAutoAdvance={() => advance()}
        />
      </FieldShell>
    ),
  });

  steps.push({
    key: "site_a_store_id",
    title: "site_a_store_id (UUID)",
    description:
      "Deve combaciare ESATTAMENTE con il valore generato sul Sito A, altrimenti il callback risponde 404.",
    valid: uuidOk,
    render: () => (
      <FieldShell
        label="site_a_store_id"
        hint={
          form.site_a_store_id && !uuidOk
            ? "Non è un UUID valido."
            : uuidOk
              ? "UUID valido ✓"
              : "Incolla l'UUID copiato dal Sito A."
        }
        hintError={!!form.site_a_store_id && !uuidOk}
      >
        <PasteInput
          mono
          value={form.site_a_store_id}
          placeholder="00000000-0000-0000-0000-000000000000"
          onChange={(v) => set({ site_a_store_id: v.trim() })}
          onAutoAdvance={(t) => UUID_RE.test(t.trim()) && advance()}
        />
      </FieldShell>
    ),
  });

  steps.push({
    key: "bridge_site_url",
    title: "BRIDGE_SITE_URL / Dominio webhook",
    description: "URL pubblico di questo Sito Ponte. Da qui si costruisce l'URL webhook.",
    valid: true,
    render: () => (
      <div className="space-y-4">
        <FieldShell label="BRIDGE_SITE_URL" hint="URL pubblico di questo Sito Ponte. Copialo e incollalo su Sito A.">
          <div className="flex gap-2">
            <Input
              value={form.bridge_site_url}
              placeholder={origin || "https://sito-ponte.example"}
              onChange={(e) => set({ bridge_site_url: e.target.value.trim() })}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => {
                const v = (form.bridge_site_url || origin).trim();
                if (!v) {
                  toast.error("URL vuoto");
                  return;
                }
                copy(v, "URL copiato");
                advance();
              }}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Copia e continua
            </Button>
          </div>
        </FieldShell>
        <UrlBox
          label="URL webhook risultante"
          url={webhookUrl}
          onCopy={() => copy(webhookUrl, "URL webhook copiato")}
        />
        <p className="text-[11px] text-zinc-500">
          {provider === "native"
            ? "Endpoint webhook per il provider nativo (Whop)."
            : "Endpoint webhook per Shopify."}
        </p>
      </div>
    ),
  });

  steps.push({
    key: "bridge_api_key",
    title: "Bridge API Key",
    description: "La chiave condivisa con il Sito A. Deve corrispondere 1:1 a quella generata su A.",
    valid: apiKeyOk,
    render: () => (
      <FieldShell
        label="Bridge API Key"
        hint={
          form.bridge_api_key && !apiKeyOk
            ? "Minimo 16 caratteri."
            : apiKeyOk
              ? "Lunghezza OK ✓"
              : "Incolla la chiave dal Sito A (min. 16 caratteri)."
        }
        hintError={!!form.bridge_api_key && !apiKeyOk}
      >
        <div className="flex flex-col gap-2">
          <PasteInput
            mono
            value={form.bridge_api_key}
            placeholder="Incolla la Bridge API key"
            onChange={(v) => set({ bridge_api_key: v.trim() })}
            onAutoAdvance={(t) => t.trim().length >= 16 && advance()}
          />
          <button
            type="button"
            onClick={() => genKey.mutate()}
            className="self-start text-[11px] text-zinc-500 underline hover:text-zinc-900"
          >
            <RefreshCw className="mr-1 inline h-3 w-3" /> oppure genera una nuova chiave qui
          </button>
        </div>
      </FieldShell>
    ),
  });

  steps.push({
    key: "callback_url",
    title: "BRIDGE_CALLBACK_URL",
    description: "URL del Sito A che riceve gli eventi (callback firmato HMAC).",
    valid: true,
    render: () => (
      <FieldShell label="BRIDGE_CALLBACK_URL" hint="Incolla l'URL callback del Sito A.">
        <PasteInput
          mono
          value={form.callback_url}
          placeholder="https://<sito-a>/.../bridge-callback"
          onChange={(v) => set({ callback_url: v.trim() })}
          onAutoAdvance={() => advance()}
        />
      </FieldShell>
    ),
  });

  if (provider === "native") {
    const whopOk = form.whop_api_key.trim().length > 0;
    steps.push({
      key: "whop",
      title: "Credenziali Whop",
      description: "API key, Company ID e webhook secret per il checkout nativo.",
      valid: whopOk,
      render: () => (
        <div className="space-y-4">
          <FieldShell
            label="Whop API key *"
            hint={whopOk ? "OK ✓" : "Obbligatoria."}
            hintError={false}
          >
            <PasteInput
              mono
              value={form.whop_api_key}
              placeholder="whop_live_..."
              onChange={(v) => set({ whop_api_key: v.trim() })}
              onAutoAdvance={() => {}}
            />
          </FieldShell>
          <FieldShell label="Whop Company ID (biz_…)" hint="Da whop.com/dashboard/biz_XXXX.">
            <PasteInput
              mono
              value={form.whop_company_id}
              placeholder="biz_xxxxxxxxxxxx"
              onChange={(v) => set({ whop_company_id: v.trim() })}
              onAutoAdvance={() => {}}
            />
          </FieldShell>
          <FieldShell label="Whop webhook secret" hint="Signing secret whsec_…">
            <PasteInput
              mono
              value={form.whop_webhook_secret}
              placeholder="whsec_..."
              onChange={(v) => set({ whop_webhook_secret: v.trim() })}
              onAutoAdvance={() => {}}
            />
          </FieldShell>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-xs font-semibold text-zinc-900">
              Incolla questo URL su Whop → Developer → Webhooks (evento{" "}
              <code>payment.succeeded</code>):
            </p>
            <div className="mt-2">
              <UrlBox url={webhookUrl} onCopy={() => copy(webhookUrl, "URL webhook copiato")} />
            </div>
          </div>
        </div>
      ),
    });

    steps.push({
      key: "wallet",
      title: "Apple Pay / Google Pay (opzionale)",
      description: "Configura i wallet sul dominio pubblico. Puoi saltare questo passo.",
      valid: true,
      render: () => (
        <div className="space-y-4">
          <FieldShell
            label="Dominio pubblico"
            hint="Dominio su cui abilitare i wallet (finisce in custom_domains)."
          >
            <PasteInput
              value={form.pay_public_domain}
              placeholder="shop.miodominio.com"
              onChange={(v) => set({ pay_public_domain: v.trim().toLowerCase() })}
              onAutoAdvance={() => {}}
            />
          </FieldShell>
          <FieldShell
            label="Contenuto file di verifica Apple Pay"
            hint="Incolla il contenuto del file apple-developer-merchantid-domain-association."
          >
            <Textarea
              value={form.apple_pay_file}
              onChange={(e) => set({ apple_pay_file: e.target.value })}
              rows={4}
              placeholder="7B227073…"
              className="font-mono text-xs"
            />
          </FieldShell>
        </div>
      ),
    });
  } else {
    const shopOk = /\.myshopify\.com$/i.test(form.shop_domain.trim());
    steps.push({
      key: "shopify",
      title: "Connessione Shopify",
      description: "Shop domain e credenziali OAuth (Client ID/Secret) oppure Access token.",
      valid: shopOk,
      render: () => (
        <div className="space-y-4">
          <FieldShell
            label="Shop domain"
            hint={
              form.shop_domain && !shopOk
                ? "Deve finire con .myshopify.com"
                : shopOk
                  ? "OK ✓"
                  : "Es. mio-store.myshopify.com"
            }
            hintError={!!form.shop_domain && !shopOk}
          >
            <PasteInput
              value={form.shop_domain}
              placeholder="mio-store.myshopify.com"
              onChange={(v) => set({ shop_domain: v.trim().toLowerCase() })}
              onAutoAdvance={() => {}}
            />
          </FieldShell>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldShell label="Client ID (App OAuth)">
              <PasteInput
                mono
                value={form.shopify_api_key}
                placeholder="1a2b3c4d…"
                onChange={(v) => set({ shopify_api_key: v.trim() })}
                onAutoAdvance={() => {}}
              />
            </FieldShell>
            <FieldShell label="Client Secret">
              <PasteInput
                mono
                value={form.shopify_api_secret}
                placeholder="shpss_…"
                onChange={(v) => set({ shopify_api_secret: v.trim() })}
                onAutoAdvance={() => {}}
              />
            </FieldShell>
          </div>
          <FieldShell
            label="Access token (alternativa a OAuth — Custom App)"
            hint="Lascia vuoto se userai il flusso OAuth dopo la creazione."
          >
            <PasteInput
              mono
              value={form.shopify_access_token}
              placeholder="shpat_…"
              onChange={(v) => set({ shopify_access_token: v.trim() })}
              onAutoAdvance={() => {}}
            />
          </FieldShell>
          <UrlBox
            label="Allowed redirection URL (Partner App)"
            url={`${base}/api/public/bridge/shopify-oauth/callback`}
            onCopy={() =>
              copy(`${base}/api/public/bridge/shopify-oauth/callback`, "Redirect URL copiato")
            }
          />
        </div>
      ),
    });
  }

  const canSave =
    uuidOk &&
    apiKeyOk &&
    (provider === "native"
      ? form.whop_api_key.trim().length > 0
      : /\.myshopify\.com$/i.test(form.shop_domain.trim()));

  steps.push({
    key: "recap",
    title: "Riepilogo e salvataggio",
    description: "Controlla i dati e crea lo store. I segreti vengono cifrati sul server.",
    valid: canSave,
    render: () => (
      <div className="space-y-4">
        <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm sm:grid-cols-2">
          <Row k="Provider" v={provider === "native" ? "Nativo (Whop iframe)" : "Shopify"} />
          <Row k="Bridge Name" v={form.display_name || "—"} />
          <Row k="site_a_store_id" v={form.site_a_store_id} mono ok={uuidOk} />
          <Row k="Bridge API key" v={form.bridge_api_key ? "•••• (impostata)" : "—"} ok={apiKeyOk} />
          <Row k="Callback URL" v={form.callback_url || "—"} mono />
          <Row k="Webhook URL" v={webhookUrl} mono />
          {provider === "native" ? (
            <>
              <Row k="Whop API key" v={form.whop_api_key ? "•••• (impostata)" : "—"} ok={!!form.whop_api_key} />
              <Row k="Whop Company ID" v={form.whop_company_id || "—"} mono />
              <Row k="Dominio wallet" v={form.pay_public_domain || "—"} mono />
            </>
          ) : (
            <>
              <Row k="Shop domain" v={form.shop_domain || "—"} mono />
              <Row k="Client ID" v={form.shopify_api_key || "—"} mono />
              <Row k="Access token" v={form.shopify_access_token ? "•••• (impostato)" : "—"} />
            </>
          )}
        </dl>
        {!canSave && (
          <p className="text-xs text-red-600">
            Completa i campi obbligatori: UUID valido, Bridge API key (≥16),{" "}
            {provider === "native" ? "Whop API key" : "Shop domain .myshopify.com"}.
          </p>
        )}
        <Button
          type="button"
          onClick={() => save.mutate()}
          disabled={!canSave || save.isPending}
          className="bg-zinc-900 text-white hover:bg-zinc-800"
        >
          {save.isPending ? "Creazione…" : "Crea store"}
        </Button>
      </div>
    ),
  });

  const total = steps.length;
  const clamped = Math.min(index, total - 1);
  const step = steps[clamped];

  function goNext() {
    if (!step.valid) {
      toast.error("Completa questo passo prima di continuare.");
      return;
    }
    setIndex((i) => Math.min(i + 1, total - 1));
  }
  // Avanzamento incondizionato: usato dopo copia/incolla, che validano già il valore
  // appena inserito (evita il bug della validità "stale" dentro l'handler di paste).
  function advance() {
    setIndex((i) => Math.min(i + 1, total - 1));
  }
  function goBack() {
    setIndex((i) => Math.max(i - 1, 0));
  }

  // ------- schermata finale dopo il salvataggio -------
  if (savedId) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-600 text-white">
          <Check className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-emerald-900">Store creato</h2>
        <p className="mt-1 text-sm text-emerald-700">
          Puoi testare subito il callback verso il Sito A oppure aprire lo store.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => testCallback.mutate()}
            disabled={testCallback.isPending || !form.callback_url}
          >
            {testCallback.isPending ? "Test…" : "Testa callback"}
          </Button>
          <Button
            type="button"
            className="bg-zinc-900 text-white hover:bg-zinc-800"
            onClick={() => onSaved?.(savedId)}
          >
            Apri store <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Barra di progresso + "Passo X di N" */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs font-medium text-zinc-500">
          <span>
            Passo {clamped + 1} di {total}
          </span>
          <span>{Math.round(((clamped + 1) / total) * 100)}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-zinc-900 transition-all"
            style={{ width: `${((clamped + 1) / total) * 100}%` }}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-900">{step.title}</h2>
        {step.description && <p className="mt-1 text-xs text-zinc-500">{step.description}</p>}
        <div className="mt-5">{step.render()}</div>
      </div>

      {/* Navigazione (nascosta sugli step hideNav) */}
      {!step.hideNav && (
        <div className="mt-5 flex items-center justify-between">
          <Button type="button" variant="outline" onClick={goBack} disabled={clamped === 0}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Indietro
          </Button>
          {clamped < total - 1 && (
            <Button
              type="button"
              onClick={goNext}
              className="bg-zinc-900 text-white hover:bg-zinc-800"
            >
              Avanti <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          )}
        </div>
      )}
      {step.hideNav && clamped > 0 && (
        <div className="mt-5">
          <Button type="button" variant="outline" onClick={goBack}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Indietro
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------- sotto-componenti ----------

function FieldShell({
  label,
  hint,
  hintError,
  children,
}: {
  label: string;
  hint?: string;
  hintError?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-zinc-700">{label}</Label>
      {children}
      {hint && (
        <p className={`text-[11px] ${hintError ? "text-red-600" : "text-zinc-500"}`}>{hint}</p>
      )}
    </div>
  );
}

function PasteInput({
  value,
  onChange,
  onAutoAdvance,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  onAutoAdvance?: (pasted: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  async function pasteFromClipboard() {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) {
        toast.error("Appunti vuoti");
        return;
      }
      onChange(t);
      setTimeout(() => onAutoAdvance?.(t), 120);
    } catch {
      toast.error("Impossibile leggere gli appunti — incolla manualmente nel campo");
    }
  }
  return (
    <div className="flex gap-2">
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const t = e.clipboardData.getData("text").trim();
          if (t) {
            e.preventDefault();
            onChange(t);
            setTimeout(() => onAutoAdvance?.(t), 120);
          }
        }}
        className={mono ? "font-mono text-xs" : ""}
      />
      <Button type="button" variant="outline" onClick={pasteFromClipboard} className="shrink-0">
        <ClipboardPaste className="mr-1.5 h-3.5 w-3.5" /> Incolla
      </Button>
    </div>
  );
}

function UrlBox({ label, url, onCopy }: { label?: string; url: string; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
      {label && (
        <span className="w-28 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {label}
        </span>
      )}
      <code className="flex-1 truncate text-xs text-zinc-700">{url}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-zinc-500 hover:text-zinc-900"
        onClick={onCopy}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function Row({ k, v, mono, ok }: { k: string; v: string; mono?: boolean; ok?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-zinc-500">{k}</dt>
      <dd
        className={`max-w-[60%] truncate text-right text-xs ${mono ? "font-mono" : ""} ${
          ok === false ? "text-red-600" : "text-zinc-900"
        }`}
        title={v}
      >
        {v}
      </dd>
    </div>
  );
}
