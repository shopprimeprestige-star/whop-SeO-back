import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ponteGenerateApiKey, ponteTestCallback, ponteTestShopify, ponteUpsertStore } from "@/server-fn/ponte.functions";
import { Copy, Eye, EyeOff, Link2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface NoteAttribute { name: string; value: string }
type CheckoutProvider = "shopify" | "native" | "whop";
interface StoreData {
  id?: string;
  site_a_store_id?: string;
  shop_domain?: string;
  display_name?: string | null;
  shopify_api_version?: string;
  callback_url?: string | null;
  bridge_api_key?: string | null;
  webhook_secret?: string | null;
  shopify_api_key?: string | null;
  shopify_api_secret?: string | null;
  is_active?: boolean;
  last_handshake_at?: string | null;
  last_callback_at?: string | null;
  last_error?: string | null;
  default_tags?: string | null;
  default_order_note?: string | null;
  default_note_attributes?: unknown;
  user_agent?: string | null;
  rate_limit_rps?: number | null;
  custom_domains?: string[] | null;
  checkout_provider?: string | null;
  whop_api_key?: string | null;
  whop_company_id?: string | null;
  whop_product_id?: string | null;
  whop_plan_id?: string | null;
  whop_webhook_secret?: string | null;

}

export default function StoreForm({
  mode,
  initial,
  onSaved,
}: {
  mode: "create" | "edit";
  initial?: StoreData | null;
  onSaved?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);

  const initialAttrs: NoteAttribute[] = Array.isArray(initial?.default_note_attributes)
    ? (initial!.default_note_attributes as Array<{ name?: string; value?: string }>).map((a) => ({
        name: String(a?.name ?? ""),
        value: String(a?.value ?? ""),
      }))
    : [];

  const [form, setForm] = useState({
    site_a_store_id: initial?.site_a_store_id ?? crypto.randomUUID(),
    shop_domain: initial?.shop_domain ?? "",
    display_name: initial?.display_name ?? "",
    checkout_provider: ((initial?.checkout_provider as CheckoutProvider) ?? "shopify") as CheckoutProvider,
    shopify_access_token: "",
    shopify_api_version: initial?.shopify_api_version ?? "2024-10",
    shopify_api_key: initial?.shopify_api_key ?? "",
    shopify_api_secret: initial?.shopify_api_secret ?? "",
    bridge_api_key: initial?.bridge_api_key ?? "",
    callback_url: initial?.callback_url ?? "",
    shopify_webhook_secret: initial?.webhook_secret ?? "",
    whop_api_key: initial?.whop_api_key ?? "",
    whop_company_id: initial?.whop_company_id ?? "",
    whop_product_id: initial?.whop_product_id ?? "",
    whop_plan_id: initial?.whop_plan_id ?? "",
    whop_webhook_secret: initial?.whop_webhook_secret ?? "",

    is_active: initial?.is_active ?? true,
    default_tags: initial?.default_tags ?? "",
    default_order_note: initial?.default_order_note ?? "",
    default_note_attributes: initialAttrs,
    user_agent: initial?.user_agent ?? "",
    rate_limit_rps: initial?.rate_limit_rps ?? 2,
    custom_domains: (initial?.custom_domains ?? []).join("\n"),
  });

  useEffect(() => {
    if (initial) {
      const attrs: NoteAttribute[] = Array.isArray(initial.default_note_attributes)
        ? (initial.default_note_attributes as Array<{ name?: string; value?: string }>).map((a) => ({
            name: String(a?.name ?? ""),
            value: String(a?.value ?? ""),
          }))
        : [];
      setForm((f) => ({
        ...f,
        site_a_store_id: initial.site_a_store_id ?? f.site_a_store_id,
        shop_domain: initial.shop_domain ?? f.shop_domain,
        display_name: initial.display_name ?? "",
        checkout_provider: ((initial.checkout_provider as CheckoutProvider) ?? f.checkout_provider) as CheckoutProvider,
        shopify_api_version: initial.shopify_api_version ?? f.shopify_api_version,
        shopify_api_key: initial.shopify_api_key ?? "",
        shopify_api_secret: initial.shopify_api_secret ?? "",
        bridge_api_key: initial.bridge_api_key ?? "",
        callback_url: initial.callback_url ?? "",
        shopify_webhook_secret: initial.webhook_secret ?? "",
        whop_api_key: initial.whop_api_key ?? "",
        whop_company_id: initial.whop_company_id ?? "",
        whop_product_id: initial.whop_product_id ?? "",
        whop_plan_id: initial.whop_plan_id ?? "",
        whop_webhook_secret: initial.whop_webhook_secret ?? "",

        is_active: initial.is_active ?? true,
        default_tags: initial.default_tags ?? "",
        default_order_note: initial.default_order_note ?? "",
        default_note_attributes: attrs,
        user_agent: initial.user_agent ?? "",
        rate_limit_rps: initial.rate_limit_rps ?? 2,
        custom_domains: (initial.custom_domains ?? []).join("\n"),
      }));
    }
  }, [initial]);

  const baseUrl = useMemo(() => (typeof window !== "undefined" ? window.location.origin : ""), []);
  const endpoints = {
    handshake: `${baseUrl}/api/public/bridge/handshake`,
    sync: `${baseUrl}/api/public/bridge/sync`,
    checkout: `${baseUrl}/api/public/bridge/generate-checkout`,
    webhook: `${baseUrl}/api/public/bridge/shopify-webhook`,
  };

  const HOSTNAME_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
  const parsedCustomDomains = useMemo(() => {
    const lines = (form.custom_domains || "")
      .split(/[\n,]/g)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return Array.from(new Set(lines));
  }, [form.custom_domains]);
  const customDomainsError = useMemo(() => {
    if (parsedCustomDomains.length > 5) return "Massimo 5 domini.";
    for (const d of parsedCustomDomains) {
      if (!HOSTNAME_RE.test(d)) return `Hostname non valido: "${d}"`;
      if (/^https?:\/\//i.test(d) || d.includes("/")) return `Niente protocollo o path: "${d}"`;
    }
    return null;
  }, [parsedCustomDomains]);

  const save = useMutation({
    mutationFn: () => {
      if (customDomainsError) throw new Error(customDomainsError);
      const secretValue = (current: string, original?: string | null) =>
        mode === "edit" && current === (original ?? "") ? undefined : current || null;
      return ponteUpsertStore({
        data: {
          id: initial?.id,
          site_a_store_id: form.site_a_store_id,
          shop_domain: form.shop_domain.trim().toLowerCase(),
          display_name: form.display_name || null,
          checkout_provider: form.checkout_provider,
          shopify_access_token: form.shopify_access_token || undefined,
          shopify_api_version: form.shopify_api_version,
          shopify_api_key: secretValue(form.shopify_api_key, initial?.shopify_api_key),
          shopify_api_secret: secretValue(form.shopify_api_secret, initial?.shopify_api_secret),
          bridge_api_key: mode === "edit" && form.bridge_api_key === (initial?.bridge_api_key ?? "") ? undefined : form.bridge_api_key || undefined,
          callback_url: form.callback_url || null,
          shopify_webhook_secret: secretValue(form.shopify_webhook_secret, initial?.webhook_secret),
          whop_api_key: secretValue(form.whop_api_key, initial?.whop_api_key),
          whop_company_id: form.whop_company_id || null,
          whop_product_id: form.whop_product_id || null,
          whop_plan_id: form.whop_plan_id || null,
          whop_webhook_secret: secretValue(form.whop_webhook_secret, initial?.whop_webhook_secret),

          is_active: form.is_active,
          default_tags: form.default_tags || null,
          default_order_note: form.default_order_note || null,
          default_note_attributes: form.default_note_attributes.filter((a) => a.name.trim()),
          user_agent: form.user_agent.trim() || null,
          rate_limit_rps: form.rate_limit_rps || 2,
          custom_domains: parsedCustomDomains,
        },
      });
    },
    onSuccess: (r) => {
      toast.success("Salvato");
      qc.invalidateQueries({ queryKey: ["ponte"] });
      if (onSaved) onSaved(r.id);
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : "Errore";
      toast.error(message, { duration: 12000 });
    },
  });

  const genKey = useMutation({
    mutationFn: () => ponteGenerateApiKey(),
    onSuccess: (r) => { setForm((f) => ({ ...f, bridge_api_key: r.key })); setShowKey(true); toast.success("Bridge API key generata"); },
  });
  const testShopify = useMutation({
    mutationFn: () => ponteTestShopify({ data: { id: initial!.id! } }),
    onSuccess: (r) => toast.success(`Shopify OK — ${r.shop_name} (${r.currency})`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });
  const testCallback = useMutation({
    mutationFn: () => ponteTestCallback({ data: { id: initial!.id! } }),
    onSuccess: (r) => r.ok ? toast.success(`Callback OK (${r.status})`) : toast.error(`Callback fallito: ${r.response ?? r.status}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });

  function copy(text: string, label = "Copiato") {
    navigator.clipboard.writeText(text); toast.success(label);
  }

  function setWhopPlanIdValue(value: string) {
    const companyId = value.match(/\b(?:biz|company)_[a-z0-9_-]+\b/i)?.[0];
    setForm((f) => companyId ? { ...f, whop_company_id: companyId, whop_plan_id: "" } : { ...f, whop_plan_id: value });
    if (companyId) toast.info("Ho spostato il biz_ nel campo Whop Company ID");
  }

  function statusBadge() {
    if (form.shopify_access_token === "" && initial?.last_error) return <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200">Errore</span>;
    if (initial?.last_handshake_at) return <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">Connesso</span>;
    return <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200">Mai connesso</span>;
  }

  const provider = form.checkout_provider;

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-6">
      {/* === SCELTA PROVIDER CHECKOUT === */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-900">Provider checkout</h2>
        <p className="mt-1 text-xs text-zinc-500">Scegli dove gestire pagamento e ordine per questo store.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {([
            { id: "shopify", title: "Shopify", desc: "Checkout ufficiale Shopify (draft order + invoice_url)." },
            { id: "native", title: "Nativo (Whop iframe)", desc: "Checkout integrato on-site tramite iframe Whop." },
            { id: "whop", title: "Whop (redirect)", desc: "Redirect al checkout hosted di Whop via API." },
          ] as { id: CheckoutProvider; title: string; desc: string }[]).map((opt) => {
            const active = provider === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setForm({ ...form, checkout_provider: opt.id })}
                className={`text-left rounded-xl border p-4 transition-all ${active ? "border-zinc-900 ring-2 ring-zinc-900/10 bg-zinc-50" : "border-zinc-200 hover:border-zinc-400"}`}
              >
                <div className="text-sm font-semibold text-zinc-900">{opt.title}</div>
                <div className="mt-1 text-xs text-zinc-500">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* === SCHEDA CONNESSIONE SITO A === */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900"><Sparkles className="h-4 w-4 text-zinc-400" /> Connessione Sito A</h2>
            <p className="mt-1 text-xs text-zinc-500">Endpoint e credenziali per parlare con questo Sito Ponte.</p>
          </div>
          {statusBadge()}
        </div>

        <div className="mt-5 grid gap-2">
          <EndpointRow label="Handshake" url={endpoints.handshake} onCopy={copy} />
          <EndpointRow label="Sync" url={endpoints.sync} onCopy={copy} />
          <EndpointRow label="Checkout" url={endpoints.checkout} onCopy={copy} />
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-700">site_a_store_id (UUID)</Label>
            <div className="flex gap-2">
              <Input value={form.site_a_store_id} onChange={(e) => setForm({ ...form, site_a_store_id: e.target.value })} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={() => copy(form.site_a_store_id, "store_id copiato")}><Copy className="h-3.5 w-3.5" /></Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-700">Bridge API key</Label>
            <div className="flex gap-2">
              <Input
                type={showKey ? "text" : "password"}
                value={form.bridge_api_key}
                onChange={(e) => setForm({ ...form, bridge_api_key: e.target.value })}
                placeholder={mode === "create" ? "Clicca Genera" : "(salvata)"}
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => setShowKey((v) => !v)}>{showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>
              <Button type="button" variant="outline" size="icon" onClick={() => copy(form.bridge_api_key, "API key copiata")}><Copy className="h-3.5 w-3.5" /></Button>
              <Button type="button" variant="outline" onClick={() => genKey.mutate()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Genera</Button>
            </div>
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-medium text-zinc-700">callback_url (Sito A → ricevitore eventi HMAC)</Label>
            <Input value={form.callback_url} onChange={(e) => setForm({ ...form, callback_url: e.target.value })} placeholder="https://<sito-a>/.../bridge-callback" />
          </div>
        </div>

        {initial?.id && (
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => testShopify.mutate()} disabled={testShopify.isPending}>Testa Shopify</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => testCallback.mutate()} disabled={testCallback.isPending || !form.callback_url}>Testa callback</Button>
          </div>
        )}
      </section>

      {/* === SHOPIFY === */}
      {provider === "shopify" && (
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-900">Connessione Shopify</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Inserisci Client ID e Secret della Partner App, poi clicca <strong>Connetti con Shopify</strong> per OAuth.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-700">Shop domain</Label>
            <Input required value={form.shop_domain} onChange={(e) => setForm({ ...form, shop_domain: e.target.value })} placeholder="mio-store.myshopify.com" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-700">Display name</Label>
            <Input value={form.display_name ?? ""} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="Es. Acme Shop IT" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-700">Client ID</Label>
            <Input
              value={form.shopify_api_key}
              onChange={(e) => setForm({ ...form, shopify_api_key: e.target.value })}
              placeholder="es. 1a2b3c4d5e6f7890..."
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-700">Client Secret</Label>
            <div className="flex gap-2">
              <Input
                type={showApiSecret ? "text" : "password"}
                value={form.shopify_api_secret}
                onChange={(e) => setForm({ ...form, shopify_api_secret: e.target.value })}
                placeholder="shpss_..."
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => setShowApiSecret((v) => !v)}>{showApiSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-700">Versione API</Label>
            <Input value={form.shopify_api_version} onChange={(e) => setForm({ ...form, shopify_api_version: e.target.value })} />
          </div>
          <div className="flex items-center gap-3 pt-7">
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            <Label className="text-sm text-zinc-700">Store attivo</Label>
          </div>

          <div className="md:col-span-2 space-y-1.5">
            <Label className="text-xs font-medium text-zinc-700">Access token Shopify (opzionale — Custom App)</Label>
            <div className="flex gap-2">
              <Input
                type={showToken ? "text" : "password"}
                value={form.shopify_access_token}
                onChange={(e) => setForm({ ...form, shopify_access_token: e.target.value })}
                placeholder="shpat_... (lascia vuoto se usi OAuth)"
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => setShowToken((v) => !v)}>{showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>
            </div>
            <p className="text-xs text-zinc-500">Lascia vuoto e usa <strong>Connetti con Shopify</strong> qui sotto.</p>
          </div>

          <div className="md:col-span-2 space-y-1.5">
            <Label className="text-xs font-medium text-zinc-700">Domini personalizzati (whitelist redirect checkout)</Label>
            <Textarea
              value={form.custom_domains}
              onChange={(e) => setForm({ ...form, custom_domains: e.target.value })}
              placeholder={"es.\nshop.miodominio.com\nnexa-world.vip"}
              rows={3}
              className="font-mono text-xs"
            />
            <p className="text-xs text-zinc-500">
              Uno per riga. Senza <code>https://</code> né path. Max 5. Necessario se Shopify genera <code>invoice_url</code> su un dominio custom (non *.myshopify.com).
            </p>
            {customDomainsError && <p className="text-xs text-red-600">{customDomainsError}</p>}
            {parsedCustomDomains.length > 0 && !customDomainsError && (
              <p className="text-xs text-emerald-700">{parsedCustomDomains.length} domini autorizzati: {parsedCustomDomains.join(", ")}</p>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Connetti via OAuth</h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                Apre Shopify per <code className="rounded bg-white px-1 py-0.5 text-zinc-700 ring-1 ring-zinc-200">{form.shop_domain || "<shop>.myshopify.com"}</code>.
              </p>
            </div>
            <Button
              type="button"
              disabled={!initial?.id || !form.shopify_api_key || !form.shopify_api_secret || !form.shop_domain}
              onClick={() => {
                if (!initial?.id) return;
                const popup = window.open(`/api/public/bridge/shopify-oauth/start?store_id=${initial.id}`, "shopify-oauth", "width=720,height=820");
                const onMsg = (e: MessageEvent) => {
                  if (e.data?.type === "shopify-oauth-done") {
                    toast.success("Shopify connesso. Ricarica per vedere lo stato.");
                    qc.invalidateQueries({ queryKey: ["ponte"] });
                    window.removeEventListener("message", onMsg);
                  }
                };
                window.addEventListener("message", onMsg);
                if (!popup) toast.error("Popup bloccato dal browser");
              }}
            >
              <Link2 className="mr-2 h-4 w-4" /> Connetti con Shopify
            </Button>
          </div>
          {!initial?.id && <p className="mt-2 text-xs text-amber-600">Salva prima lo store per abilitare il pulsante.</p>}

          <details className="mt-4 group rounded-lg border border-zinc-200 bg-white">
            <summary className="cursor-pointer list-none px-4 py-2.5 text-xs font-semibold text-zinc-700 flex items-center justify-between hover:bg-zinc-50 rounded-lg">
              <span>📋 Parametri da incollare nella Shopify Partner App</span>
              <span className="text-xs text-zinc-400 group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="border-t border-zinc-200 p-4 space-y-4 text-xs">
              <p className="text-zinc-600">
                <a href="https://partners.shopify.com" target="_blank" rel="noopener" className="text-zinc-900 underline">partners.shopify.com</a> → la tua App → <strong>Configuration</strong> → <strong>Crea nuova versione</strong>.
              </p>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-zinc-700">URL app</Label>
                <div className="flex gap-2">
                  <Input readOnly value={baseUrl} className="font-mono text-xs" />
                  <Button type="button" variant="outline" size="icon" onClick={() => copy(baseUrl, "URL app copiato")}><Copy className="h-3.5 w-3.5" /></Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-zinc-700">Allowed redirection URL</Label>
                <div className="flex gap-2">
                  <Input readOnly value={`${baseUrl}/api/public/bridge/shopify-oauth/callback`} className="font-mono text-xs" />
                  <Button type="button" variant="outline" size="icon" onClick={() => copy(`${baseUrl}/api/public/bridge/shopify-oauth/callback`, "Redirect URL copiato")}><Copy className="h-3.5 w-3.5" /></Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-zinc-700">Scopes</Label>
                <div className="flex gap-2">
                  <Input readOnly value="read_products,read_orders,write_draft_orders" className="font-mono text-xs" />
                  <Button type="button" variant="outline" size="icon" onClick={() => copy("read_products,read_orders,write_draft_orders", "Scopes copiati")}><Copy className="h-3.5 w-3.5" /></Button>
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <strong>⚠️ DISATTIVA</strong> "Usa flusso di installazione legacy" nella Partner App.
              </div>
            </div>
          </details>
        </div>
      </section>
      )}

      {provider === "shopify" && (
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-900">Webhook Shopify</h2>
        <p className="mt-1 text-xs text-zinc-500">URL e signing secret per ricevere ordini in tempo reale.</p>
        <div className="mt-5 space-y-3">
          <EndpointRow label="URL webhook" url={endpoints.webhook} onCopy={copy} />
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-700">Webhook signing secret (HMAC)</Label>
            <div className="flex gap-2">
              <Input
                type={showSecret ? "text" : "password"}
                value={form.shopify_webhook_secret}
                onChange={(e) => setForm({ ...form, shopify_webhook_secret: e.target.value })}
                placeholder="Incolla il secret generato da Shopify"
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => setShowSecret((v) => !v)}>{showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>
            </div>
          </div>
        </div>
      </section>
      )}

      {provider === "native" && (
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-900">Checkout nativo — Whop iframe</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Il pagamento avviene on-site dentro un <strong>iframe Whop</strong> embeddato nella pagina checkout. L'utente non lascia mai il tuo sito.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-medium text-zinc-700">Whop API key</Label>
            <Input
              type="password"
              value={form.whop_api_key}
              onChange={(e) => setForm({ ...form, whop_api_key: e.target.value })}
              placeholder="whop_live_..."
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-medium text-zinc-700">Whop Company ID <span className="text-zinc-400">(consigliato)</span></Label>
            <Input
              value={form.whop_company_id}
              onChange={(e) => setForm({ ...form, whop_company_id: e.target.value })}
              placeholder="biz_xxxxxxxxxxxx"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-zinc-500">Lo trovi nell'URL del dashboard Whop: <code>whop.com/dashboard/biz_XXXXX</code>. La sync usa questo valore e non chiama più <code>/companies</code>.</p>
          </div>



          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-700">Whop Product ID</Label>
            <Input
              value={form.whop_product_id}
              onChange={(e) => setForm({ ...form, whop_product_id: e.target.value })}
              placeholder="prod_xxxxxxxxxxxx"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-700">Whop Plan ID</Label>
            <Input
              value={form.whop_plan_id}
              onChange={(e) => setWhopPlanIdValue(e.target.value)}
              placeholder="plan_xxxxxxxxxxxx"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-medium text-zinc-700">Whop webhook secret</Label>
            <Input
              type="password"
              value={form.whop_webhook_secret}
              onChange={(e) => setForm({ ...form, whop_webhook_secret: e.target.value })}
              placeholder="whsec_..."
              className="font-mono text-xs"
            />
          </div>
          <div className="md:col-span-2">
            <EndpointRow label="Webhook URL" url={`${baseUrl}/api/public/bridge/shopify-webhook`} onCopy={copy} />
          </div>
        </div>

        {form.whop_plan_id && (
          <div className="mt-6">
            <Label className="text-xs font-medium text-zinc-700">Anteprima iframe</Label>
            <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <iframe
                title="Whop checkout preview"
                src={`https://whop.com/checkout/${form.whop_plan_id}/?embed=true`}
                className="h-[640px] w-full"
                allow="payment *"
              />
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">URL embed: <code>https://whop.com/checkout/{form.whop_plan_id}/?embed=true</code></p>
          </div>
        )}

        <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-700">
          <h3 className="text-sm font-semibold text-zinc-900">Setup iframe Whop — passo per passo</h3>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>Vai su <a href="https://whop.com/dashboard" target="_blank" rel="noopener" className="underline text-zinc-900">whop.com/dashboard</a> → seleziona la company.</li>
            <li><strong>Developer → API Keys → Create API Key</strong>. Abilita i permessi <code>access_pass:create</code>, <code>access_pass:basic:read</code>, <code>plan:create</code> e <code>plan:basic:read</code>. Copia la Company/API key nel campo API key.</li>
            <li><strong>Products</strong> → apri il prodotto → copia il <code>Product ID</code> (prod_...) e il <code>Plan ID</code> (plan_...) del piano da vendere.</li>
            <li><strong>Settings → Checkout → Allowed embed domains</strong>: aggiungi il dominio di questo sito (es. <code>{baseUrl.replace(/^https?:\/\//, "")}</code>) e gli eventuali domini custom del Sito A. Senza questo, l'iframe verrà bloccato.</li>
            <li><strong>Developer → Webhooks → Add Webhook</strong>: incolla l'URL webhook qui sopra. Eventi: <code>payment.succeeded</code>, <code>membership.went_valid</code>, <code>membership.went_invalid</code>. Copia il <code>whsec_...</code> nel campo webhook secret.</li>
            <li>Salva lo store. L'iframe verrà mostrato in <code>/shop/checkout/demo</code> con <code>src=&quot;https://whop.com/checkout/&#123;plan_id&#125;/?embed=true&quot;</code>.</li>
          </ol>
        </div>
      </section>
      )}

      {provider === "whop" && (
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-900">Connessione Whop</h2>
        <p className="mt-1 text-xs text-zinc-500">Credenziali API per generare checkout e ricevere webhook ordini da Whop.</p>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-medium text-zinc-700">Whop API key</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={form.whop_api_key}
                onChange={(e) => setForm({ ...form, whop_api_key: e.target.value })}
                placeholder="whop_live_..."
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => copy(form.whop_api_key, "API key copiata")}><Copy className="h-3.5 w-3.5" /></Button>
            </div>
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-medium text-zinc-700">Whop Company ID <span className="text-zinc-400">(consigliato)</span></Label>
            <Input
              value={form.whop_company_id}
              onChange={(e) => setForm({ ...form, whop_company_id: e.target.value })}
              placeholder="biz_xxxxxxxxxxxx"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-zinc-500">Lo trovi nell'URL del dashboard Whop: <code>whop.com/dashboard/biz_XXXXX</code>. La sync usa questo valore e non chiama più <code>/companies</code>.</p>
          </div>



          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-700">Whop Product ID</Label>
            <Input
              value={form.whop_product_id}
              onChange={(e) => setForm({ ...form, whop_product_id: e.target.value })}
              placeholder="prod_xxxxxxxxxxxx"
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-700">Whop Plan ID (opzionale)</Label>
            <Input
              value={form.whop_plan_id}
              onChange={(e) => setWhopPlanIdValue(e.target.value)}
              placeholder="plan_xxxxxxxxxxxx"
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-medium text-zinc-700">Whop webhook secret</Label>
            <Input
              type="password"
              value={form.whop_webhook_secret}
              onChange={(e) => setForm({ ...form, whop_webhook_secret: e.target.value })}
              placeholder="whsec_..."
              className="font-mono text-xs"
            />
          </div>

          <div className="md:col-span-2">
            <EndpointRow label="Webhook URL" url={`${baseUrl}/api/public/bridge/shopify-webhook`} onCopy={copy} />
            <p className="mt-1 text-[11px] text-zinc-500">Configura questo URL come endpoint webhook in Whop.</p>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-700">
          <h3 className="text-sm font-semibold text-zinc-900">Come creare le API key su Whop</h3>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>Vai su <a href="https://whop.com/dashboard" target="_blank" rel="noopener" className="underline text-zinc-900">whop.com/dashboard</a> e seleziona la tua company.</li>
            <li>Apri <strong>Developer</strong> → <strong>API Keys</strong> nel menu laterale.</li>
            <li>Clicca <strong>Create API Key</strong>, dai un nome (es. "Bridge Lovable") e abilita <code>access_pass:create</code>, <code>access_pass:basic:read</code>, <code>plan:create</code> e <code>plan:basic:read</code>.</li>
            <li>Copia la Company/API key e incollala nel campo <strong>Whop API key</strong> qui sopra. Non incollare il webhook secret <code>whsec_...</code>: quello va nel campo dedicato.</li>
            <li>In <strong>Products</strong>, apri il prodotto da vendere e copia il <code>Product ID</code> (visibile nell'URL o nella sezione details). Incollalo nel campo <strong>Whop Product ID</strong>.</li>
            <li>(Facoltativo) Se il prodotto ha più piani / prezzi, apri il piano e copia il <code>Plan ID</code> nel campo dedicato.</li>
            <li>Vai su <strong>Developer</strong> → <strong>Webhooks</strong> → <strong>Add Webhook</strong>. Incolla l'URL webhook mostrato sopra.</li>
            <li>Seleziona gli eventi: <code>payment.succeeded</code>, <code>membership.went_valid</code>, <code>membership.went_invalid</code>.</li>
            <li>Whop ti darà un <strong>Signing secret</strong> (<code>whsec_...</code>) — copialo nel campo <strong>Whop webhook secret</strong>.</li>
            <li>Salva lo store qui in Lovable e fai un acquisto di test per verificare che il webhook arrivi correttamente.</li>
          </ol>
        </div>
      </section>
      )}



      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-zinc-200 bg-background/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Salvataggio..." : mode === "create" ? "Crea store" : "Salva modifiche"}
        </Button>
        {initial?.last_callback_at && <span className="text-xs text-zinc-500">Ultimo callback: {new Date(initial.last_callback_at).toLocaleString("it-IT")}</span>}
      </div>
    </form>
  );
}

function SuggestionChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-[11px] text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 transition-colors"
    >
      {label}
    </button>
  );
}

function addTagSuggestion<T extends { default_tags: string }>(form: T, setForm: (f: T) => void, tag: string) {
  const current = (form.default_tags || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (current.includes(tag)) return;
  current.push(tag);
  setForm({ ...form, default_tags: current.join(", ") });
}

function EndpointRow({ label, url, onCopy }: { label: string; url: string; onCopy: (s: string, l?: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
      <span className="w-24 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      <code className="flex-1 truncate text-xs text-zinc-700">{url}</code>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-900" onClick={() => onCopy(url, "URL copiato")}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
