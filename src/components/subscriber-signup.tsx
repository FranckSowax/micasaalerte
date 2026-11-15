"use client";

import { useEffect, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { Nunito_Sans } from "next/font/google";
import { ArrowLeft, CheckCircle2, Loader2, MessageCircle } from "lucide-react";
import { criteriaError, CriteriaFields, criteriaPayload, criteriaSummary, EMPTY_CRITERIA, type CriteriaValue } from "@/components/criteria-form";
import { planOffer, SUBSCRIPTION_PLANS, TRIAL_HOURS } from "@/lib/subscription";

// Inscription d'un nouvel abonné : trois étapes courtes (recherche, budget et lieu, alerte WhatsApp),
// puis le code reçu sur WhatsApp qui prouve que le numéro est le sien.
// Utilisé par /signup (compte principal) et par le lien d'un agent (/demande/[userId]).

const font = Nunito_Sans({ subsets: ["latin"], display: "swap", adjustFontFallback: false });

type Step = 1 | 2 | 3 | "code" | "done";
type Reply = { error?: string; code?: string; message?: string; spacePath?: string | null; firstSelection?: number };

const DEFAULT_PHONE = "+241";
const STEP_TITLES = ["Votre recherche", "Budget et emplacement", "Votre alerte WhatsApp"];
const FIELD = "h-14 w-full rounded-xl border-2 border-input bg-background px-4 text-lg text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary";
const PRIMARY = "inline-flex items-center justify-center w-full min-h-[58px] rounded-xl bg-primary px-5 text-lg font-bold text-primary-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const LINK = "min-h-[48px] inline-flex items-center text-base font-semibold text-primary underline underline-offset-4";

/**
 * Parcours d'inscription d'un abonné rattaché à l'agent `userId`.
 *
 * @example <SubscriberSignup userId={ownerId} />
 */
export function SubscriberSignup({ userId }: { userId: string }) {
  const [step, setStep] = useState<Step>(1);
  const [criteria, setCriteria] = useState<CriteriaValue>(EMPTY_CRITERIA);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(DEFAULT_PHONE);
  const [code, setCode] = useState("");
  const [spacePath, setSpacePath] = useState<string | null>(null);
  const [firstSelection, setFirstSelection] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [exists, setExists] = useState(false);
  const [restored, setRestored] = useState(false);

  const storageKey = `mca-inscription-${userId}`;
  const phoneDigits = phone.replace(/\D/g, "");
  const offers = SUBSCRIPTION_PLANS.map(planOffer);
  const summary = criteriaSummary(criteria);

  // Les réponses sont gardées dans l'onglet : un rechargement de page ne fait rien perdre.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null") as { criteria?: CriteriaValue; name?: string; phone?: string; step?: number } | null;
      if (saved?.criteria) setCriteria({ ...EMPTY_CRITERIA, ...saved.criteria });
      if (typeof saved?.name === "string") setName(saved.name);
      if (typeof saved?.phone === "string" && saved.phone) setPhone(saved.phone);
      if (saved?.step === 2 || saved?.step === 3) setStep(saved.step);
    } catch {
      // stockage indisponible ou illisible : on repart d'un formulaire vide
    }
    setRestored(true);
  }, [storageKey]);

  useEffect(() => {
    if (!restored || step === "done") return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ criteria, name, phone, step: typeof step === "number" ? step : 3 }));
    } catch {
      // stockage plein ou refusé : sans conséquence
    }
  }, [restored, storageKey, criteria, name, phone, step]);

  const go = (next: Step) => {
    setError(""); setInfo(""); setExists(false);
    setStep(next);
    window.scrollTo({ top: 0 });
  };

  const post = async (path: string, body: unknown) => {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Reply;
    return { ok: res.ok, data };
  };

  const fail = (data: Reply, fallback: string) => {
    setExists(data.code === "exists");
    setError(data.error || fallback);
  };

  /** Erreur qui empêche de quitter l'étape en cours, en clair. */
  const stepError = (current: Step): string | null => {
    if (current === 1 && criteria.type_offre.length !== 1) return "Indiquez si vous souhaitez louer ou acheter.";
    if (current === 2) return criteriaError(criteria);
    if (current === 3 && !/^\d{8,15}$/.test(phoneDigits)) return "Indiquez votre numéro WhatsApp pour recevoir les alertes, avec l'indicatif (ex. +241 77 12 34 56).";
    return null;
  };

  // Fin de l'étape 3 : un code part sur le WhatsApp indiqué.
  const requestCode = async () => {
    setError(""); setInfo(""); setExists(false); setLoading(true);
    try {
      const { ok, data } = await post("/api/auth/otp/request", { phone: phoneDigits, signup: true });
      if (ok) {
        setCode("");
        setStep("code");
        setInfo(data.message || "Code envoyé sur WhatsApp.");
        window.scrollTo({ top: 0 });
      } else {
        fail(data, "Envoi du code impossible. Réessayez.");
      }
    } catch {
      setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
    }
    setLoading(false);
  };

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof step !== "number") return;
    const problem = stepError(step);
    if (problem) {
      setError(problem);
      return;
    }
    if (step === 3) void requestCode();
    else go((step + 1) as Step);
  };

  // Le code valide le numéro : l'alerte est créée.
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setInfo(""); setExists(false); setLoading(true);
    try {
      const { ok, data } = await post("/api/demands/public", {
        userId,
        client_name: name.trim() || null,
        client_phone: phoneDigits,
        code,
        ...criteriaPayload(criteria),
      });
      if (ok) {
        setSpacePath(data.spacePath || null);
        setFirstSelection(typeof data.firstSelection === "number" ? data.firstSelection : 0);
        setStep("done");
        try { sessionStorage.removeItem(storageKey); } catch { /* sans conséquence */ }
        window.scrollTo({ top: 0 });
      } else {
        fail(data, "Création de l'alerte impossible. Réessayez.");
      }
    } catch {
      setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
    }
    setLoading(false);
  };

  const alerts = (
    <>
      {error && (
        <div className="rounded-xl border-2 border-destructive bg-destructive/10 p-4 text-base font-semibold text-destructive" role="alert">
          {error}
          {exists && <Link href="/login" className="block mt-2 underline underline-offset-4">Me connecter</Link>}
        </div>
      )}
      {info && <div className="rounded-xl border-2 border-primary bg-primary/10 p-4 text-base font-semibold" role="status">{info}</div>}
    </>
  );

  const recap = (
    <section className="rounded-2xl border-2 border-primary bg-card p-5 shadow-sm" aria-labelledby="recap-titre">
      <h2 id="recap-titre" className="text-xl font-bold mb-3">Votre alerte</h2>
      <ul className="space-y-3">
        {summary.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-base">
            <Icon className="h-5 w-5 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            <span>{text}</span>
          </li>
        ))}
        <li className="flex items-start gap-3 text-base">
          <MessageCircle className="h-5 w-5 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <span>Alertes sur WhatsApp, au fil des nouvelles annonces</span>
        </li>
      </ul>
    </section>
  );

  const shell = (children: React.ReactNode, narrow = false) => (
    <div className={`theme-light ${font.className} min-h-screen px-4 py-6 text-[17px]`}>
      <div className={`mx-auto space-y-5 ${narrow ? "max-w-md" : "max-w-xl"}`}>
        <div className="flex items-center justify-center gap-2">
          <BrandLogo variant="green" className="h-12 w-auto" priority />
        </div>
        {children}
      </div>
    </div>
  );

  if (step === "done") {
    return shell(
      <>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm text-center space-y-3">
          <CheckCircle2 className="h-14 w-14 text-primary mx-auto" aria-hidden="true" />
          <h1 className="text-2xl font-extrabold">Votre alerte est créée</h1>
          <p className="text-base text-muted-foreground">
            {firstSelection > 0
              ? `${firstSelection} annonce${firstSelection > 1 ? "s correspondent" : " correspond"} déjà à votre recherche : le lien vient de partir sur WhatsApp au ${phone}.`
              : `Aucune annonce ne correspond pour l'instant. Dès la première, vous recevrez un message WhatsApp au ${phone}.`}{" "}
            Votre essai gratuit de {TRIAL_HOURS} h commence maintenant.
          </p>
        </div>
        {recap}
        {spacePath ? (
          <a href={spacePath} className={PRIMARY}>Ouvrir mon espace</a>
        ) : (
          <Link href="/login" className={PRIMARY}>Me connecter à mon espace</Link>
        )}
        <p className="text-center text-base text-muted-foreground">Dans votre espace, vous modifiez vos critères à tout moment.</p>
      </>,
      true
    );
  }

  if (step === "code") {
    return shell(
      <form onSubmit={confirm} className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4" noValidate>
        <h1 className="text-2xl font-extrabold">Confirmez votre numéro</h1>
        {alerts}
        <div>
          <label className="text-base font-semibold block mb-2" htmlFor="signup-code">Code reçu sur WhatsApp</label>
          <input
            id="signup-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6 chiffres"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className={`${FIELD} text-center text-2xl tracking-[0.4em]`}
            autoFocus
          />
          <p className="text-base text-muted-foreground mt-2">Envoyé au {phone}. Valable 5 minutes.</p>
        </div>
        <button type="submit" className={PRIMARY} disabled={loading || code.length !== 6}>
          {loading && <Loader2 className="h-5 w-5 mr-2 animate-spin" aria-hidden="true" />}
          Activer mon alerte WhatsApp
        </button>
        <div className="flex flex-wrap justify-between gap-x-4">
          <button type="button" className={LINK} onClick={() => go(3)}>Modifier ma demande</button>
          <button type="button" className={`${LINK} disabled:opacity-50`} disabled={loading} onClick={() => void requestCode()}>Renvoyer le code</button>
        </div>
      </form>,
      true
    );
  }

  return shell(
    <form onSubmit={next} className="space-y-5 pb-36" noValidate>
      {step === 1 && (
        <header className="text-center space-y-2">
          <h1 className="text-[28px] leading-tight font-extrabold">Créez votre alerte immobilière</h1>
          <p className="text-base text-muted-foreground">
            Recevez sur WhatsApp les nouvelles annonces Facebook et TikTok qui correspondent à vos critères.
          </p>
          <p className="text-base font-bold">{TRIAL_HOURS} h d&apos;essai gratuit — aucun paiement demandé aujourd&apos;hui</p>
          <details className="text-left rounded-xl border border-border bg-card px-4">
            <summary className="min-h-[48px] flex items-center cursor-pointer text-base font-semibold text-primary">Voir les tarifs</summary>
            <ul className="pb-3 space-y-1 text-base">
              {offers.map((offer) => <li key={offer}>{offer}</li>)}
            </ul>
            <p className="pb-4 text-base text-muted-foreground">
              Après l&apos;essai, rien n&apos;est prélevé automatiquement : si vous souhaitez continuer, vous choisissez une formule et payez par Mobile Money.
            </p>
          </details>
          <p className="text-base text-muted-foreground">
            Déjà inscrit ? <Link href="/login" className="font-semibold text-primary underline underline-offset-4">Me connecter</Link>
          </p>
        </header>
      )}

      <div aria-live="polite">
        <p className="text-base font-bold">Étape {step} sur 3 · {STEP_TITLES[step - 1]}</p>
        <div className="mt-2 grid grid-cols-3 gap-2" aria-hidden="true">
          {[1, 2, 3].map((n) => <span key={n} className={`h-2 rounded-full ${n <= step ? "bg-primary" : "bg-border"}`} />)}
        </div>
      </div>

      {alerts}

      {step === 1 && <CriteriaFields value={criteria} onChange={setCriteria} sections={["recherche"]} />}
      {step === 2 && <CriteriaFields value={criteria} onChange={setCriteria} sections={["budget", "lieu"]} />}
      {step === 3 && (
        <>
          <CriteriaFields value={criteria} onChange={setCriteria} sections={["equipements"]} />

          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
            <h2 className="text-xl font-bold leading-tight">Où envoyer vos alertes ?</h2>
            <div>
              <label className="text-base font-semibold block mb-2" htmlFor="signup-phone">Numéro WhatsApp</label>
              <input
                id="signup-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+241 77 12 34 56"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s]/g, "").slice(0, 20))}
                className={FIELD}
              />
              <p className="text-base text-muted-foreground mt-2">Un code de confirmation y sera envoyé.</p>
            </div>
            <div>
              <label className="text-base font-semibold block mb-2" htmlFor="signup-name">Prénom (facultatif)</label>
              <input id="signup-name" autoComplete="given-name" maxLength={80} placeholder="Votre prénom" value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
            </div>
          </section>

          {recap}
        </>
      )}

      {/* Barre d'action fixée en bas : toujours visible, sans masquer les champs (marge sous le formulaire). */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card/95 backdrop-blur px-4 py-3">
        <div className="mx-auto max-w-xl flex items-center gap-3">
          {step > 1 && (
            <button type="button" onClick={() => go((step - 1) as Step)} className="inline-flex items-center justify-center min-h-[58px] rounded-xl border-2 border-border bg-card px-4 text-base font-bold" aria-label="Étape précédente">
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          <button type="submit" className={PRIMARY} disabled={loading}>
            {loading && <Loader2 className="h-5 w-5 mr-2 animate-spin" aria-hidden="true" />}
            {step === 3 ? "Créer mon alerte gratuite" : "Continuer"}
          </button>
        </div>
        {step === 3 && (
          <p className="mx-auto max-w-xl mt-2 text-center text-sm text-muted-foreground">
            {TRIAL_HOURS} h d&apos;essai gratuit · Modification à tout moment depuis votre espace
          </p>
        )}
      </div>
    </form>
  );
}
