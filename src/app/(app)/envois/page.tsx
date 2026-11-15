"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ChevronDown, ChevronUp, ExternalLink, Loader2, Pencil } from "lucide-react";
import { formatDate, formatPrice, getTypeBienLabel, getTypeOffreLabel } from "@/lib/utils";

interface SendItem {
  id: string;
  sentAt: string | null;
  demandId: string;
  client: { name: string | null; phone: string };
  via: { id: string; label: string };
  messageSize: number;
  clientStatus: string;
  feedback: string | null;
  decidedAt: string | null;
  annonce: {
    id: string;
    source: string;
    postUrl: string | null;
    publishedAt: string | null;
    collectedAt: string | null;
    typeOffre: string | null;
    typeBien: string | null;
    prix: number | null;
    devise: string | null;
    quartier: string | null;
    ville: string | null;
    chambres: number | null;
    meuble: boolean | null;
    resume: string;
    image: string | null;
    photos: number;
    version: number;
    withdrawn: string | null;
  };
  match: { score: number; minScore: number; eligible: boolean; blockedBy: string[]; missing: string[]; reasons: string[] };
}

const STATUS_LABELS: Record<string, string> = { new: "Pas encore triée", kept: "Jugée pertinente", removed: "Écartée par l'abonné" };
const FEEDBACK_LABELS: Record<string, string> = {
  pertinente: "pertinente",
  prix: "le prix ne convient pas",
  quartier: "le quartier ne convient pas",
  type: "le type de bien ne convient pas",
  equipement: "les équipements ne conviennent pas",
  indisponible: "bien déjà loué ou vendu",
  arnaque: "signalée comme arnaque",
};

const title = (a: SendItem["annonce"]) =>
  [a.typeOffre ? getTypeOffreLabel(a.typeOffre) : null, a.typeBien ? getTypeBienLabel(a.typeBien) : null, a.prix ? formatPrice(a.prix, a.devise || "FCFA") : null, [a.quartier, a.ville].filter(Boolean).join(", ") || null]
    .filter(Boolean)
    .join(" · ") || "Annonce sans détail";

const value = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "non précisé" : String(v));

