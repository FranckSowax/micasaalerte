"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Bot, CheckCircle2, ExternalLink, Flag, Loader2, Pencil, RotateCcw, ShieldOff, X } from "lucide-react";
import { formatDate, formatPrice, getTypeBienLabel, getTypeOffreLabel } from "@/lib/utils";

interface AnnonceSummary {
  id: string;
  typeOffre: string | null;
  typeBien: string | null;
  prix: number | null;
  devise: string | null;
  quartier: string | null;
  ville: string | null;
  resume: string;
  image: string | null;
  postUrl: string | null;
  publishedAt: string | null;
  archived: boolean;
}

interface Report {
  annonce: AnnonceSummary;
  count: number;
  suggestedReason: "arnaque" | "indisponible";
  reporters: { name: string | null; phone: string; reason: string | null; at: string | null }[];
  withdrawal: { reason: "arnaque" | "indisponible"; by: "agent" | "auto"; at: string } | null;
  analysis: { verdict: "retirer" | "garder" | "incertain"; reasoning: string; signals: string[]; at: string } | null;
}

interface Learning {
  name: string | null;
  phone: string;
  samples: number;
  precision: number | null;
  learned: string[];
}

interface MatchingAnalysis {
  reasoning: string;
  findings: string[];
  recommendations: string[];
  at: string;
}

interface RecentFeedback {
  name: string | null;
  phone: string;
  feedback: string | null;
  at: string | null;
  annonce: AnnonceSummary;
}

const LABELS: Record<string, string> = {
  pertinente: "Pertinente",
  prix: "Prix",
  quartier: "Quartier",
  type: "Type de bien",
  equipement: "Équipements",
  indisponible: "Déjà loué ou vendu",
  arnaque: "Arnaque",
};
const VERDICTS = {
  retirer: { label: "Le modèle conseille de retirer", className: "bg-red-500/20 text-red-400" },
  garder: { label: "Le modèle conseille de garder", className: "bg-green-500/20 text-green-400" },
  incertain: { label: "Le modèle ne tranche pas", className: "bg-amber-500/20 text-amber-400" },
};
const STAT_ORDER = ["pertinente", "prix", "quartier", "type", "equipement", "indisponible", "arnaque"];

const line = (a: AnnonceSummary) =>
  [a.typeOffre ? getTypeOffreLabel(a.typeOffre) : null, a.typeBien ? getTypeBienLabel(a.typeBien) : null, a.prix ? formatPrice(a.prix, a.devise || "FCFA") : null, [a.quartier, a.ville].filter(Boolean).join(", ") || null]
    .filter(Boolean)
    .join(" · ");

