import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { getRuntimeSupabaseClient } from "@/lib/runtime-supabase";
import { siteGetAdminSettings, siteUpdateSettings } from "@/server-fn/site.functions";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Upload, X, Globe, Mail, Building2, Tag, Apple } from "lucide-react";


export const Route = createFileRoute("/ponte-admin/site-settings")({
  component: SiteSettingsPage,
  head: () => ({ meta: [{ title: "Impostazioni sito — Sito Ponte" }, { name: "robots", content: "noindex, nofollow" }] }),
});

interface SiteForm {
  brand_name: string;
  brand_url: string;
  logo_url: string | null;
  logo_dark_url: string | null;
  support_email: string;
  privacy_email: string;
  legal_address: string | null;
  vat_number: string | null;
  apple_pay_verification: string | null;
}

const EMPTY: SiteForm = {
  brand_name: "Atelier Nord",
  brand_url: "ateliernord.eu",
  logo_url: null,
  logo_dark_url: null,
  support_email: "hello@ateliernord.eu",
  privacy_email: "privacy@ateliernord.eu",
  legal_address: null,
  vat_number: null,
  apple_pay_verification: null,
};


function SiteSettingsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<SiteForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"light" | "dark" | null>(null);
  const lightRef = useRef<HTMLInputElement>(null);
  const darkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await siteGetAdminSettings();
        setForm({ ...EMPTY, ...(s ?? {}) });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Errore caricamento");
      } finally {
        setLoading(false);
      }
    })();
  }, []);


  function patch<K extends keyof SiteForm>(k: K, v: SiteForm[K]) {
    setForm((x) => ({ ...x, [k]: v }));
  }

  async function uploadLogo(file: File, kind: "light" | "dark") {
    setUploading(kind);
    try {
      const supabase = await getRuntimeSupabaseClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `site/${kind}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file, {
        cacheControl: "31536000", contentType: file.type, upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      patch(kind === "light" ? "logo_url" : "logo_dark_url", data.publicUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload fallito");
    } finally {
      setUploading(null);
      if (kind === "light" && lightRef.current) lightRef.current.value = "";
      if (kind === "dark" && darkRef.current) darkRef.current.value = "";
    }
  }

  async function save() {
    if (!form.brand_name.trim()) { toast.error("Nome brand obbligatorio"); return; }
    if (!form.brand_url.trim()) { toast.error("Dominio obbligatorio"); return; }
    setSaving(true);
    try {
      await siteUpdateSettings({
        data: {
          brand_name: form.brand_name.trim(),
          brand_url: form.brand_url.trim().toLowerCase(),
          logo_url: form.logo_url || null,
          logo_dark_url: form.logo_dark_url || null,
          support_email: form.support_email.trim(),
          privacy_email: form.privacy_email.trim(),
          legal_address: form.legal_address?.trim() || null,
          vat_number: form.vat_number?.trim() || null,
          apple_pay_verification: form.apple_pay_verification?.trim() || null,
        },
      });
      // Invalida la cache così header/footer/pagine legali si aggiornano ovunque
      await qc.invalidateQueries({ queryKey: ["site", "settings"] });
      toast.success("Impostazioni aggiornate.");

    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Salvataggio fallito");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-zinc-500">Caricamento…</div>;
  }

  return (
    <section className="space-y-6">
      <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 border-b border-zinc-200 bg-background/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Impostazioni sito</h1>
          <p className="hidden text-sm text-zinc-500 sm:block">
            Logo, nome, dominio e contatti. Le modifiche si propagano a header, footer e pagine legali.
          </p>
        </div>
        <Button onClick={save} disabled={saving} className="bg-zinc-900 text-white hover:bg-zinc-800">
          {saving ? "Salvataggio…" : "Salva tutto"}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Colonna principale */}
        <div className="space-y-6">
          <Card title="Identità brand" icon={<Tag className="h-4 w-4" />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome del negozio">
                <Input value={form.brand_name} onChange={(e) => patch("brand_name", e.target.value)} className="bg-white border-zinc-200" />
              </Field>
              <Field label="Dominio principale (senza https://)">
                <Input value={form.brand_url} onChange={(e) => patch("brand_url", e.target.value)} placeholder="ateliernord.eu" className="bg-white border-zinc-200" />
              </Field>
            </div>
            <Field label="Motto / claim (compare nelle meta description)">
              <Textarea
                rows={2}
                value={form.legal_address ?? ""}
                onChange={(e) => patch("legal_address", e.target.value)}
                placeholder="Es. Capi essenziali Made in Europe"
                className="bg-white border-zinc-200"
              />
              <p className="mt-1 text-xs text-zinc-500">Usato come slogan in pagine legali e firma email.</p>
            </Field>
          </Card>

          <Card title="Loghi" icon={<Upload className="h-4 w-4" />}>
            <div className="grid gap-6 md:grid-cols-2">
              <LogoUploader
                label="Logo standard (sfondo chiaro)"
                value={form.logo_url}
                onChange={(v) => patch("logo_url", v)}
                onUpload={(f) => uploadLogo(f, "light")}
                uploading={uploading === "light"}
                inputRef={lightRef}
                bgClass="bg-white"
              />
              <LogoUploader
                label="Logo per sfondo scuro (opzionale)"
                value={form.logo_dark_url}
                onChange={(v) => patch("logo_dark_url", v)}
                onUpload={(f) => uploadLogo(f, "dark")}
                uploading={uploading === "dark"}
                inputRef={darkRef}
                bgClass="bg-zinc-900"
              />
            </div>
          </Card>

          <Card title="Contatti" icon={<Mail className="h-4 w-4" />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email assistenza pubblica">
                <Input type="email" value={form.support_email} onChange={(e) => patch("support_email", e.target.value)} className="bg-white border-zinc-200" />
              </Field>
              <Field label="Email privacy / DPO">
                <Input type="email" value={form.privacy_email} onChange={(e) => patch("privacy_email", e.target.value)} className="bg-white border-zinc-200" />
              </Field>
            </div>
            <Field label="P.IVA / VAT (opzionale)">
              <Input value={form.vat_number ?? ""} onChange={(e) => patch("vat_number", e.target.value)} placeholder="IT00000000000" className="bg-white border-zinc-200" />
            </Field>
          </Card>

          <Card title="Verifica dominio Apple Pay (Whop)" icon={<Apple className="h-4 w-4" />}>
            <p className="text-xs text-zinc-600">
              Per attivare Apple Pay e Google Pay sul checkout Whop devi verificare il dominio.
              Su Whop dashboard → Impostazioni → Checkout → <em>Domini di pagamento</em>, clicca "<em>questo file</em>"
              per scaricare <code className="rounded bg-zinc-100 px-1 text-[11px]">apple-developer-merchantid-domain-association</code>,
              apri il file con un editor di testo, copia <strong>tutto</strong> il contenuto e incollalo qui sotto. Salva, poi torna su Whop e clicca <em>Aggiungi</em>.
            </p>
            <p className="text-xs text-zinc-500">
              Il file viene servito a{" "}
              <code className="rounded bg-zinc-100 px-1 text-[11px]">
                /.well-known/apple-developer-merchantid-domain-association
              </code>
              . Lo stesso contenuto vale per tutti i domini collegati a questo progetto.
            </p>
            <Field label="Contenuto del file apple-developer-merchantid-domain-association">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="file"
                  className="hidden"
                  id="apple-pay-file-input"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const text = (await f.text()).trim();
                      if (!text) { toast.error("File vuoto"); return; }
                      patch("apple_pay_verification", text);
                      toast.success("File caricato. Clicca 'Salva tutto' per applicare.");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Lettura file fallita");
                    } finally {
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById("apple-pay-file-input")?.click()}
                  className="border-zinc-200"
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" /> Carica file
                </Button>
                {form.apple_pay_verification && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => patch("apple_pay_verification", null)}
                    className="text-zinc-500"
                  >
                    <X className="mr-1 h-3.5 w-3.5" /> Svuota
                  </Button>
                )}
              </div>
              <Textarea
                rows={8}
                value={form.apple_pay_verification ?? ""}
                onChange={(e) => patch("apple_pay_verification", e.target.value)}
                placeholder="7B2276657273696F6E223A312C22707370496473223A5B22... oppure carica il file con il pulsante sopra"
                className="bg-white border-zinc-200 font-mono text-xs"
              />
            </Field>
            {form.apple_pay_verification ? (
              <a
                href="/.well-known/apple-developer-merchantid-domain-association"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
              >
                ✓ Verifica file pubblicato
              </a>
            ) : (
              <p className="text-xs text-amber-700">⚠ Nessun contenuto: Whop non riuscirà a verificare il dominio.</p>
            )}
          </Card>
        </div>


        {/* Anteprima live */}
        <aside className="space-y-6">
          <div className="rounded-lg border border-zinc-200 bg-white p-5">
            <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-700">
              <Building2 className="h-4 w-4" /> Anteprima negozio
            </h3>
            <div className="mt-4 overflow-hidden rounded-md border border-zinc-200">
              {/* Header preview */}
              <div className="flex items-center justify-between bg-white px-4 py-3 border-b border-zinc-100">
                {form.logo_url ? (
                  <img src={form.logo_url} alt="" className="h-7 w-auto" />
                ) : (
                  <div className="font-display text-sm font-medium tracking-[0.18em] text-zinc-900">
                    {form.brand_name.toUpperCase()}
                  </div>
                )}
                <div className="text-[10px] uppercase tracking-widest text-zinc-400">Shop</div>
              </div>
              {/* Body preview */}
              <div className="bg-zinc-50 px-4 py-6">
                <p className="text-[11px] uppercase tracking-widest text-zinc-400">Anteprima</p>
                <h4 className="mt-1 text-lg font-medium text-zinc-900">{form.brand_name}</h4>
                <p className="mt-1 text-xs text-zinc-500 inline-flex items-center gap-1">
                  <Globe className="h-3 w-3" /> {form.brand_url || "—"}
                </p>
                {form.legal_address && (
                  <p className="mt-3 text-xs text-zinc-600 italic">"{form.legal_address}"</p>
                )}
              </div>
              {/* Dark preview */}
              {form.logo_dark_url && (
                <div className="bg-zinc-900 px-4 py-3 flex items-center justify-between border-t border-zinc-100">
                  <img src={form.logo_dark_url} alt="" className="h-7 w-auto" />
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500">Dark</div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
            <strong>Attenzione:</strong> alla prima visita gli utenti potrebbero vedere ancora la versione in cache.
            Le pagine si aggiornano automaticamente al refresh successivo.
          </div>
        </aside>
      </div>
    </section>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-700">{icon} {title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-zinc-500 font-medium">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function LogoUploader({
  label, value, onChange, onUpload, uploading, inputRef, bgClass,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  onUpload: (f: File) => void;
  uploading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  bgClass: string;
}) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-zinc-500 font-medium">{label}</Label>
      <div className={`mt-2 grid h-32 place-items-center rounded-md border border-zinc-200 ${bgClass} relative`}>
        {value ? (
          <>
            <img src={value} alt="" className="max-h-20 max-w-[80%] object-contain" />
            <button type="button" onClick={() => onChange(null)} className="absolute right-1 top-1 rounded bg-white/90 p-1 text-zinc-700 hover:bg-white">
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <div className={`text-xs ${bgClass.includes("zinc-900") ? "text-zinc-400" : "text-zinc-400"}`}>Nessun logo</div>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0]; if (f) onUpload(f);
        }} />
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading} className="border-zinc-200 flex-1">
          <Upload className="mr-1.5 h-3.5 w-3.5" /> {uploading ? "Caricamento…" : "Carica"}
        </Button>
      </div>
      <Input
        placeholder="…o incolla URL"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-2 bg-white border-zinc-200 text-xs"
      />
    </div>
  );
}
