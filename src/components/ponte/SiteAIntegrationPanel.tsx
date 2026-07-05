import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Check, ChevronDown, ChevronRight, Copy, Eye, EyeOff, Link2, RefreshCw, Save, ScrollText, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { ponteGenerateApiKey, ponteUpdateSiteAIntegration } from "@/server-fn/ponte.functions";

interface Props {
  store: {
    id: string;                       // UUID dello store su Sito B (== store_id usato dal Sito A)
    site_a_store_id?: string | null;  // UUID dello store su Sito A (se diverso)
    shop_domain: string;
    display_name?: string | null;
    bridge_api_key?: string | null;
    callback_url?: string | null;
  };
}

/**
 * Pannello "Integrazione Sito A".
 *
 * Mostra TUTTE le credenziali e gli endpoint che il Sito A (cart-pivot-pulse / shadow-checkout)
 * deve configurare per usare questo Sito B come ponte verso Shopify e usare il checkout
 * NATIVO Shopify generato qui.
 *
 * Non chiama nessuna API: si limita a presentare in chiaro i dati già presenti su `store`,
 * con copy-to-clipboard e un blocco di env/JSON pronto da incollare nel Sito A.
 */
export default function SiteAIntegrationPanel({ store }: Props) {
  const qc = useQueryClient();
  const [showKey, setShowKey] = useState(false);
  const [openCurl, setOpenCurl] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const [siteAStoreId, setSiteAStoreId] = useState(store.site_a_store_id ?? "");
  const [apiKeyDraft, setApiKeyDraft] = useState(store.bridge_api_key ?? "");

  useEffect(() => { setSiteAStoreId(store.site_a_store_id ?? ""); }, [store.site_a_store_id]);
  useEffect(() => { setApiKeyDraft(store.bridge_api_key ?? ""); }, [store.bridge_api_key]);

  const bridgeBaseUrl = useMemo(() => {
    if (typeof window === "undefined") return "https://shop-path-secure.lovable.app";
    return `${window.location.protocol}//${window.location.host}`;
  }, []);

  const storeId = store.id;
  const apiKey = apiKeyDraft;
  const callbackUrl = store.callback_url ?? "";

  const siteAIdDirty = siteAStoreId !== (store.site_a_store_id ?? "");
  const apiKeyDirty = apiKeyDraft !== (store.bridge_api_key ?? "");

  const save = useMutation({
    mutationFn: (payload: { site_a_store_id?: string; bridge_api_key?: string }) =>
      ponteUpdateSiteAIntegration({ data: { id: store.id, ...payload } }),
    onSuccess: () => { toast.success("Salvato"); qc.invalidateQueries({ queryKey: ["ponte"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Errore"),
  });

  const genKey = useMutation({
    mutationFn: () => ponteGenerateApiKey(),
    onSuccess: (r) => { setApiKeyDraft(r.key); setShowKey(true); toast.success("Nuova chiave generata — clicca Salva"); },
  });

  const endpoints = useMemo(() => ({
    handshake: `${bridgeBaseUrl}/api/public/bridge/handshake`,
    getConfig: `${bridgeBaseUrl}/api/public/bridge/get-config`,
    updateConfig: `${bridgeBaseUrl}/api/public/bridge/update-config`,
    sync: `${bridgeBaseUrl}/api/public/bridge/sync`,
    checkout: `${bridgeBaseUrl}/api/public/bridge/checkout`,
    generateCheckout: `${bridgeBaseUrl}/api/public/bridge/generate-checkout`,
  }), [bridgeBaseUrl]);

  const envBlock = useMemo(() => [
    `# === Sito B (Sito Ponte) — credenziali per "${store.display_name || store.shop_domain}" ===`,
    `BRIDGE_SITE_URL=${bridgeBaseUrl}`,
    `BRIDGE_STORE_ID=${storeId}`,
    `BRIDGE_API_KEY=${apiKey || "<genera-la-bridge_api_key-dallo-store-form>"}`,
    `BRIDGE_SHOP_DOMAIN=${store.shop_domain}`,
    `BRIDGE_CALLBACK_URL=${callbackUrl || "<URL della tua edge function bridge-callback su Sito A>"}`,
  ].join("\n"), [bridgeBaseUrl, storeId, apiKey, store.shop_domain, store.display_name, callbackUrl]);

  const dbRow = useMemo(() => JSON.stringify({
    site_b_store_id: storeId,
    shop_domain: store.shop_domain,
    display_name: store.display_name ?? null,
    bridge_site_url: bridgeBaseUrl,
    bridge_api_key: apiKey || "<incolla qui dopo averla generata>",
    callback_url: callbackUrl || null,
    endpoints,
  }, null, 2), [storeId, store, bridgeBaseUrl, apiKey, callbackUrl, endpoints]);

  const curlHandshake = useMemo(() => `curl -X POST '${endpoints.handshake}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Bridge-Api-Key: ${apiKey || "<bridge_api_key>"}' \\
  -d '{"store_id":"${storeId}"}'`, [endpoints.handshake, apiKey, storeId]);

  const curlCheckout = useMemo(() => `curl -X POST '${endpoints.checkout}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Bridge-Api-Key: ${apiKey || "<bridge_api_key>"}' \\
  -d '{
    "store_id":"${storeId}",
    "shop_domain":"${store.shop_domain}",
    "currency":"EUR",
    "items":[
      {"product_slug":"prd-04318","display_title":"PRD-04318","display_sku":"PRD-04318","price":49.90,"variant_label":"EU 39","quantity":1}
    ]
  }'`, [endpoints.checkout, apiKey, storeId, store.shop_domain]);

  async function copyText(value: string, label: string) {
    if (!value) { toast.error("Valore vuoto"); return; }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
      toast.success(`${label} copiato`);
    } catch {
      toast.error("Impossibile copiare");
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> Integrazione Sito A
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Credenziali ed endpoint che il Sito A (storefront) deve configurare per usare
            questo Sito Ponte e il checkout nativo Shopify.
          </p>
        </div>
        <a
          href="https://github.com/lovable-dev"
          onClick={(e) => e.preventDefault()}
          className="hidden md:inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] text-zinc-600 ring-1 ring-zinc-200"
          title="Architettura"
        >
          <Link2 className="h-3 w-3" /> Sito A → Sito B → Shopify
        </a>
      </header>

      {!apiKey && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          ⚠ Nessuna <code>bridge_api_key</code> presente. Generala dal form sottostante
          ("Genera nuova chiave") prima di configurare il Sito A.
        </div>
      )}

      {/* CREDENZIALI — riga per riga */}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <CredField label="BRIDGE_SITE_URL" value={bridgeBaseUrl} onCopy={() => copyText(bridgeBaseUrl, "BRIDGE_SITE_URL")} copied={copied === "BRIDGE_SITE_URL"} />
        <CredField label="BRIDGE_STORE_ID (Sito B)" value={storeId} mono onCopy={() => copyText(storeId, "BRIDGE_STORE_ID")} copied={copied === "BRIDGE_STORE_ID"} />
        <CredField label="BRIDGE_SHOP_DOMAIN" value={store.shop_domain} onCopy={() => copyText(store.shop_domain, "BRIDGE_SHOP_DOMAIN")} copied={copied === "BRIDGE_SHOP_DOMAIN"} />
        <CredField
          label="BRIDGE_CALLBACK_URL"
          value={callbackUrl}
          placeholder="(opzionale) URL edge function bridge-callback Sito A"
          onCopy={() => copyText(callbackUrl, "BRIDGE_CALLBACK_URL")}
          copied={copied === "BRIDGE_CALLBACK_URL"}
        />

        <div className="md:col-span-2">
          <Label className="text-xs font-medium text-zinc-700">site_a_store_id (UUID)</Label>
          <div className="mt-1.5 flex gap-2">
            <Input
              value={siteAStoreId}
              onChange={(e) => setSiteAStoreId(e.target.value)}
              placeholder="UUID dello store sul Sito A"
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" size="icon" onClick={() => copyText(siteAStoreId, "site_a_store_id")} disabled={!siteAStoreId} title="Copia">
              {copied === "site_a_store_id" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!siteAIdDirty || save.isPending}
              onClick={() => save.mutate({ site_a_store_id: siteAStoreId })}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" /> Salva
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">UUID identificativo dello store così come registrato sul Sito A.</p>
        </div>

        <div className="md:col-span-2">
          <Label className="text-xs font-medium text-zinc-700">BRIDGE_API_KEY <span className="text-zinc-400">(segreta)</span></Label>
          <div className="mt-1.5 flex gap-2">
            <Input
              type={showKey ? "text" : "password"}
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder="Incolla una chiave esistente o generane una nuova"
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" size="icon" onClick={() => setShowKey((v) => !v)} title={showKey ? "Nascondi" : "Mostra"}>
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button type="button" variant="outline" size="icon" onClick={() => copyText(apiKeyDraft, "BRIDGE_API_KEY")} disabled={!apiKeyDraft} title="Copia">
              {copied === "BRIDGE_API_KEY" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => genKey.mutate()} disabled={genKey.isPending} title="Genera nuova">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Genera
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!apiKeyDirty || save.isPending || apiKeyDraft.length < 16}
              onClick={() => save.mutate({ bridge_api_key: apiKeyDraft })}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" /> Salva
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            Inviare in tutte le chiamate da Sito A → Sito B come header <code>X-Bridge-Api-Key</code>. Min. 16 caratteri.
          </p>
        </div>
      </div>

      {/* ENDPOINTS */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-zinc-900">Endpoint esposti</h3>
        <p className="mt-0.5 text-xs text-zinc-500">Tutti accettano <code>POST</code> con header <code>X-Bridge-Api-Key</code>.</p>
        <div className="mt-3 grid gap-2">
          {Object.entries(endpoints).map(([k, url]) => (
            <CredField key={k} label={k} value={url} mono onCopy={() => copyText(url, k)} copied={copied === k} />
          ))}
        </div>
      </div>

      {/* BLOCCO ENV PRONTO */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-900">.env per il Sito A</h3>
          <Button type="button" variant="outline" size="sm" onClick={() => copyText(envBlock, ".env")}>
            {copied === ".env" ? <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            Copia .env
          </Button>
        </div>
        <Textarea readOnly value={envBlock} className="mt-2 min-h-[140px] font-mono text-[11px]" />
      </div>

      {/* BLOCCO JSON PER DB SITO A */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-900">Riga JSON per il DB del Sito A</h3>
          <Button type="button" variant="outline" size="sm" onClick={() => copyText(dbRow, "row JSON")}>
            {copied === "row JSON" ? <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            Copia JSON
          </Button>
        </div>
        <Textarea readOnly value={dbRow} className="mt-2 min-h-[180px] font-mono text-[11px]" />
        <p className="mt-1 text-[11px] text-zinc-500">
          Inseriscila nella tabella <code>stores</code> (o equivalente) del Sito A. Il Sito A
          userà <code>bridge_site_url</code> + <code>bridge_api_key</code> per chiamare gli endpoint qui sopra
          dal client <code>shadow-checkout</code> e dalla edge function <code>bridge-checkout</code>.
        </p>
      </div>

      {/* TEST CURL */}
      <Collapsible open={openCurl} onOpenChange={setOpenCurl} className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50">
        <CollapsibleTrigger className="flex w-full items-center justify-between p-4 text-left">
          <span className="flex items-center gap-2 text-sm font-medium text-zinc-800">
            {openCurl ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <ScrollText className="h-4 w-4" /> Test rapidi con curl
          </span>
          <span className="text-[11px] text-zinc-500">handshake · checkout</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 p-4 pt-0">
          <CodeBlock title="Handshake" value={curlHandshake} onCopy={() => copyText(curlHandshake, "curl handshake")} copied={copied === "curl handshake"} />
          <CodeBlock title="Checkout (genera invoice URL Shopify)" value={curlCheckout} onCopy={() => copyText(curlCheckout, "curl checkout")} copied={copied === "curl checkout"} />
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

function CredField({
  label, value, mono, placeholder, onCopy, copied,
}: { label: string; value: string; mono?: boolean; placeholder?: string; onCopy: () => void; copied: boolean }) {
  return (
    <div>
      <Label className="text-xs font-medium text-zinc-700">{label}</Label>
      <div className="mt-1.5 flex gap-2">
        <Input readOnly value={value} placeholder={placeholder} className={mono ? "font-mono text-xs" : "text-xs"} />
        <Button type="button" variant="outline" size="icon" onClick={onCopy} disabled={!value} title="Copia">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function CodeBlock({ title, value, onCopy, copied }: { title: string; value: string; onCopy: () => void; copied: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-700">{title}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onCopy}>
          {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
          Copia
        </Button>
      </div>
      <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-zinc-900 p-3 text-[11px] leading-relaxed text-zinc-100">{value}</pre>
    </div>
  );
}
