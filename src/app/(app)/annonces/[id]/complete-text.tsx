"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

/**
 * Complément du texte d'une annonce : l'agent colle le texte entier de la publication d'origine,
 * l'annonce est réanalysée. Mis en avant quand le texte collecté semble tronqué.
 */
export function CompleteText({ annonceId, truncated, postUrl }: { annonceId: string; truncated: boolean; postUrl: string | null }) {
  const [open, setOpen] = useState(truncated);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(""); setDone("");
    try {
      const res = await fetch(`/api/annonces/${annonceId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(data.isRealEstate === false ? "Texte enregistré. D'après ce texte, ce n'est pas une annonce immobilière." : "Annonce réanalysée : les informations sont à jour.");
        setText("");
        router.refresh();
      } else {
        setError(data.error || "Réanalyse impossible");
      }
    } catch {
      setError("Connexion impossible. Réessayez.");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      {truncated && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Texte probablement incomplet : le flux n&apos;a transmis que le début de la publication. Le prix, le quartier ou le contact peuvent manquer.
            {postUrl ? " Ouvrez la publication d'origine, copiez son texte et collez-le ci-dessous." : ""}
          </span>
        </p>
      )}

      {!open ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <RefreshCw className="h-4 w-4 mr-1" /> Compléter le texte et réanalyser
        </Button>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <label className="text-sm font-medium" htmlFor="texte-complet">Texte complet de la publication</label>
          <textarea
            id="texte-complet"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            maxLength={5000}
            placeholder="Collez ici tout le texte de la publication d'origine."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={saving || text.trim().length < 20}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />} Réanalyser l&apos;annonce
            </Button>
            {postUrl && (
              <a href={postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center h-9 px-3 rounded-md border border-input text-sm hover:bg-accent">
                Ouvrir la publication d&apos;origine
              </a>
            )}
          </div>
        </form>
      )}
      {done && <p className="text-sm text-green-400" role="status">{done}</p>}
    </div>
  );
}
