"use client";

import { useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Création d'un compte agent (administration) par email. Les abonnés s'inscrivent ailleurs, sans compte. */
export function AgentSignupForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
    if (error) setError(error.message);
    else setSent(true);
    setLoading(false);
  };

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/api/auth/callback` },
    });
  };

  if (sent) {
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
            <BrandLogo variant="green" className="h-14 w-auto" priority />
          </Link>
          <CardTitle className="text-xl">Compte agent</CardTitle>
          <CardDescription>Réservé aux agents qui gèrent les annonces et les abonnés</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="space-y-4">
            {error && <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm" role="alert">{error}</div>}
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="agent-name">Nom complet</label>
              <Input id="agent-name" type="text" autoComplete="name" placeholder="Jean Dupont" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="agent-email">Email</label>
              <Input id="agent-email" type="email" autoComplete="email" placeholder="votre@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="agent-password">Mot de passe</label>
              <Input id="agent-password" type="password" autoComplete="new-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Inscription..." : "Créer le compte agent"}
            </Button>
            <Button type="button" variant="outline" className="w-full" onClick={handleGoogleLogin}>
              Continuer avec Google
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Vous cherchez un logement ?{" "}
            <Link href="/signup" className="text-primary hover:underline">
              Inscription abonné
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
