"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Réglage de la photo jointe aux messages WhatsApp « lien de l'espace » (Paramètres).
 * L'envoi est immédiat : pas besoin du bouton « Sauvegarder » de la page.
 *
 * @example <WhatsAppImageSetting />
 */
export function WhatsAppImageSetting() {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "saving">("loading");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/settings/whatsapp-image")
      .then((r) => (r.ok ? r.json() : { url: null }))
      .then((d: { url: string | null }) => setUrl(d.url))
      .catch(() => setUrl(null))
      .finally(() => setState("idle"));
  }, []);

  const call = async (init: RequestInit, done: string) => {
    setState("saving");
    setMessage(null);
    try {
      const res = await fetch("/api/settings/whatsapp-image", init);
      const data = (await res.json().catch(() => ({}))) as { url?: string | null; error?: string };
      if (!res.ok) setMessage({ ok: false, text: data.error || "L'opération a échoué. Réessayez." });
      else {
        setUrl(data.url ?? null);
        setMessage({ ok: true, text: done });
      }
    } catch {
      setMessage({ ok: false, text: "Connexion impossible. Réessayez." });
    }
    setState("idle");
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    call({ method: "POST", body }, "Image enregistrée : elle accompagne désormais les messages.");
    if (input.current) input.current.value = "";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Image des messages WhatsApp</CardTitle>
        <CardDescription>
          Jointe à chaque message qui envoie aux abonnés le lien de leur espace (nouvelles annonces, inscription, nouveau lien).
          Le texte devient la légende. Sans image, les messages partent en texte seul.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === "loading" ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : url ? (
          // eslint-disable-next-line @next/next/no-img-element -- photo du stockage Supabase, taille libre
          <img src={url} alt="Image actuelle des messages WhatsApp" className="w-full max-w-sm rounded-lg border object-contain" />
        ) : (
          <div className="flex h-32 max-w-sm items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
            <ImageIcon className="h-4 w-4" aria-hidden="true" /> Aucune image
          </div>
        )}
        <p className="text-xs text-muted-foreground">JPG ou PNG, 5 Mo au plus. Format conseillé : carré 1080 × 1080.</p>
        <input ref={input} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => input.current?.click()} disabled={state !== "idle"}>
            {state === "saving" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            {url ? "Remplacer l'image" : "Choisir une image"}
          </Button>
          {url && (
            <Button type="button" variant="outline" onClick={() => call({ method: "DELETE" }, "Image retirée : les messages partent en texte seul.")} disabled={state !== "idle"}>
              <Trash2 className="h-4 w-4 mr-2" /> Retirer
            </Button>
          )}
        </div>
        {message && (
          <p className={`text-sm ${message.ok ? "text-green-500" : "text-destructive"}`} role="status">
            {message.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
