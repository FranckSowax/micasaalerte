"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, ExternalLink, ImageIcon, Loader2, Search, Video } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatPrice, getTypeBienLabel, getTypeOffreLabel } from "@/lib/utils";
import { ANNONCE_LIFETIME_HOURS } from "@/lib/annonce-lifetime";
import { ARCHIVE_REASON_LABELS, type ArchiveReason, archiveReason, archiveReasonLabel, expiryFilter, parutionEnd } from "@/lib/archive";
import type { Annonce } from "@/types/database";

// Archivage : les annonces passées au statut « archivé ». La plupart ont dépassé leur délai de
// parution (archivage automatique par la collecte) ; elles restent conservées et consultables ici.

type ArchivedRow = Annonce & { details?: Record<string, unknown> | null };
type Tab = "all" | ArchiveReason;

const PAGE_SIZE = 100;
const TYPE_OFFRE_OPTIONS = ["location", "vente", "colocation", "sous-location", "recherche"];
const TABS: { value: Tab; label: string }[] = [
  { value: "expired", label: "Délai dépassé" },
  { value: "withdrawn", label: "Retirées" },
  { value: "other", label: "Autres" },
  { value: "all", label: "Toutes" },
];
const REASON_STYLE: Record<ArchiveReason, string> = {
  expired: "bg-gray-500/20 text-gray-300",
  withdrawn: "bg-red-500/20 text-red-400",
  other: "bg-blue-500/20 text-blue-300",
};

