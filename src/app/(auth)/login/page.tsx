"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Home, Loader2, MessageCircle } from "lucide-react";

/** Connexion par code WhatsApp : l'abonné arrive dans son espace, l'agent dans l'administration (email en secours). */
export default function LoginPage() {
  const [mode, setMode] = useState<"whatsapp" | "email">("whatsapp");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const enter = (to = "/dashboard") => {
    // Espace client : chargement complet de la page, pour que l'appareil y soit lié.
    if (to.startsWith("/c/")) {
      window.location.assign(to);
      return;
    }
    router.push(to);
    router.refresh();
  };

  const post = async (path: string, body: Record<string, string>) => {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data: data as { error?: string; message?: string; redirect?: string } };
  };

  const requestCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoading(true); setError(""); setInfo("");
    try {
      const { ok, data } = await post("/api/auth/otp/request", { phone });
      if (ok) {
        setStep("code");
        setCode("");
        setInfo(data.message || "Code envoyé sur WhatsApp.");
      } else {
        setError(data.error || "Envoi impossible");
      }
    } catch {
      setError("Connexion impossible. Réessayez.");
    }
    setLoading(false);
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(""); setInfo("");
    try {
      const { ok, data } = await post("/api/auth/otp/verify", { code });
      if (ok) return enter(data.redirect);
      setError(data.error || "Code incorrect.");
    } catch {
      setError("Connexion impossible. Réessayez.");
    }
    setLoading(false);
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(""); setInfo("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      enter();
    }
  };

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/api/auth/callback` },
    });
  };

  const switchMode = (next: "whatsapp" | "email") => {
    setMode(next); setStep("phone"); setError(""); setInfo("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link href="/" className="flex items-center justify-center gap-2 mb-4">
            <Home className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold text-primary">Mi Casa Alerte</span>
          </Link>
          <CardTitle className="text-xl">Connexion</CardTitle>
          <CardDescription>
            {mode === "whatsapp" ? "Recevez un code de connexion sur votre WhatsApp" : "Accès agent : email et mot de passe"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && <div className="p-3 mb-4 rounded-md bg-destructive/10 text-destructive text-sm" role="alert">{error}</div>}
          {info && <div className="p-3 mb-4 rounded-md bg-primary/10 text-primary text-sm" role="status">{info}</div>}

          {mode === "whatsapp" && step === "phone" && (
            <form onSubmit={requestCode} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="login-phone">Numéro WhatsApp</label>
                <Input
                  id="login-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+24177000000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">Le numéro utilisé à votre inscription, avec l&apos;indicatif du pays.</p>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageCircle className="h-4 w-4 mr-2" />}
                Recevoir le code
              </Button>
            </form>
          )}

          {mode === "whatsapp" && step === "code" && (
            <form onSubmit={verifyCode} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="login-code">Code reçu sur WhatsApp</label>
                <Input
                  id="login-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="6 chiffres"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="text-center text-lg tracking-[0.4em]"
                  autoFocus
                  required
                />
                <p className="text-xs text-muted-foreground">Envoyé au {phone}. Valable 5 minutes.</p>
              </div>
              <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Se connecter
              </Button>
              <div className="flex justify-between text-sm">
                <button type="button" className="text-primary hover:underline" onClick={() => { setStep("phone"); setError(""); setInfo(""); }}>
                  Changer de numéro
                </button>
                <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={loading} onClick={() => requestCode()}>
                  Renvoyer le code
                </button>
              </div>
            </form>
          )}

          {mode === "email" && (
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="login-email">Email</label>
                <Input id="login-email" type="email" autoComplete="email" placeholder="votre@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="login-password">Mot de passe</label>
                <Input id="login-password" type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Connexion..." : "Se connecter"}
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={handleGoogleLogin}>
                Continuer avec Google
              </Button>
            </form>
          )}

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">ou</span>
            </div>
          </div>

          <Button variant="outline" className="w-full" onClick={() => switchMode(mode === "whatsapp" ? "email" : "whatsapp")}>
            {mode === "whatsapp" ? "Accès agent par email" : "Se connecter par WhatsApp"}
          </Button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Pas encore de compte ?{" "}
            <Link href="/signup" className="text-primary hover:underline">
              S&apos;inscrire
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
