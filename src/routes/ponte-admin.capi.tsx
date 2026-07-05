import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  capiGetConfig,
  capiListEvents,
  capiTestMeta,
  capiUpdateConfig,
} from "@/server-fn/capi.functions";

export const Route = createFileRoute("/ponte-admin/capi")({
  component: CapiPage,
});

function CapiPage() {
  const qc = useQueryClient();
  const getCfg = useServerFn(capiGetConfig);
  const updateCfg = useServerFn(capiUpdateConfig);
  const listEvents = useServerFn(capiListEvents);
  const testMeta = useServerFn(capiTestMeta);

  const cfgQ = useQuery({ queryKey: ["capi", "cfg"], queryFn: () => getCfg() });
  const eventsQ = useQuery({
    queryKey: ["capi", "events"],
    queryFn: () => listEvents(),
    refetchInterval: 5000,
  });
  const statusQ = useQuery({
    queryKey: ["capi", "status"],
    queryFn: () => testMeta({ data: undefined as never }),
    refetchInterval: 30000,
  });

  const [form, setForm] = useState({
    shopify_webhook_secret: "",
    meta_pixel_id: "",
    meta_access_token: "",
    target_site_url: "",
    meta_test_event_code: "",
  });

  useEffect(() => {
    if (cfgQ.data) {
      setForm({
        shopify_webhook_secret: cfgQ.data.shopify_webhook_secret ?? "",
        meta_pixel_id: cfgQ.data.meta_pixel_id ?? "",
        meta_access_token: cfgQ.data.meta_access_token ?? "",
        target_site_url: cfgQ.data.target_site_url ?? "",
        meta_test_event_code: cfgQ.data.meta_test_event_code ?? "",
      });
    }
  }, [cfgQ.data]);

  const saveMut = useMutation({
    mutationFn: () => updateCfg({ data: form }),
    onSuccess: () => {
      toast.success("Configurazione salvata");
      qc.invalidateQueries({ queryKey: ["capi"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/public/shopify-webhook`
      : "/api/public/shopify-webhook";

  const connected = statusQ.data?.ok === true;

  const shopifyTopics = [
    { topic: "orders/create", event: "Purchase" },
    { topic: "orders/paid", event: "Purchase (deduplica)" },
    { topic: "orders/fulfilled", event: "Purchase (deduplica)" },
    { topic: "checkouts/create", event: "InitiateCheckout" },
    { topic: "checkouts/update", event: "AddPaymentInfo" },
    { topic: "carts/create", event: "AddToCart" },
    { topic: "carts/update", event: "AddToCart" },
    { topic: "customers/create", event: "CompleteRegistration" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Meta CAPI Relay</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Inoltra eventi Shopify a Meta Conversions API attribuendoli a un dominio target.
          Tutti i dati cliente (email, telefono, nome, cognome, città, CAP, paese, ID cliente,
          data di nascita, genere) vengono hashati SHA-256 e inviati lato server insieme a IP,
          User-Agent, <code>_fbp</code> e <code>_fbc</code>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-base">
            Stato connessione Meta CAPI
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`}
            />
            <span className="text-sm font-normal text-muted-foreground">
              {statusQ.isFetching ? "verifica…" : connected ? "online" : statusQ.data?.error ?? "offline"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Label>Webhook URL (incolla in Shopify per ogni evento)</Label>
          <div className="flex gap-2 mt-1">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(webhookUrl);
                toast.success("URL copiato");
              }}
            >
              Copia
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Come configurare i webhook su Shopify</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ol className="list-decimal list-inside space-y-2">
            <li>
              Apri l'admin Shopify → <strong>Impostazioni</strong> → <strong>Notifiche</strong> →
              scorri fino a <strong>Webhook</strong> (sezione in fondo).
            </li>
            <li>
              Clicca <strong>Crea webhook</strong> e per ognuna delle voci sotto inserisci:
              <ul className="list-disc list-inside ml-4 mt-1 text-muted-foreground">
                <li><strong>Evento</strong>: il topic indicato in tabella</li>
                <li><strong>Formato</strong>: <code>JSON</code></li>
                <li><strong>URL</strong>: l'URL del webhook qui sopra</li>
                <li><strong>Versione API</strong>: <code>2024-10</code> (o più recente)</li>
              </ul>
            </li>
            <li>
              Dopo aver creato il primo webhook, in fondo alla sezione Shopify mostra una stringa
              <em> "I tuoi webhook saranno firmati con..."</em> — copiala e incollala qui sotto in{" "}
              <strong>Shopify Webhook Secret</strong>. È la stessa per tutti i webhook del negozio.
            </li>
            <li>
              Crea un webhook per <strong>ognuno</strong> dei topic elencati di seguito (sono i
              soli che vengono mappati su eventi standard Meta).
            </li>
          </ol>

          <div className="rounded border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-2">Shopify Topic</th>
                  <th className="text-left p-2">Evento Meta</th>
                </tr>
              </thead>
              <tbody>
                {shopifyTopics.map((t) => (
                  <tr key={t.topic} className="border-t border-border">
                    <td className="p-2 font-mono">{t.topic}</td>
                    <td className="p-2">{t.event}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-muted-foreground">
            Suggerimento: per testare l'integrazione, imposta un <strong>Meta Test Event Code</strong>{" "}
            qui sotto e verifica gli eventi in tempo reale su{" "}
            <em>Gestione Eventi Meta → Test eventi</em>. Rimuovi il codice in produzione.
          </p>
        </CardContent>
      </Card>


      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configurazione</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(
            [
              ["shopify_webhook_secret", "Shopify Webhook Secret"],
              ["meta_pixel_id", "Meta Pixel ID"],
              ["meta_access_token", "Meta Access Token"],
              ["target_site_url", "Target Site URL (es. https://mio-sito.com)"],
              ["meta_test_event_code", "Meta Test Event Code (opzionale)"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <Label>{label}</Label>
              <Input
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                type={key.includes("token") || key.includes("secret") ? "password" : "text"}
              />
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <Button disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? "Salvataggio…" : "Salva configurazione"}
            </Button>
            <Button variant="outline" onClick={() => statusQ.refetch()}>
              Test connessione
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ultimi 20 eventi</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs font-mono">
            <div className="grid grid-cols-12 gap-2 text-muted-foreground border-b pb-2 mb-2">
              <div className="col-span-3">Quando</div>
              <div className="col-span-3">Topic</div>
              <div className="col-span-2">Evento Meta</div>
              <div className="col-span-2">Stato</div>
              <div className="col-span-2">HTTP</div>
            </div>
            {eventsQ.data?.length ? (
              eventsQ.data.map((ev) => (
                <div key={ev.id} className="grid grid-cols-12 gap-2 py-1.5 border-b border-border/50">
                  <div className="col-span-3 text-muted-foreground">{new Date(ev.created_at).toLocaleString()}</div>
                  <div className="col-span-3">{ev.topic ?? "—"}</div>
                  <div className="col-span-2">{ev.meta_event_name ?? "—"}</div>
                  <div
                    className={`col-span-2 ${
                      ev.status === "sent"
                        ? "text-emerald-600"
                        : ev.status === "skipped"
                          ? "text-muted-foreground"
                          : "text-red-600"
                    }`}
                  >
                    {ev.status}
                  </div>
                  <div className="col-span-2 text-muted-foreground">{ev.http_status ?? "—"}</div>
                  {ev.error ? (
                    <div className="col-span-12 text-red-600 pl-2 pb-2">{ev.error}</div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="text-muted-foreground py-4">Nessun evento ricevuto.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
