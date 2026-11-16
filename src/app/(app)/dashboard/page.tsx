export const dynamic = "force-dynamic";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { dailyVolumes, volumeZone, VOLUME_HIGH_AT, VOLUME_MODERATE_AT, type SendRow } from "@/lib/whatsapp-volume";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Star, Send, TrendingUp, MessageCircle } from "lucide-react";
import { formatPrice, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import type { Annonce, FacebookGroup, DashboardStats } from "@/types/database";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: statsData } = await supabase
    .from("v_dashboard_stats")
    .select("*")
    .eq("user_id", user.id)
    .single();
  const stats = statsData as unknown as DashboardStats | null;

  const { data: annoncesData } = await supabase
    .from("annonces")
    .select("*")
    .eq("user_id", user.id)
    .eq("ai_is_real_estate", true)
    .order("created_at", { ascending: false })
    .limit(5);
  const recentAnnonces = (annoncesData || []) as unknown as Annonce[];

  const { data: groupsData } = await supabase
    .from("facebook_groups")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const groups = (groupsData || []) as unknown as FacebookGroup[];

  // Messages WhatsApp envoyés par le numéro de la plateforme (tous types), 14 derniers jours.
  // Lecture par pages de 1 000 lignes : c'est le maximum renvoyé par Supabase en une fois.
  const service = createServiceClient();
  const since = new Date(Date.now() - 15 * 86_400_000).toISOString();
  const sendRows: SendRow[] = [];
  for (let page = 0; page < 40; page++) {
    const { data } = await service
      .from("whatsapp_logs")
      .select("sent_at, status")
      .gte("sent_at", since)
      .order("sent_at", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    sendRows.push(...((data || []) as SendRow[]));
    if (!data || data.length < 1000) break;
  }
  const volumes = dailyVolumes(sendRows, new Date(), 14);
  const today = volumes[volumes.length - 1];
  const zone = volumeZone(today.sent);
  const peak = Math.max(VOLUME_MODERATE_AT, ...volumes.map((v) => v.sent + v.failed));
  const zoneStyle = {
    faible: "bg-green-500/15 text-green-500 border-green-500/30",
    modéré: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    élevé: "bg-red-500/15 text-red-500 border-red-500/30",
  }[zone];
  const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });

  const kpis = [
    {
      title: "Total annonces",
      value: stats?.total_annonces ?? 0,
      icon: Building2,
      color: "text-blue-400",
    },
    {
      title: "Nouvelles (24h)",
      value: stats?.nouvelles_24h ?? 0,
      icon: TrendingUp,
      color: "text-green-400",
    },
    {
      title: "Favoris",
      value: stats?.favoris ?? 0,
      icon: Star,
      color: "text-yellow-400",
    },
    {
      title: "Envoyées WhatsApp",
      value: stats?.envoyees_whatsapp ?? 0,
      icon: Send,
      color: "text-purple-400",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Vue d&apos;ensemble de vos alertes immobilières</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.title}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.title}</p>
                  <p className="text-3xl font-bold mt-1">{kpi.value}</p>
                </div>
                <kpi.icon className={`h-10 w-10 ${kpi.color} opacity-80`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Volume WhatsApp */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-green-500" aria-hidden="true" /> Messages WhatsApp envoyés
            </CardTitle>
            <Badge variant="outline" className={zoneStyle}>Risque {zone}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
            <div>
              <p className="text-4xl font-bold tabular-nums">{today.sent}</p>
              <p className="text-sm text-muted-foreground">
                aujourd&apos;hui{today.failed ? ` · ${today.failed} échec${today.failed > 1 ? "s" : ""}` : ""}
              </p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums">{Math.round(volumes.slice(-7).reduce((n, v) => n + v.sent, 0) / 7)}</p>
              <p className="text-sm text-muted-foreground">par jour en moyenne (7 jours)</p>
            </div>
          </div>
          {/* Histogramme des 14 derniers jours ; ligne pointillée = début de la zone à surveiller. */}
          <div className="relative h-32">
            <div
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-amber-500/60"
              style={{ bottom: `${(VOLUME_MODERATE_AT / peak) * 100}%` }}
              aria-hidden="true"
            />
            <div className="flex h-full items-end gap-1.5" role="img" aria-label={`Messages envoyés sur 14 jours, ${today.sent} aujourd'hui`}>
              {volumes.map((v) => (
                <div
                  key={v.day}
                  className="flex h-full flex-1 flex-col justify-end"
                  title={`${dayLabel(v.day)} : ${v.sent} envoyé${v.sent > 1 ? "s" : ""}${v.failed ? `, ${v.failed} échec(s)` : ""}`}
                >
                  {v.failed > 0 && <div className="w-full rounded-t-sm bg-red-500/70" style={{ height: `${(v.failed / peak) * 100}%` }} />}
                  <div
                    className={`w-full ${v.failed ? "" : "rounded-t-sm"} ${v.sent >= VOLUME_HIGH_AT ? "bg-red-500" : v.sent >= VOLUME_MODERATE_AT ? "bg-amber-500" : "bg-green-500"}`}
                    style={{ height: `${Math.max(v.sent ? 2 : 0, (v.sent / peak) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="flex h-3 gap-1.5 text-[10px] text-muted-foreground">
            {volumes.map((v, i) => (
              <span key={v.day} className="flex-1 overflow-hidden whitespace-nowrap text-center">
                {(volumes.length - 1 - i) % 2 === 0 ? dayLabel(v.day) : ""}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Tous les messages du numéro WhatsApp : alertes, codes de connexion, paiements, diffusions. Repères indicatifs (WhatsApp ne publie
            aucun seuil) : moins de {VOLUME_MODERATE_AT} par jour, risque faible ; de {VOLUME_MODERATE_AT} à {VOLUME_HIGH_AT}, à surveiller ;
            au-delà, passez à l&apos;API officielle WhatsApp Business.
          </p>
        </CardContent>
      </Card>

      {/* Prix moyens */}
      {(stats?.prix_moyen_location || stats?.prix_moyen_vente) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {stats?.prix_moyen_location && (
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Prix moyen location</p>
                <p className="text-2xl font-bold mt-1 text-primary">
                  {formatPrice(Math.round(stats.prix_moyen_location))}
                </p>
              </CardContent>
            </Card>
          )}
          {stats?.prix_moyen_vente && (
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Prix moyen vente</p>
                <p className="text-2xl font-bold mt-1 text-primary">
                  {formatPrice(Math.round(stats.prix_moyen_vente))}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Dernières annonces */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Dernières annonces</CardTitle>
          </CardHeader>
          <CardContent>
            {!recentAnnonces?.length ? (
              <p className="text-muted-foreground text-sm">
                Aucune annonce pour le moment. Ajoutez un groupe Facebook et lancez une collecte.
              </p>
            ) : (
              <div className="space-y-3">
                {recentAnnonces.map((a) => (
                  <Link
                    key={a.id}
                    href={`/annonces/${a.id}`}
                    className="block p-3 rounded-md bg-background hover:bg-accent transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {a.type_offre && <span className="capitalize">{a.type_offre}</span>}
                          {a.type_bien && <span> - {a.type_bien}</span>}
                          {!a.type_offre && !a.type_bien && "Annonce"}
                        </p>
                        <p className="text-sm text-muted-foreground truncate">
                          {a.quartier && `${a.quartier}, `}{a.ville}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {a.prix && (
                          <p className="font-semibold text-primary text-sm">
                            {formatPrice(a.prix, a.devise)}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {formatDate(a.created_at)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Groupes surveillés */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Groupes surveillés</CardTitle>
          </CardHeader>
          <CardContent>
            {!groups?.length ? (
              <div className="text-center py-4">
                <p className="text-muted-foreground text-sm mb-3">Aucun groupe configuré</p>
                <Link href="/groupes">
                  <Badge className="cursor-pointer">Ajouter un groupe</Badge>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {groups.map((g) => (
                  <div key={g.id} className="flex items-center justify-between p-3 rounded-md bg-background">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{g.group_name}</p>
                      <p className="text-xs text-muted-foreground">
                        Dernière collecte : {g.last_scraped_at ? formatDate(g.last_scraped_at) : "Jamais"}
                      </p>
                    </div>
                    <Badge variant={g.is_active ? "default" : "secondary"}>
                      {g.is_active ? "Actif" : "Inactif"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