/** Avis des abonnés : signalements à traiter (avec l'avis du modèle), statistiques et derniers avis. */
export default function AvisPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [recent, setRecent] = useState<RecentFeedback[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [learning, setLearning] = useState<Learning[]>([]);
  const [analysis, setAnalysis] = useState<{ result: MatchingAnalysis; basedOn: number } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/feedback", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setReports(data.reports || []);
        setRecent(data.recent || []);
        setStats(data.stats || {});
        setLearning(data.learning || []);
        setMigrationNeeded(!!data.migrationNeeded);
        setAiConfigured(data.aiConfigured !== false);
      } else {
        setError(data.error || "Chargement impossible");
      }
    } catch {
      setError("Chargement impossible");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (report: Report, action: "withdraw" | "ignore" | "restore") => {
    if (action === "withdraw" && !confirm("Retirer cette annonce chez tous les abonnés ?")) return;
    setError(""); setSuccess(""); setBusy(report.annonce.id);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annonceId: report.annonce.id, action, reason: report.suggestedReason }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccess(action === "withdraw" ? "Annonce retirée chez tous les abonnés." : action === "ignore" ? "Signalements ignorés : l'annonce reste en ligne." : "Annonce remise en ligne.");
        await load();
      } else {
        setError(data.error || "Action impossible");
      }
    } catch {
      setError("Connexion impossible. Réessayez.");
    }
    setBusy(null);
  };

  const analyze = async () => {
    setError(""); setSuccess(""); setAnalyzing(true);
    try {
      const res = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "analyze" }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.analysis) setAnalysis({ result: data.analysis, basedOn: data.basedOn || 0 });
      else setError(data.error || "Analyse impossible");
    } catch {
      setError("Connexion impossible. Réessayez.");
    }
    setAnalyzing(false);
  };

  const pending = reports.filter((r) => !r.withdrawal);
  const withdrawn = reports.filter((r) => r.withdrawal);
  const total = STAT_ORDER.reduce((sum, key) => sum + (stats[key] || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Avis clients</h1>
        <p className="text-muted-foreground mt-1">
          Ce que vos abonnés disent des annonces reçues. Une annonce signalée par cinq abonnés différents est retirée automatiquement ; vous pouvez aussi la retirer ou la garder vous-même.
        </p>
      </div>

      {error && <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-start gap-2"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{error}</div>}
      {success && <div className="p-3 rounded-md bg-green-500/10 text-green-400 text-sm flex items-start gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />{success}</div>}
      {migrationNeeded && (
        <div className="p-3 rounded-md bg-amber-500/10 text-amber-400 text-sm">
          Les avis ne sont pas encore enregistrés : relancez supabase_schema.sql dans Supabase (colonne client_feedback).
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Répartition des avis ({total})</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {STAT_ORDER.map((key) => (
                <Card key={key}><CardContent className="p-4">
                  <p className="text-2xl font-bold">{stats[key] || 0}</p>
                  <p className="text-sm text-muted-foreground">{LABELS[key]}</p>
                </CardContent></Card>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Amélioration du matching</h2>
            <p className="text-sm text-muted-foreground">
              Le matching s&apos;ajuste seul à chaque abonné : un quartier, un type ou un niveau de prix écarté au moins deux fois fait baisser le score des annonces semblables ; un quartier jugé pertinent le fait monter. Les critères obligatoires ne changent jamais.
            </p>
            {!learning.length ? (
              <Card><CardContent className="p-6 text-sm text-muted-foreground">Aucun avis pour l&apos;instant : rien n&apos;a encore été appris.</CardContent></Card>
            ) : (
              <Card><CardContent className="p-0 divide-y divide-border">
                {learning.map((l, i) => (
                  <div key={i} className="p-3 text-sm space-y-1">
                    <p>
                      <span className="font-medium">{l.name || l.phone}</span>
                      <span className="text-muted-foreground"> · {l.samples} avis{l.precision !== null ? ` · ${Math.round(l.precision * 100)} % d'annonces jugées pertinentes` : ""}</span>
                    </p>
                    {l.learned.length ? (
                      <ul className="list-disc pl-5 text-muted-foreground">{l.learned.map((line) => <li key={line}>{line}</li>)}</ul>
                    ) : (
                      <p className="text-muted-foreground">Pas encore de tendance : il faut au moins deux refus pour le même motif.</p>
                    )}
                  </div>
                ))}
              </CardContent></Card>
            )}

            <Card><CardContent className="p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <p className="flex-1 text-sm">
                  <span className="font-medium">Analyse d&apos;ensemble par le modèle.</span> Il lit les critères, les avis et les annonces écartées, puis rédige un raisonnement et des recommandations. Aucun nom ni numéro ne lui est transmis.
                </p>
                <Button size="sm" onClick={analyze} disabled={analyzing || !aiConfigured}>
                  {analyzing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Bot className="h-4 w-4 mr-1" />} Analyser le matching
                </Button>
              </div>
              {analysis && (
                <div className="rounded-md border border-border p-3 space-y-3 text-sm">
                  <p>{analysis.result.reasoning}</p>
                  {!!analysis.result.findings.length && (
                    <div>
                      <p className="font-medium">Constats</p>
                      <ul className="list-disc pl-5 text-muted-foreground">{analysis.result.findings.map((f) => <li key={f}>{f}</li>)}</ul>
                    </div>
                  )}
                  {!!analysis.result.recommendations.length && (
                    <div>
                      <p className="font-medium">Recommandations</p>
                      <ul className="list-disc pl-5 text-muted-foreground">{analysis.result.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">Analyse établie sur {analysis.basedOn} avis. Elle conseille : rien n&apos;est modifié automatiquement à partir de ce texte.</p>
                </div>
              )}
            </CardContent></Card>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Signalements à traiter ({pending.length})</h2>
            {!pending.length ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">Aucun signalement en attente.</CardContent></Card>
            ) : pending.map((r) => (
              <Card key={r.annonce.id}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row gap-4">
                    {r.annonce.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.annonce.image} alt="" className="w-full sm:w-40 h-40 object-cover rounded-md shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    )}
                    <div className="flex-1 min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-red-500/20 text-red-400"><Flag className="h-3 w-3 mr-1" />{r.count} signalement{r.count > 1 ? "s" : ""}</Badge>
                        <span className="font-medium">{line(r.annonce) || "Annonce sans détail"}</span>
                      </div>

                      <ul className="text-sm text-muted-foreground space-y-1">
                        {r.reporters.map((p, i) => (
                          <li key={i}>
                            <span className="text-foreground font-medium">{p.name || "Abonné sans nom"}</span> ({p.phone}) : {LABELS[p.reason || ""] || p.reason}
                            {p.at ? ` · ${formatDate(p.at)}` : ""}
                          </li>
                        ))}
                      </ul>

                      <p className="text-sm whitespace-pre-line line-clamp-4">{r.annonce.resume}</p>

                      {r.analysis ? (
                        <div className="rounded-md border border-border p-3 space-y-2">
                          <Badge className={VERDICTS[r.analysis.verdict].className}><Bot className="h-3 w-3 mr-1" />{VERDICTS[r.analysis.verdict].label}</Badge>
                          <p className="text-sm">{r.analysis.reasoning}</p>
                          {!!r.analysis.signals.length && (
                            <ul className="text-sm text-muted-foreground list-disc pl-5">
                              {r.analysis.signals.map((s) => <li key={s}>{s}</li>)}
                            </ul>
                          )}
                          <p className="text-xs text-muted-foreground">Avis établi à partir du seul texte de l&apos;annonce : c&apos;est une aide, la décision vous revient.</p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground flex items-center gap-2">
                          <Bot className="h-4 w-4" />
                          {aiConfigured ? "Avis du modèle indisponible pour le moment. Rechargez la page pour réessayer." : "Aucun modèle d'IA configuré : pas d'avis automatique."}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" disabled={busy === r.annonce.id} onClick={() => act(r, "withdraw")}>
                          {busy === r.annonce.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ShieldOff className="h-4 w-4 mr-1" />} Retirer chez tous
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy === r.annonce.id} onClick={() => act(r, "ignore")}>
                          <X className="h-4 w-4 mr-1" /> Garder l&apos;annonce
                        </Button>
                        <Link href={`/annonces/${r.annonce.id}`} className="inline-flex items-center h-9 px-3 rounded-md border border-input text-sm hover:bg-accent">
                          <Pencil className="h-4 w-4 mr-1" /> Ouvrir l&apos;annonce
                        </Link>
                        {r.annonce.postUrl && (
                          <a href={r.annonce.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center h-9 px-3 rounded-md border border-input text-sm hover:bg-accent">
                            <ExternalLink className="h-4 w-4 mr-1" /> Publication d&apos;origine
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>

          {!!withdrawn.length && (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold">Annonces retirées ({withdrawn.length})</h2>
              {withdrawn.map((r) => (
                <Card key={r.annonce.id}><CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{line(r.annonce) || "Annonce sans détail"}</p>
                    <p className="text-sm text-muted-foreground">
                      {LABELS[r.withdrawal!.reason]} · {r.withdrawal!.by === "auto" ? "retrait automatique (2 signalements)" : "retirée par vous"} · {formatDate(r.withdrawal!.at)}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" disabled={busy === r.annonce.id} onClick={() => act(r, "restore")}>
                    <RotateCcw className="h-4 w-4 mr-1" /> Remettre en ligne
                  </Button>
                </CardContent></Card>
              ))}
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Derniers avis sur la pertinence</h2>
            {!recent.length ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">Aucun avis pour le moment.</CardContent></Card>
            ) : (
              <Card><CardContent className="p-0 divide-y divide-border">
                {recent.map((f, i) => (
                  <div key={i} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
                    <Badge className={f.feedback === "pertinente" ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-400"}>{LABELS[f.feedback || ""] || f.feedback}</Badge>
                    <span className="font-medium">{f.name || f.phone}</span>
                    <Link href={`/annonces/${f.annonce.id}`} className="flex-1 min-w-0 truncate text-muted-foreground hover:underline">{line(f.annonce) || "Annonce sans détail"}</Link>
                    {f.at && <span className="text-xs text-muted-foreground shrink-0">{formatDate(f.at)}</span>}
                  </div>
                ))}
              </CardContent></Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}
