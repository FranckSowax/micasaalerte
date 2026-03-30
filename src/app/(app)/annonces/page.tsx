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
import { Star, Archive, Send, Loader2, Search, X } from "lucide-react";
import Link from "next/link";
import type { Annonce } from "@/types/database";

const TYPE_OFFRE_OPTIONS = ["location", "vente", "colocation", "sous-location", "recherche"];
const TYPE_BIEN_OPTIONS = ["appartement", "maison", "studio", "chambre", "terrain", "bureau", "villa"];
const STATUS_OPTIONS = ["new", "sent", "archived", "favorite"];

export default function AnnoncesPage() {
  const [annonces, setAnnonces] = useState<Annonce[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    type_offre: "",
    type_bien: "",
    status: "",
    prix_min: "",
    prix_max: "",
    quartier: "",
    search: "",
  });
  const supabase = createClient();

  const fetchAnnonces = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("annonces")
      .select("*")
      .eq("ai_is_real_estate", true)
      .order("created_at", { ascending: false })
      .limit(50);

    if (filters.type_offre) query = query.eq("type_offre", filters.type_offre);
    if (filters.type_bien) query = query.eq("type_bien", filters.type_bien);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.prix_min) query = query.gte("prix", Number(filters.prix_min));
    if (filters.prix_max) query = query.lte("prix", Number(filters.prix_max));
    if (filters.quartier) query = query.ilike("quartier", `%${filters.quartier}%`);
    if (filters.search) query = query.or(`raw_text.ilike.%${filters.search}%,ai_summary.ilike.%${filters.search}%`);

    const { data } = await query;
    setAnnonces(data || []);
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
    setFilters({
      type_offre: "",
      type_bien: "",
      status: "",
      prix_min: "",
      prix_max: "",
      quartier: "",
      search: "",
    });
  };

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Annonces</h1>
        <p className="text-muted-foreground mt-1">
          {annonces.length} annonce{annonces.length !== 1 ? "s" : ""} trouvée{annonces.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <div className="relative col-span-2 sm:col-span-3 lg:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="pl-9"
              />
            </div>
            <select
              value={filters.type_offre}
              onChange={(e) => setFilters({ ...filters, type_offre: e.target.value })}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Type d&apos;offre</option>
              {TYPE_OFFRE_OPTIONS.map((o) => (
                <option key={o} value={o}>{getTypeOffreLabel(o)}</option>
              ))}
            </select>
            <select
              value={filters.type_bien}
              onChange={(e) => setFilters({ ...filters, type_bien: e.target.value })}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Type de bien</option>
              {TYPE_BIEN_OPTIONS.map((b) => (
                <option key={b} value={b}>{getTypeBienLabel(b)}</option>
              ))}
            </select>
            <Input
              type="number"
              placeholder="Prix min"
              value={filters.prix_min}
              onChange={(e) => setFilters({ ...filters, prix_min: e.target.value })}
            />
            <Input
              type="number"
              placeholder="Prix max"
              value={filters.prix_max}
              onChange={(e) => setFilters({ ...filters, prix_max: e.target.value })}
            />
            <Input
              placeholder="Quartier"
              value={filters.quartier}
              onChange={(e) => setFilters({ ...filters, quartier: e.target.value })}
            />
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Statut</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s === "new" ? "Nouveau" : s === "sent" ? "Envoyé" : s === "archived" ? "Archivé" : "Favori"}</option>
              ))}
            </select>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="mt-2">
              <X className="h-4 w-4 mr-1" /> Effacer les filtres
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Annonces grid */}
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
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {annonces.map((annonce) => (
            <Link key={annonce.id} href={`/annonces/${annonce.id}`}>
              <Card className="hover:border-primary/50 transition-colors h-full">
                <CardContent className="p-4 flex flex-col h-full">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex gap-2 flex-wrap">
                      {annonce.type_offre && (
                        <Badge variant="outline" className="capitalize">
                          {getTypeOffreLabel(annonce.type_offre)}
                        </Badge>
                      )}
                      {annonce.type_bien && (
                        <Badge variant="secondary" className="capitalize">
                          {getTypeBienLabel(annonce.type_bien)}
                        </Badge>
                      )}
                    </div>
                    <Badge className={getStatusColor(annonce.status)}>
                      {annonce.status}
                    </Badge>
                  </div>

                  {annonce.prix && (
                    <p className="text-xl font-bold text-primary mb-1">
                      {formatPrice(annonce.prix, annonce.devise)}
                    </p>
                  )}

                  <p className="text-sm text-muted-foreground mb-2">
                    {annonce.quartier && `${annonce.quartier}, `}{annonce.ville}
                    {annonce.nb_chambres && ` | ${annonce.nb_chambres} ch.`}
                    {annonce.nb_pieces && ` | ${annonce.nb_pieces} p.`}
                    {annonce.meuble && " | Meublé"}
                  </p>

                  {annonce.ai_summary && (
                    <p className="text-sm text-foreground/80 flex-1 line-clamp-2 mb-3">
                      {annonce.ai_summary}
                    </p>
                  )}

                  {annonce.ai_tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {annonce.ai_tags.slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-border">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(annonce.created_at)}
                    </span>
                    <div className="flex gap-1" onClick={(e) => e.preventDefault()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => updateStatus(annonce.id, annonce.status === "favorite" ? "new" : "favorite")}
                      >
                        <Star className={`h-3.5 w-3.5 ${annonce.status === "favorite" ? "fill-yellow-400 text-yellow-400" : ""}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => updateStatus(annonce.id, "archived")}
                      >
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
