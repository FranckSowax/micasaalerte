"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  formatPrice,
  formatDate,
  getStatusColor,
  getTypeBienLabel,
  getTypeOffreLabel,
} from "@/lib/utils";
import { Star, Archive, Loader2, Search, X, LayoutGrid, List, ImageIcon, Video } from "lucide-react";
import Link from "next/link";
import type { Annonce } from "@/types/database";

const TYPE_OFFRE_OPTIONS = ["location", "vente", "colocation", "sous-location", "recherche"];
const TYPE_BIEN_OPTIONS = ["appartement", "maison", "studio", "chambre", "terrain", "bureau", "villa"];
const STATUS_OPTIONS = ["new", "sent", "archived", "favorite"];
const STATUS_LABELS: Record<string, string> = { new: "Nouveau", sent: "Envoyé", archived: "Archivé", favorite: "Favori" };

export default function AnnoncesPage() {
  const [annonces, setAnnonces] = useState<Annonce[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [filters, setFilters] = useState({
    type_offre: "",
    type_bien: "",
    status: "",
    prix_min: "",
    prix_max: "",
    quartier: "",
    search: "",
    date_from: "",
    date_to: "",
    has_images: "",
    source: "",
  });
  const supabase = createClient();

  const fetchAnnonces = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("annonces")
      .select("*")
      .eq("ai_is_real_estate", true)
      .order("fb_posted_at", { ascending: false, nullsFirst: false })
      .limit(200);

    if (filters.type_offre) query = query.eq("type_offre", filters.type_offre);
    if (filters.type_bien) query = query.eq("type_bien", filters.type_bien);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.prix_min) query = query.gte("prix", Number(filters.prix_min));
    if (filters.prix_max) query = query.lte("prix", Number(filters.prix_max));
    if (filters.quartier) query = query.ilike("quartier", `%${filters.quartier}%`);
    if (filters.search) query = query.or(`raw_text.ilike.%${filters.search}%,ai_summary.ilike.%${filters.search}%`);
    if (filters.date_from) query = query.gte("fb_posted_at", filters.date_from);
    if (filters.date_to) query = query.lte("fb_posted_at", `${filters.date_to}T23:59:59`);

    const { data } = await query;
    let filtered = data || [];

    // Client-side filter for images
    if (filters.has_images === "yes") {
      filtered = filtered.filter((a) => a.raw_images && a.raw_images.length > 0);
    } else if (filters.has_images === "no") {
      filtered = filtered.filter((a) => !a.raw_images || a.raw_images.length === 0);
    }

    // Client-side filter for source (TikTok vs Facebook)
    if (filters.source === "tiktok") {
      filtered = filtered.filter((a) => a.fb_post_id?.startsWith("tiktok_"));
    } else if (filters.source === "facebook") {
      filtered = filtered.filter((a) => !a.fb_post_id?.startsWith("tiktok_"));
    }

    setAnnonces(filtered);
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    fetchAnnonces();
  }, [fetchAnnonces]);

  const updateStatus = async (id: string, status: string) => {
    await supabase.from("annonces").update({ status }).eq("id", id);
    fetchAnnonces();
  };

  const clearFilters = () => {
    setFilters({ type_offre: "", type_bien: "", status: "", prix_min: "", prix_max: "", quartier: "", search: "", date_from: "", date_to: "", has_images: "", source: "" });
  };

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-6">
      {/* Header with view toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Annonces</h1>
          <p className="text-muted-foreground mt-1">
            {annonces.length} annonce{annonces.length !== 1 ? "s" : ""} trouvée{annonces.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-secondary rounded-lg p-1">
          <Button
            variant={view === "cards" ? "default" : "ghost"}
            size="sm"
            onClick={() => setView("cards")}
            className="h-8 px-3"
          >
            <LayoutGrid className="h-4 w-4 mr-1.5" />
            Cartes
          </Button>
          <Button
            variant={view === "table" ? "default" : "ghost"}
            size="sm"
            onClick={() => setView("table")}
            className="h-8 px-3"
          >
            <List className="h-4 w-4 mr-1.5" />
            Table
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="relative col-span-2 sm:col-span-3 lg:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Rechercher..." value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className="pl-9" />
            </div>
            <select value={filters.type_offre} onChange={(e) => setFilters({ ...filters, type_offre: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Type d&apos;offre</option>
              {TYPE_OFFRE_OPTIONS.map((o) => <option key={o} value={o}>{getTypeOffreLabel(o)}</option>)}
            </select>
            <select value={filters.type_bien} onChange={(e) => setFilters({ ...filters, type_bien: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Type de bien</option>
              {TYPE_BIEN_OPTIONS.map((b) => <option key={b} value={b}>{getTypeBienLabel(b)}</option>)}
            </select>
            <Input type="number" placeholder="Prix min" value={filters.prix_min} onChange={(e) => setFilters({ ...filters, prix_min: e.target.value })} />
            <Input type="number" placeholder="Prix max" value={filters.prix_max} onChange={(e) => setFilters({ ...filters, prix_max: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-3">
            <Input placeholder="Quartier" value={filters.quartier} onChange={(e) => setFilters({ ...filters, quartier: e.target.value })} />
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Statut</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <div className="space-y-1">
              <Input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} className="h-10" title="Publié depuis" />
            </div>
            <div className="space-y-1">
              <Input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} className="h-10" title="Publié jusqu'au" />
            </div>
            <select value={filters.has_images} onChange={(e) => setFilters({ ...filters, has_images: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Photos</option>
              <option value="yes">Avec photos</option>
              <option value="no">Sans photos</option>
            </select>
            <select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Source</option>
              <option value="facebook">Facebook</option>
              <option value="tiktok">TikTok</option>
            </select>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="mt-2">
              <X className="h-4 w-4 mr-1" /> Effacer les filtres
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !annonces.length ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">Aucune annonce ne correspond à vos critères.</p>
          </CardContent>
        </Card>
      ) : view === "table" ? (
        /* ==================== TABLE VIEW ==================== */
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left p-3 font-medium text-muted-foreground w-8"></th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Offre</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Bien</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Prix</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Quartier</th>
                  <th className="text-left p-3 font-medium text-muted-foreground hidden md:table-cell">Ville</th>
                  <th className="text-center p-3 font-medium text-muted-foreground hidden lg:table-cell">Ch.</th>
                  <th className="text-center p-3 font-medium text-muted-foreground hidden lg:table-cell">m²</th>
                  <th className="text-center p-3 font-medium text-muted-foreground hidden lg:table-cell">Meublé</th>
                  <th className="text-left p-3 font-medium text-muted-foreground hidden xl:table-cell">Contact</th>
                  <th className="text-center p-3 font-medium text-muted-foreground">Statut</th>
                  <th className="text-left p-3 font-medium text-muted-foreground hidden lg:table-cell">Publié le</th>
                  <th className="text-center p-3 font-medium text-muted-foreground w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {annonces.map((a) => (
                  <tr key={a.id} className="border-b border-border/50 hover:bg-accent/50 transition-colors">
                    {/* Thumbnail */}
                    <td className="p-2">
                      {a.raw_images?.length > 0 ? (
                        <div className="w-10 h-10 rounded overflow-hidden bg-secondary shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={a.raw_images[0]} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded bg-secondary flex items-center justify-center">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </td>
                    {/* Source + Type offre */}
                    <td className="p-3">
                      <Link href={`/annonces/${a.id}`} className="hover:text-primary transition-colors">
                        <div className="flex items-center gap-1.5">
                          {a.fb_post_id?.startsWith("tiktok_") && <Video className="h-3.5 w-3.5 text-pink-400 shrink-0" />}
                          {a.type_offre ? (
                            <Badge variant="outline" className="capitalize text-xs">{getTypeOffreLabel(a.type_offre)}</Badge>
                          ) : <span className="text-muted-foreground">-</span>}
                        </div>
                      </Link>
                    </td>
                    {/* Type bien */}
                    <td className="p-3">
                      <Link href={`/annonces/${a.id}`} className="hover:text-primary transition-colors">
                        {a.type_bien ? (
                          <span className="capitalize">{getTypeBienLabel(a.type_bien)}</span>
                        ) : <span className="text-muted-foreground">-</span>}
                      </Link>
                    </td>
                    {/* Prix */}
                    <td className="p-3 text-right">
                      <Link href={`/annonces/${a.id}`}>
                        {a.prix ? (
                          <span className="font-semibold text-primary whitespace-nowrap">{formatPrice(a.prix, a.devise)}</span>
                        ) : <span className="text-muted-foreground">-</span>}
                      </Link>
                    </td>
                    {/* Quartier */}
                    <td className="p-3">
                      <Link href={`/annonces/${a.id}`} className="hover:text-primary">
                        {a.quartier || <span className="text-muted-foreground">-</span>}
                      </Link>
                    </td>
                    {/* Ville */}
                    <td className="p-3 hidden md:table-cell text-muted-foreground">{a.ville}</td>
                    {/* Chambres */}
                    <td className="p-3 text-center hidden lg:table-cell text-muted-foreground">{a.nb_chambres || "-"}</td>
                    {/* Superficie */}
                    <td className="p-3 text-center hidden lg:table-cell text-muted-foreground">{a.superficie || "-"}</td>
                    {/* Meublé */}
                    <td className="p-3 text-center hidden lg:table-cell">
                      {a.meuble === true ? <span className="text-green-400">Oui</span> : a.meuble === false ? <span className="text-muted-foreground">Non</span> : <span className="text-muted-foreground">-</span>}
                    </td>
                    {/* Contact */}
                    <td className="p-3 hidden xl:table-cell">
                      {a.telephone ? (
                        <span className="text-xs text-muted-foreground">{a.telephone}</span>
                      ) : a.whatsapp ? (
                        <span className="text-xs text-muted-foreground">{a.whatsapp}</span>
                      ) : <span className="text-muted-foreground">-</span>}
                    </td>
                    {/* Statut */}
                    <td className="p-3 text-center">
                      <Badge className={`text-[10px] ${getStatusColor(a.status)}`}>{STATUS_LABELS[a.status] || a.status}</Badge>
                    </td>
                    {/* Date publication FB */}
                    <td className="p-3 hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(a.fb_posted_at || a.created_at)}</span>
                    </td>
                    {/* Actions */}
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-0.5">
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => updateStatus(a.id, a.status === "favorite" ? "new" : "favorite")}
                        >
                          <Star className={`h-3.5 w-3.5 ${a.status === "favorite" ? "fill-yellow-400 text-yellow-400" : ""}`} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateStatus(a.id, "archived")}>
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* ==================== CARDS VIEW ==================== */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {annonces.map((annonce) => (
            <Link key={annonce.id} href={`/annonces/${annonce.id}`}>
              <Card className="hover:border-primary/50 transition-colors h-full overflow-hidden">
                {annonce.raw_images?.length > 0 && (
                  <div className="relative h-40 bg-secondary">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={annonce.raw_images[0]}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    {annonce.raw_images.length > 1 && (
                      <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-0.5 rounded">
                        +{annonce.raw_images.length - 1} photo{annonce.raw_images.length > 2 ? "s" : ""}
                      </span>
                    )}
                  </div>
                )}
                <CardContent className="p-4 flex flex-col h-full">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex gap-2 flex-wrap">
                      {annonce.fb_post_id?.startsWith("tiktok_") && (
                        <Badge className="bg-pink-500/20 text-pink-400 text-[10px]"><Video className="h-3 w-3 mr-1" />TikTok</Badge>
                      )}
                      {annonce.type_offre && <Badge variant="outline" className="capitalize">{getTypeOffreLabel(annonce.type_offre)}</Badge>}
                      {annonce.type_bien && <Badge variant="secondary" className="capitalize">{getTypeBienLabel(annonce.type_bien)}</Badge>}
                    </div>
                    <Badge className={getStatusColor(annonce.status)}>{annonce.status}</Badge>
                  </div>

                  {annonce.prix && (
                    <p className="text-xl font-bold text-primary mb-1">{formatPrice(annonce.prix, annonce.devise)}</p>
                  )}

                  <p className="text-sm text-muted-foreground mb-2">
                    {annonce.quartier && `${annonce.quartier}, `}{annonce.ville}
                    {annonce.nb_chambres && ` | ${annonce.nb_chambres} ch.`}
                    {annonce.nb_pieces && ` | ${annonce.nb_pieces} p.`}
                    {annonce.meuble && " | Meublé"}
                  </p>

                  {annonce.ai_summary && (
                    <p className="text-sm text-foreground/80 flex-1 line-clamp-2 mb-3">{annonce.ai_summary}</p>
                  )}

                  {annonce.ai_tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {annonce.ai_tags.slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-border">
                    <div className="text-xs text-muted-foreground">
                      <span>{formatDate(annonce.fb_posted_at || annonce.created_at)}</span>
                      {annonce.fb_author_name && <span className="ml-1">| {annonce.fb_author_name}</span>}
                    </div>
                    <div className="flex gap-1" onClick={(e) => e.preventDefault()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateStatus(annonce.id, annonce.status === "favorite" ? "new" : "favorite")}>
                        <Star className={`h-3.5 w-3.5 ${annonce.status === "favorite" ? "fill-yellow-400 text-yellow-400" : ""}`} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateStatus(annonce.id, "archived")}>
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
