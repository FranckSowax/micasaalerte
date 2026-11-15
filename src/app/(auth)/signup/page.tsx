"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Home, Loader2, MessageCircle } from "lucide-react";

/** Inscription d'un agent : nom et numéro WhatsApp, validés par un code. L'email reste en secours. */
export default function SignupPage() {
  const [mode, setMode] = useState<"whatsapp" | "email">("whatsapp");
  const [step, setStep] = useState<"form" | "code">("form");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const post = async (path: string, body: Record<string, string>) => {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data: data as { error?: string; message?: string } };
  };

  const requestCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoading(true); setError(""); setInfo("");
    try {
      const { ok, data } = await post("/api/auth/otp/request", { phone, name: fullName });
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
      if (ok) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      setError(data.error || "Code incorrect.");
    } catch {
      setError("Connexion impossible. Réessayez.");
    }
    setLoading(false);
  };

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(""); setInfo("");
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
    if (error) setError(error.message);
    else setEmailSent(true);
    setLoading(false);
  };

  if (emailSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-xl text-primary">Vérifiez votre email</CardTitle>
            <CardDescription>
              Un lien de confirmation a été envoyé à <strong>{email}</strong>.
              Cliquez sur le lien pour activer votre compte.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/login">
              <Button variant="outline" className="w-full">Retour à la connexion</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link href="/" className="flex items-center justify-center gap-2 mb-4">
            <Home className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold text-primary">Mi Casa Alerte</span>
          </Link>
          <CardTitle className="text-xl">Créer un compte</CardTitle>
          <CardDescription>
            {mode === "whatsapp" ? "Inscrivez-vous avec votre numéro WhatsApp, sans mot de passe" : "Inscrivez-vous avec votre email et un mot de passe"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && <div className="p-3 mb-4 rounded-md bg-destructive/10 text-destructive text-sm" role="alert">{error}</div>}
          {info && <div className="p-3 mb-4 rounded-md bg-primary/10 text-primary text-sm" role="status">{info}</div>}

          {mode === "whatsapp" && step === "form" && (
            <form onSubmit={requestCode} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="signup-name">Nom complet</label>
                <Input id="signup-name" type="text" autoComplete="name" placeholder="Jean Dupont" value={fullName} onChange={(e) => setFullName(e.target.value)} minLength={2} maxLength={80} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="signup-phone">Numéro WhatsApp</label>
                <Input id="signup-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+24177000000" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                <p className="text-xs text-muted-foreground">Avec l&apos;indicatif du pays. Vous y recevrez un code de confirmation.</p>
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
                <label className="text-sm font-medium" htmlFor="signup-code">Code reçu sur WhatsApp</label>
                <Input
                  id="signup-code"
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
                Créer mon compte
              </Button>
              <div className="flex justify-between text-sm">
                <button type="button" className="text-primary hover:underline" onClick={() => { setStep("form"); setError(""); setInfo(""); }}>
                  Changer de numéro
                </button>
                <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={loading} onClick={() => requestCode()}>
                  Renvoyer le code
                </button>
              </div>
            </form>
          )}

          {mode === "email" && (
            <form onSubmit={handleEmailSignup} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="signup-name-email">Nom complet</label>
                <Input id="signup-name-email" type="text" autoComplete="name" placeholder="Jean Dupont" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="signup-email">Email</label>
                <Input id="signup-email" type="email" autoComplete="email" placeholder="votre@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="signup-password">Mot de passe</label>
                <Input id="signup-password" type="password" autoComplete="new-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Inscription..." : "S'inscrire"}
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

          <Button
            variant="outline"
            className="w-full"
            onClick={() => { setMode(mode === "whatsapp" ? "email" : "whatsapp"); setStep("form"); setError(""); setInfo(""); }}
          >
            {mode === "whatsapp" ? "S'inscrire par email" : "S'inscrire par WhatsApp"}
          </Button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Déjà un compte ?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Se connecter
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