export default function ArchivesPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>("expired");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [typeOffre, setTypeOffre] = useState("");
  const [rows, setRows] = useState<ArchivedRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Partial<Record<Tab, number>>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  // Recherche lancée 300 ms après la dernière frappe.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const base = useCallback(
    (select: string, head = false) => {
      let q = supabase
        .from("annonces")
        .select(select, { count: "exact", head })
        .eq("status", "archived")
        .eq("ai_is_real_estate", true);
      if (typeOffre) q = q.eq("type_offre", typeOffre);
      if (query) q = q.or(`raw_text.ilike.%${query.replace(/[,()]/g, " ")}%,quartier.ilike.%${query.replace(/[,()]/g, " ")}%`);
      return q;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [typeOffre, query],
  );

  const withReason = useCallback(
    <T extends ReturnType<typeof base>>(q: T, reason: Tab): T => {
      if (reason === "withdrawn") return q.not("details->withdrawn", "is", null) as T;
      if (reason === "expired") return q.is("details->withdrawn", null).or(expiryFilter(true)) as T;
      if (reason === "other") return q.is("details->withdrawn", null).or(expiryFilter(false)) as T;
      return q;
    },
    [],
  );

  const page = useCallback(
    (offset: number) =>
      withReason(base("*"), tab)
        .order("fb_posted_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1),
    [base, withReason, tab],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, count, error: e } = await page(0);
    if (e) setError("Chargement impossible. Réessayez.");
    setRows((data as unknown as ArchivedRow[]) || []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  // Compteurs des onglets (mêmes filtres de recherche et de type).
  useEffect(() => {
    let cancelled = false;
    Promise.all(TABS.map((t) => withReason(base("id", true), t.value))).then((results) => {
      if (cancelled) return;
      setCounts(Object.fromEntries(TABS.map((t, i) => [t.value, results[i].count ?? 0])));
    });
    return () => {
      cancelled = true;
    };
  }, [base, withReason]);

  const loadMore = async () => {
    setLoadingMore(true);
    const { data, count } = await page(rows.length);
    setRows((current) => [...current, ...((data as unknown as ArchivedRow[]) || [])]);
    if (count !== null) setTotal(count);
    setLoadingMore(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Archive className="h-7 w-7 text-muted-foreground" aria-hidden="true" /> Archivage
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          Une annonce est archivée {ANNONCE_LIFETIME_HOURS} heures après sa publication : elle n&apos;est plus envoyée aux
          abonnés mais reste conservée ici, avec ses photos et ses contacts. Les favoris ne sont jamais archivés automatiquement.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Motif d'archivage">
        {TABS.map((t) => (
          <Button key={t.value} role="tab" aria-selected={tab === t.value} variant={tab === t.value ? "default" : "outline"} size="sm" onClick={() => setTab(t.value)}>
            {t.label}
            {counts[t.value] !== undefined && <span className="ml-2 text-xs opacity-75">{counts[t.value]}</span>}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-4 grid gap-3 sm:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input placeholder="Rechercher dans le texte ou le quartier" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" aria-label="Rechercher" />
          </div>
          <select value={typeOffre} onChange={(e) => setTypeOffre(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm" aria-label="Type d'offre">
            <option value="">Tous les types d&apos;offre</option>
            {TYPE_OFFRE_OPTIONS.map((o) => <option key={o} value={o}>{getTypeOffreLabel(o)}</option>)}
          </select>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        {total} annonce{total !== 1 ? "s" : ""}
        {tab !== "all" ? ` · ${ARCHIVE_REASON_LABELS[tab].toLowerCase()}` : ""}
        {rows.length < total ? ` · ${rows.length} affichées` : ""}
      </p>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">Aucune annonce archivée pour ces critères.</CardContent></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="w-14 p-2" aria-label="Photo" />
                  <th className="text-left p-3 font-medium">Annonce</th>
                  <th className="text-right p-3 font-medium">Prix</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Publiée le</th>
                  <th className="text-left p-3 font-medium hidden lg:table-cell">Fin de parution</th>
                  <th className="text-left p-3 font-medium">Motif</th>
                  <th className="w-12 p-3" aria-label="Source" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const reason = archiveReason(a);
                  const title = [getTypeOffreLabel(a.type_offre), a.type_bien ? getTypeBienLabel(a.type_bien) : null].filter((s) => s && s !== "N/A").join(" · ") || "Annonce";
                  return (
                    <tr key={a.id} className="border-b border-border/50 hover:bg-accent/50 transition-colors">
                      <td className="p-2">
                        {a.raw_images?.length > 0 ? (
                          // eslint-disable-next-line @next/next/no-img-element -- photo stockée, taille libre
                          <img src={a.raw_images[0]} alt="" className="w-10 h-10 rounded object-cover bg-secondary" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                        ) : (
                          <div className="w-10 h-10 rounded bg-secondary flex items-center justify-center"><ImageIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></div>
                        )}
                      </td>
                      <td className="p-3 min-w-[220px]">
                        <Link href={`/annonces/${a.id}`} className="font-medium hover:text-primary flex items-center gap-1.5">
                          {a.fb_post_id?.startsWith("tiktok_") && <Video className="h-3.5 w-3.5 text-pink-400 shrink-0" aria-label="TikTok" />}
                          <span className="capitalize">{title}</span>
                        </Link>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {[a.quartier, a.ville].filter(Boolean).join(", ") || "Lieu non précisé"}
                          {a.ai_summary ? ` · ${a.ai_summary.slice(0, 90)}${a.ai_summary.length > 90 ? "…" : ""}` : ""}
                        </p>
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">{a.prix ? formatPrice(a.prix, a.devise) : <span className="text-muted-foreground">-</span>}</td>
                      <td className="p-3 hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">{formatDate(a.fb_posted_at || a.created_at)}</td>
                      <td className="p-3 hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">{formatDate(parutionEnd(a))}</td>
                      <td className="p-3"><Badge className={`text-[10px] ${REASON_STYLE[reason]}`}>{archiveReasonLabel(a)}</Badge></td>
                      <td className="p-3 text-center">
                        {a.fb_post_url && (
                          <a href={a.fb_post_url} target="_blank" rel="noopener noreferrer" className="inline-flex text-muted-foreground hover:text-primary" aria-label="Voir la publication d'origine">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && rows.length < total && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Afficher {Math.min(PAGE_SIZE, total - rows.length)} de plus
          </Button>
        </div>
      )}
    </div>
  );
}
