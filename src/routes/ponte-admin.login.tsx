import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { getRuntimeSupabaseClient } from "@/lib/runtime-supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/ponte-admin/login")({ component: PonteLogin });

// Accesso a sola password: l'email è fissa e nascosta.
const FIXED_EMAIL = "admin@ponte.local";

function PonteLogin() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = await getRuntimeSupabaseClient();
    await supabase.auth.signOut();
    const { error } = await supabase.auth.signInWithPassword({ email: FIXED_EMAIL, password });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Login OK");
    navigate({ to: "/ponte-admin" });
  }

  return (
    <div className="grid min-h-screen place-items-center bg-zinc-50 p-6 text-zinc-900">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-2xl border border-zinc-200 bg-white p-7 shadow-xl">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-zinc-900 font-mono text-xl font-bold text-white">P</span>
          <div>
            <h1 className="text-xl font-semibold">Sito Ponte</h1>
            <p className="text-xs text-zinc-500">Accesso amministratore</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-zinc-700">Password</Label>
          <Input type="password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" className="w-full bg-zinc-900 text-white hover:bg-zinc-800" disabled={busy}>
          {busy ? "Accesso..." : "Entra"}
        </Button>
        <Link to="/" className="block text-center text-xs text-zinc-500 hover:text-zinc-900">← Sito pubblico</Link>
      </form>
    </div>
  );
}
