"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, Flag, MapPin, MessageCircle, Phone, RotateCcw, SlidersHorizontal, Sparkles, ThumbsDown, ThumbsUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

// Découverte de l'espace client à la première visite : 5 cartes courtes qui montrent les vrais
// boutons. Mémorisée sur le téléphone (rien en base) ; le bouton « Aide » la relance.

/** Clé du « déjà vu » sur le téléphone. */
export const ONBOARDING_KEY = "mca-decouverte-vue";

/** Copie visuelle d'un bouton de l'espace client (non cliquable). */
// Mêmes couleurs que dans l'espace client (voir app/c/[token]/page.tsx).
function Chip({ icon, children, tone = "outline" }: { icon?: ReactNode; children: ReactNode; tone?: "outline" | "primary" | "amber" | "green" | "red" | "trial" }) {
  const styles = {
    outline: "border border-input bg-background text-foreground",
    primary: "bg-primary text-primary-foreground",
    amber: "bg-amber-400 text-black border border-amber-500",
    green: "bg-green-600 text-white",
    red: "bg-red-600 text-white",
    trial: "bg-amber-500 text-black rounded-full px-3 py-1 text-xs",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-semibold ${styles}`} aria-hidden="true">
      {icon}
      {children}
    </span>
  );
}

function Line({ chip, children }: { chip: ReactNode; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-1">
      <span>{chip}</span>
      <span className="text-[15px] leading-snug text-muted-foreground">{children}</span>
    </li>
  );
}

const icon = "h-4 w-4";

const STEPS: { emoji: string; title: string; body: ReactNode }[] = [
  {
    emoji: "👋🏾",
    title: "Bienvenue sur Mi Casa Gabon 🇬🇦",
    body: (
      <div className="space-y-3 text-[15px] leading-relaxed">
        <p>Les annonces qui correspondent à votre recherche arrivent ici. Vous êtes prévenu sur <b>WhatsApp</b>, au plus une fois par heure, de 6 h à 23 h.</p>
        <p className="rounded-lg bg-primary/10 px-3 py-2 text-primary">🔒 Ce lien est personnel : il ne fonctionne que sur ce téléphone.</p>
      </div>
    ),
  },
  {
    emoji: "🗂️",
    title: "Vos 4 onglets",
    body: (
      <ul className="space-y-3">
        <Line chip={<Chip tone="primary">Pour vous</Chip>}>Les annonces qui correspondent à vos critères.</Line>
        <Line chip={<Chip>À vérifier</Chip>}>Il manque une information, souvent le prix : appelez l&apos;annonceur pour la confirmer.</Line>
        <Line chip={<Chip>Pertinentes</Chip>}>Celles que vous avez gardées.</Line>
        <Line chip={<Chip>Écartées</Chip>}>Celles que vous avez mises de côté.</Line>
        <Line chip={<Chip tone="amber" icon={<Sparkles className={icon} />}>Nouvelle annonce</Chip>}>Arrivée depuis votre dernière visite.</Line>
      </ul>
    ),
  },
  {
    emoji: "👍🏾👎🏾",
    title: "Triez vos annonces",
    body: (
      <ul className="space-y-3">
        <Line chip={<Chip tone="green" icon={<ThumbsUp className={icon} />}>Pertinente</Chip>}>L&apos;annonce passe dans « Pertinentes ».</Line>
        <Line chip={<Chip tone="red" icon={<ThumbsDown className={icon} />}>Pas pertinente</Chip>}>
          Dites pourquoi (le prix, le quartier, le type de bien…) : <b>la sélection apprend de vos réponses</b>.
        </Line>
        <Line chip={<Chip icon={<RotateCcw className={icon} />}>Restaurer</Chip>}>Vous changez d&apos;avis à tout moment.</Line>
        <Line chip={<Chip icon={<Flag className={icon} />}>Signaler une arnaque</Chip>}>Après 5 signalements, l&apos;annonce est retirée pour tous.</Line>
      </ul>
    ),
  },
  {
    emoji: "📞",
    title: "Contactez directement",
    body: (
      <ul className="space-y-3">
        <Line chip={<span className="flex flex-wrap gap-2"><Chip icon={<Phone className={icon} />}>Appeler</Chip><Chip icon={<MessageCircle className={icon} />}>WhatsApp</Chip></span>}>
          Vous joignez l&apos;annonceur, sans intermédiaire.
        </Line>
        <Line chip={<Chip icon={<ExternalLink className={icon} />}>Voir sur Facebook</Chip>}>La publication d&apos;origine, avec toutes ses photos.</Line>
        <Line chip={<Chip icon={<MapPin className={icon} />}>Voir sur la carte</Chip>}>Situez les annonces de l&apos;onglet ouvert.</Line>
      </ul>
    ),
  },
  {
    emoji: "⚙️",
    title: "Vos critères et votre abonnement",
    body: (
      <ul className="space-y-3">
        <Line chip={<Chip icon={<SlidersHorizontal className={icon} />}>Modifier mes critères</Chip>}>
          Budget, quartiers ou rayon, type de bien : votre liste se met à jour tout de suite.
        </Line>
        <Line chip={<Chip tone="trial">Essai gratuit</Chip>}>24 h offertes : le compteur indique le temps restant.</Line>
        <Line chip={<Chip icon={<Wallet className={icon} />}>S&apos;abonner</Chip>}>
          1, 7 ou 30 jours par Airtel Money, avec la référence affichée. Paiement validé : confirmation sur WhatsApp.
        </Line>
      </ul>
    ),
  },
];

/**
 * Fenêtre de découverte (5 étapes). S'affiche quand `open` est vrai ; `onClose` la referme et
 * mémorise qu'elle a été vue.
 *
 * @example <ClientOnboarding open={showTour} onClose={() => setShowTour(false)} />
 */
export function ClientOnboarding({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const primary = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);
  const last = step === STEPS.length - 1;

  const close = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      // Stockage indisponible (navigation privée) : la découverte reviendra, sans gravité.
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, close]);

  useEffect(() => {
    if (open) primary.current?.focus();
  }, [open, step]);

  if (!open) return null;
  const current = STEPS[step];

  return (
    <div className="fixed inset-0 z-[3000] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mca-tour-title"
        className="mca-tour-sheet w-full max-w-md rounded-t-2xl bg-background shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (dx < -50) setStep((s) => Math.min(s + 1, STEPS.length - 1));
          if (dx > 50) setStep((s) => Math.max(s - 1, 0));
        }}
      >
        <style>{`
          @keyframes mca-sheet-in{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
          @keyframes mca-step-in{from{transform:translateX(16px);opacity:0}to{transform:none;opacity:1}}
          .mca-tour-sheet{animation:mca-sheet-in .3s ease-out both}
          .mca-tour-step{animation:mca-step-in .3s ease-out both}
          @media (prefers-reduced-motion:reduce){.mca-tour-sheet,.mca-tour-step{animation:none}}
        `}</style>
        <div className="flex items-center justify-between px-5 pt-3">
          <span className="text-xs font-semibold text-muted-foreground">
            {step + 1} / {STEPS.length}
          </span>
          {!last ? (
            <button type="button" onClick={close} className="min-h-[44px] px-2 text-sm font-semibold text-muted-foreground underline-offset-2 hover:underline">
              Passer
            </button>
          ) : (
            <span className="min-h-[44px]" />
          )}
        </div>

        <div key={step} className="mca-tour-step max-h-[62vh] overflow-y-auto px-5 pb-2">
          <div className="mb-2 text-4xl" aria-hidden="true">{current.emoji}</div>
          <h2 id="mca-tour-title" className="mb-3 text-xl font-extrabold">{current.title}</h2>
          {current.body}
        </div>

        <div className="flex items-center gap-3 border-t px-5 py-4">
          <div className="flex flex-1 gap-1.5" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span key={i} className={`h-2 rounded-full transition-all ${i === step ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30"}`} />
            ))}
          </div>
          {step > 0 && (
            <Button variant="outline" className="min-h-[48px]" onClick={() => setStep(step - 1)}>
              Retour
            </Button>
          )}
          <Button ref={primary} className="min-h-[48px] min-w-[120px]" onClick={() => (last ? close() : setStep(step + 1))}>
            {last ? "C'est parti ! 🙌🏾" : "Suivant"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** La découverte a-t-elle déjà été vue sur ce téléphone ? */
export function onboardingSeen(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}