/** Journal des envois : chaque annonce envoyée à un abonné, son traitement et son matching. */
export default function EnvoisPage() {
  const [sends, setSends] = useState<SendItem[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string | null; phone: string }[]>([]);
  const [messages, setMessages] = useState(0);
  const [client, setClient] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/sends", { cache: "no-store" });
        const data = await res.json();
        if (res.ok) {
          setSends(data.sends || []);
          setClients(data.clients || []);
          setMessages(data.messages || 0);
        } else {
          setError(data.error || "Chargement impossible");
        }
      } catch {
        setError("Chargement impossible");
      }
      setLoading(false);
    })();
  }, []);

  const visible = useMemo(() => (client === "all" ? sends : sends.filter((s) => s.demandId === client)), [sends, client]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Envois</h1>
        <p className="text-muted-foreground mt-1">
          Les {sends.length} dernières annonces envoyées à vos abonnés, dans {messages} message{messages !== 1 ? "s" : ""} WhatsApp. Ouvrez une ligne pour voir le traitement de l&apos;annonce et le détail du matching.
        </p>
      </div>

      {error && <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-start gap-2"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{error}</div>}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label className="text-sm font-medium" htmlFor="envois-client">Abonné</label>
        <select id="envois-client" value={client} onChange={(e) => setClient(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm sm:w-80">
          <option value="all">Tous les abonnés ({sends.length})</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name || "Sans nom"} · {c.phone} ({sends.filter((s) => s.demandId === c.id).length})</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : !visible.length ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">Aucun envoi pour le moment.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {visible.map((s) => {
            const expanded = open === s.id;
            const a = s.annonce;
            return (
              <Card key={s.id}>
                <CardContent className="p-0">
                  <button type="button" className="w-full text-left p-4 flex items-start gap-3 hover:bg-accent/40" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : s.id)}>
                    {a.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.image} alt="" className="hidden sm:block w-20 h-20 object-cover rounded-md shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    )}
                    <span className="flex-1 min-w-0 space-y-1">
                      <span className="block font-medium truncate">{title(a)}</span>
                      <span className="block text-sm text-muted-foreground">
                        Pour {s.client.name || "abonné sans nom"} ({s.client.phone}){s.sentAt ? ` · ${formatDate(s.sentAt)}` : ""}
                      </span>
                      <span className="flex flex-wrap gap-2 pt-1">
                        <Badge className={s.via.id === "failed" || s.via.id === "dismissed" ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}>
                          {s.via.id === "whatsapp" ? `WhatsApp${s.messageSize > 1 ? ` · message de ${s.messageSize} annonces` : ""}` : s.via.id === "refresh" ? "Critères modifiés" : s.via.id === "failed" ? "Échec" : "Écartée"}
                        </Badge>
                        <Badge variant="outline">Score {s.match.score}/100</Badge>
                        {!!s.match.missing.length && <Badge className="bg-amber-500/20 text-amber-400">{s.match.missing.length} info{s.match.missing.length > 1 ? "s" : ""} manquante{s.match.missing.length > 1 ? "s" : ""}</Badge>}
                        {!s.match.eligible && <Badge className="bg-red-500/20 text-red-400">Ne correspond plus</Badge>}
                        <Badge variant="outline">{STATUS_LABELS[s.clientStatus] || s.clientStatus}</Badge>
                        {a.withdrawn && <Badge className="bg-red-500/20 text-red-400">Annonce retirée</Badge>}
                      </span>
                    </span>
                    {expanded ? <ChevronUp className="h-5 w-5 shrink-0 mt-1" /> : <ChevronDown className="h-5 w-5 shrink-0 mt-1" />}
                  </button>

                  {expanded && (
                    <div className="px-4 pb-4 grid gap-4 lg:grid-cols-2 border-t border-border pt-4">
                      <section className="space-y-2">
                        <h2 className="font-semibold">Traitement de l&apos;annonce</h2>
                        <ol className="text-sm space-y-2 list-decimal pl-5">
                          <li>
                            <span className="font-medium">Collecte</span> : publiée sur {a.source}{a.publishedAt ? ` le ${formatDate(a.publishedAt)}` : ""}
                            {a.collectedAt ? `, collectée le ${formatDate(a.collectedAt)}` : ""}. {a.photos} photo{a.photos !== 1 ? "s" : ""}.
                          </li>
                          <li>
                            <span className="font-medium">Analyse par l&apos;IA</span> : transaction {value(a.typeOffre ? getTypeOffreLabel(a.typeOffre) : null)}, type {value(a.typeBien ? getTypeBienLabel(a.typeBien) : null)}, prix {a.prix ? formatPrice(a.prix, a.devise || "FCFA") : "non précisé"}, quartier {value(a.quartier)}, ville {value(a.ville)}, chambres {value(a.chambres)}
                            {a.meuble === true ? ", meublé" : ""}{a.version > 1 ? ` (version ${a.version} : prix modifié)` : ""}.
                          </li>
                          <li><span className="font-medium">Envoi</span> : {s.via.label}{s.sentAt ? `, le ${formatDate(s.sentAt)}` : ""}.</li>
                          <li>
                            <span className="font-medium">Réaction de l&apos;abonné</span> : {STATUS_LABELS[s.clientStatus] || s.clientStatus}
                            {s.feedback && s.feedback !== "pertinente" ? ` (${FEEDBACK_LABELS[s.feedback] || s.feedback})` : ""}
                            {s.decidedAt ? `, le ${formatDate(s.decidedAt)}` : ""}.
                          </li>
                        </ol>
                        <p className="text-sm text-muted-foreground whitespace-pre-line line-clamp-5">{a.resume}</p>
                        <div className="flex flex-wrap gap-2">
                          <Link href={`/annonces/${a.id}`} className="inline-flex items-center h-9 px-3 rounded-md border border-input text-sm hover:bg-accent">
                            <Pencil className="h-4 w-4 mr-1" /> Ouvrir l&apos;annonce
                          </Link>
                          {a.postUrl && (
                            <a href={a.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center h-9 px-3 rounded-md border border-input text-sm hover:bg-accent">
                              <ExternalLink className="h-4 w-4 mr-1" /> Publication d&apos;origine
                            </a>
                          )}
                        </div>
                      </section>

                      <section className="space-y-2">
                        <h2 className="font-semibold">Matching avec les critères de l&apos;abonné</h2>
                        <p className="text-sm">
                          Score <span className="font-bold">{s.match.score}/100</span> (seuil d&apos;envoi : {s.match.minScore}).
                          {s.match.eligible ? " Aucun critère obligatoire n'est contredit." : " Un critère obligatoire est aujourd'hui contredit :"}
                        </p>
                        {!!s.match.blockedBy.length && (
                          <ul className="text-sm list-disc pl-5 text-red-400">{s.match.blockedBy.map((b) => <li key={b}>{b}</li>)}</ul>
                        )}
                        {!!s.match.missing.length && (
                          <div>
                            <p className="text-sm font-medium">Informations absentes de l&apos;annonce :</p>
                            <ul className="text-sm list-disc pl-5 text-amber-400">{s.match.missing.map((m) => <li key={m}>{m}</li>)}</ul>
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium">Ce qui a compté dans le score :</p>
                          {s.match.reasons.length ? (
                            <ul className="text-sm list-disc pl-5 text-muted-foreground">{s.match.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                          ) : (
                            <p className="text-sm text-muted-foreground">Aucune préférence (quartier, équipements) dans les critères : toute annonce conforme obtient 100.</p>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">Calculé avec les critères actuels de l&apos;abonné : s&apos;il les a modifiés depuis l&apos;envoi, le résultat peut différer de celui du jour de l&apos;envoi.</p>
                      </section>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
