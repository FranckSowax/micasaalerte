"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Home, Loader2, CheckCircle2, MessageCircle } from "lucide-react";
import { CriteriaFields, criteriaPayload, EMPTY_CRITERIA, type CriteriaValue } from "@/components/criteria-form";
import { planOffer, SUBSCRIPTION_PLANS, TRIAL_HOURS } from "@/lib/subscription";

type Reply = { error?: string; code?: string; message?: string; spacePath?: string | null };

/**
 * Inscription d'un nouvel abonné, en deux étapes : ses critères, puis le code reçu sur WhatsApp
 * qui prouve que le numéro est le sien. Utilisé par /signup et par le lien d'un agent (/demande/…).
 *
 * @example <SubscriberSignup userId={ownerId} />
 */
export function SubscriberSignup({ userId }: { userId: string }) {
  const [step, setStep] = useState<"form" | "code" | "done">("form");
  const [spacePath, setSpacePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [exists, setExists] = useState(false);
  const [identity, setIdentity] = useState({ client_name: "", client_phone: "" });
  const [code, setCode] = useState("");
  const [criteria, setCriteria] = useState<CriteriaValue>(EMPTY_CRITERIA);

  const offers = SUBSCRIPTION_PLANS.map(planOffer).join(" · ");
  const phone = identity.client_phone.replace(/\s/g, "");

  const post = async (path: string, body: unknown) => {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Reply;
    return { ok: res.ok, data };
  };

  const fail = (data: Reply, fallback: string) => {
    setExists(data.code === "exists");
    setError(data.error || fallback);
  };

  // Étape 1 : les critères sont gardés à l'écran, un code part sur le WhatsApp indiqué.
  const requestCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(""); setInfo(""); setExists(false);
    if (!phone.match(/^\+?\d{8,15}$/)) {
      setError("Numéro WhatsApp invalide. Format : +24177123456");
      return;
    }
    setLoading(true);
    try {
      const { ok, data } = await post("/api/auth/otp/request", { phone, signup: true });
      if (ok) {
        setStep("code");
        setCode("");
        setInfo(data.message || "Code envoyé sur WhatsApp.");
        window.scrollTo({ top: 0 });
      } else {
        fail(data, "Envoi du code impossible");
      }
    } catch {
      setError("Connexion impossible. Réessayez.");
    }
    setLoading(false);
  };

  // Étape 2 : le code valide le numéro, l'inscription est enregistrée.
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setInfo(""); setExists(false); setLoading(true);
    try {
      const { ok, data } = await post("/api/demands/public", {
        userId,
        client_name: identity.client_name,
        client_phone: phone,
        code,
        ...criteriaPayload(criteria),
      });
      if (ok) {
        setSpacePath(data.spacePath || null);
        setStep("done");
      } else {
        fail(data, "Inscription impossible");
      }
    } catch {
      setError("Connexion impossible. Réessayez.");
    }
    setLoading(false);
  };

  const alerts = (
    <>
      {error && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm" role="alert">
          {error}
          {exists && (
            <Link href="/login" className="block mt-2 font-medium underline">Me connecter</Link>
          )}
        </div>
      )}
      {info && <div className="p-3 rounded-md bg-primary/10 text-primary text-sm" role="status">{info}</div>}
    </>
  );

  if (step === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="p-8 space-y-4">
            <CheckCircle2 className="h-16 w-16 text-primary mx-auto" />
            <h2 className="text-2xl font-bold">Inscription réussie !</h2>
            <p className="text-muted-foreground">
              Vous recevrez les annonces correspondantes sur WhatsApp au numéro {identity.client_phone}.
            </p>
            <p className="text-sm">Votre essai gratuit de {TRIAL_HOURS} h commence maintenant. Ensuite : {offers}.</p>
            {spacePath ? (
              <a href={spacePath} className="inline-flex items-center justify-center h-11 px-5 rounded-md bg-primary text-primary-foreground font-medium w-full">
                Ouvrir mon espace
              </a>
            ) : (
              <Link href="/login" className="inline-flex items-center justify-center h-11 px-5 rounded-md bg-primary text-primary-foreground font-medium w-full">
                Me connecter à mon espace
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "code") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Confirmez votre numéro</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={confirm} className="space-y-4">
              {alerts}
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
                <p className="text-xs text-muted-foreground">Envoyé au {identity.client_phone}. Valable 5 minutes.</p>
              </div>
              <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Terminer mon inscription
              </Button>
              <div className="flex justify-between text-sm">
                <button type="button" className="text-primary hover:underline" onClick={() => { setStep("form"); setError(""); setInfo(""); }}>
                  Modifier ma demande
                </button>
                <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={loading} onClick={() => requestCode()}>
                  Renvoyer le code
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Home className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold text-primary">Mi Casa Alerte</span>
          </div>
          <h1 className="text-xl font-bold">Trouvez votre bien idéal</h1>
          <p className="text-muted-foreground mt-1">Remplissez vos critères et recevez les annonces sur WhatsApp</p>
          <p className="text-sm text-primary mt-2">
            {TRIAL_HOURS} h d&apos;essai gratuit, puis {offers}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Déjà inscrit ? <Link href="/login" className="text-primary hover:underline">Me connecter</Link>
          </p>
        </div>

        <form onSubmit={requestCode} className="space-y-6">
          {alerts}

          <Card>
            <CardHeader><CardTitle className="text-lg">Vos informations</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-sm font-medium" htmlFor="signup-name">Nom *</label>
                <Input id="signup-name" autoComplete="name" placeholder="Votre nom" value={identity.client_name} onChange={(e) => setIdentity({ ...identity, client_name: e.target.value })} minLength={2} maxLength={80} required />
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="signup-phone">Numéro WhatsApp *</label>
                <Input id="signup-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+24177123456" value={identity.client_phone} onChange={(e) => setIdentity({ ...identity, client_phone: e.target.value })} required />
                <p className="text-xs text-muted-foreground mt-1">Avec l&apos;indicatif du pays. Un code de confirmation y sera envoyé.</p>
              </div>
            </CardContent>
          </Card>

          <CriteriaFields value={criteria} onChange={setCriteria} />

          <Button type="submit" className="w-full text-lg h-12" disabled={loading}>
            {loading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <MessageCircle className="h-5 w-5 mr-2" />}
            Recevoir mon code WhatsApp
          </Button>
        </form>
      </div>
    </div>
  );
}
