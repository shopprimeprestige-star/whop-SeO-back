import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";

const KEY = "atelier-nord-cookie";

export function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(KEY)) setShow(true);
  }, []);

  if (!show) return null;

  const decide = (choice: "all" | "necessary") => {
    localStorage.setItem(KEY, JSON.stringify({ choice, ts: Date.now() }));
    setShow(false);
  };

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-3xl rounded border border-border bg-background p-5 shadow-elegant md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Cookie & Privacy</p>
          <p className="mt-2 text-sm text-foreground">
            Usiamo cookie tecnici necessari al funzionamento del sito e, con il tuo consenso, cookie di analisi
            aggregata per migliorare la tua esperienza. Nessun dato viene condiviso con terze parti per profilazione
            pubblicitaria. Maggiori informazioni nella nostra <Link to="/cookie" className="underline">Cookie Policy</Link> e <Link to="/privacy" className="underline">Privacy Policy</Link>.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => decide("all")}
              className="bg-foreground px-5 py-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-background hover:bg-foreground/90"
            >
              Accetta tutti
            </button>
            <button
              onClick={() => decide("necessary")}
              className="border border-border px-5 py-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-foreground hover:bg-secondary"
            >
              Solo necessari
            </button>
          </div>
        </div>
        <button onClick={() => decide("necessary")} aria-label="Chiudi" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
