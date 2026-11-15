"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, AlertTriangle, CheckCircle2, ClipboardCheck, ExternalLink, Loader2, MapPin, Pencil, Send, UserCircle, X } from "lucide-react";
import { formatDate, formatPrice, getTypeBienLabel, getTypeOffreLabel } from "@/lib/utils";

interface ReviewItem {
  demandId: string;
  clientName: string | null;
  clientPhone: string;
  annonceId: string;
  score: number;
  doubts: string[];
  typeOffre: string | null;
  typeBien: string | null;
  prix: number | null;
  devise: string | null;
  quartier: string | null;
  ville: string | null;
  chambres: number | null;
  resume: string | null;
  texte: string;
  image: string | null;
  postUrl: string | null;
  createdAt: string;
}

const keyOf = (item: ReviewItem) => `${item.demandId}:${item.annonceId}`;

/** Annonces retenues par le matching faute d'un champ décisif : l'agent les envoie ou les écarte. */
export default function VerificationsPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reviews", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setItems(data.items || []);
      else setError(data.error || "Chargement impossible");
    } catch {
      setError("Chargement impossible");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (item: ReviewItem, action: "send" | "dismiss") => {
    setError(""); setSuccess(""); setBusy(keyOf(item));
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demandId: item.demandId, annonceId: item.annonceId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok || res.status === 409) {
        setItems((current) => current.filter((i) => keyOf(i) !== keyOf(item)));
        if (res.ok) setSuccess(action === "send" ? `Annonce envoyée à ${item.clientName || item.clientPhone}.` : "Annonce écartée pour ce client.");
        else setError(data.error || "Déjà traitée");
      } else {
        setError(data.error || "Action impossible");
      }
    } catch {
      setError("Connexion impossible. Réessayez.");
    }
    setBusy(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">À vérifier</h1>
        <p className="text-muted-foreground mt-1">
          {items.length} annonce{items.length !== 1 ? "s" : ""} correspond{items.length !== 1 ? "ent" : ""} à un client mais {items.length !== 1 ? "ont" : "a"} un doute : prix, lieu ou type de transaction manquant. Elles ne sont pas envoyées automatiquement.
        </p>
      </div>

      {error && <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-start gap-2"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{error}</div>}
      {success && <div className="p-3 rounded-md bg-green-500/10 text-green-400 text-sm flex items-start gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />{success}</div>}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : !items.length ? (
        <Card><CardContent className="p-12 text-center">
          <ClipboardCheck className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Rien à vérifier pour le moment.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={keyOf(item)}>
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  {item.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt="" className="w-full sm:w-40 h-40 object-cover rounded-md shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  )}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <UserCircle className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium">Pour {item.clientName || "client sans nom"}</span>
                      <span className="text-muted-foreground">{item.clientPhone}</span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {item.doubts.map((doubt) => (
                        <Badge key={doubt} className="bg-amber-500/20 text-amber-400">
                          <AlertTriangle className="h-3 w-3 mr-1" />{doubt}
                        </Badge>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {item.typeOffre && <Badge>{getTypeOffreLabel(item.typeOffre)}</Badge>}
                      {item.typeBien && <Badge variant="outline">{getTypeBienLabel(item.typeBien)}</Badge>}
                      {item.prix ? <span className="font-bold text-primary">{formatPrice(item.prix, item.devise || "FCFA")}</span> : null}
                      {item.chambres ? <span className="text-sm text-muted-foreground">{item.chambres} ch.</span> : null}
                    </div>

                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-4 w-4 shrink-0" />
                      {[item.quartier, item.ville].filter(Boolean).join(", ") || "Lieu non précisé"}
                      <span className="mx-1">·</span>
                      Collectée le {formatDate(item.createdAt)}
                    </p>

                    <p className="text-sm whitespace-pre-line line-clamp-6">{item.resume || item.texte}</p>

                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={busy === keyOf(item)} onClick={() => act(item, "send")}>
                        {busy === keyOf(item) ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />} Envoyer au client
                      </Button>
                      <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" disabled={busy === keyOf(item)} onClick={() => act(item, "dismiss")}>
                        <X className="h-4 w-4 mr-1" /> Écarter
                      </Button>
                      <Link href={`/annonces/${item.annonceId}`} className="inline-flex items-center h-9 px-3 rounded-md border border-input text-sm hover:bg-accent">
                        <Pencil className="h-4 w-4 mr-1" /> Ouvrir l&apos;annonce
                      </Link>
                      {item.postUrl && (
                        <a href={item.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center h-9 px-3 rounded-md border border-input text-sm hover:bg-accent">
                          <ExternalLink className="h-4 w-4 mr-1" /> Publication d&apos;origine
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        « Envoyer au client » ajoute l&apos;annonce à son espace et lui envoie un message WhatsApp avec son lien, quelle que soit l&apos;heure. « Écarter » ne concerne que ce client.
      </p>
    </div>
  );
}
