"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";

export interface LastCheck {
  status: string;
  score: number;
  labels: string[];
  checkedAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  OK: "Annonce complète",
  INCOMPLETE: "Annonce incomplète",
  REJECTED: "Annonce très incomplète",
  NOT_AD: "Pas une annonce",
  NOT_FOUND: "Publication introuvable",
};

/**
 * Vérification d'une annonce par RapidAPI : relit la publication d'origine (1 appel du forfait),
 * récupère le texte complet et l'album, et affiche le verdict qualité.
 */
export function VerifyButton({ annonceId, lastCheck }: { annonceId: string; lastCheck: LastCheck | null }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const router = useRouter();

  const verify = async () => {
    setRunning(true);
    setError("");
    setResult("");
    try {
      const res = await fetch(`/api/annonces/${annonceId}/verify`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Vérification impossible");
      } else {
        const gains = [
          data.textImproved ? "texte complet récupéré" : null,
          data.photosAfter > data.photosBefore ? `${data.photosAfter} photos au lieu de ${data.photosBefore}` : null,
        ].filter(Boolean);
        setResult(
          `${STATUS_LABEL[data.status] ?? data.status}${gains.length ? ` : ${gains.join(", ")}` : " : rien de plus sur la publication d'origine"}. Appels RapidAPI ce mois-ci : ${data.used}/${data.cap}.`,
        );
        router.refresh();
      }
    } catch {
      setError("Connexion impossible. Réessayez.");
    }
    setRunning(false);
  };

  return (
    <div className="space-y-2">
      {lastCheck && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
          <p className="font-medium">
            {STATUS_LABEL[lastCheck.status] ?? lastCheck.status}
            {lastCheck.status !== "NOT_FOUND" && lastCheck.status !== "NOT_AD" ? ` · note ${lastCheck.score}/100` : ""}
          </p>
          {lastCheck.labels.length > 0 && <p className="text-muted-foreground">{lastCheck.labels.join(" · ")}</p>}
          <p className="text-xs text-muted-foreground mt-1">Vérifiée le {new Date(lastCheck.checkedAt).toLocaleString("fr-FR")}</p>
        </div>
      )}
      <Button variant="outline" size="sm" onClick={verify} disabled={running}>
        {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1" />}
        {lastCheck ? "Revérifier avec RapidAPI" : "Vérifier avec RapidAPI"}
      </Button>
      <p className="text-xs text-muted-foreground">Relit la publication Facebook d&apos;origine : texte complet et toutes les photos. Coûte 1 appel du forfait.</p>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {result && <p className="text-sm text-green-400" role="status">{result}</p>}
    </div>
  );
}
