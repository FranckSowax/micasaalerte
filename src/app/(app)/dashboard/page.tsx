export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Star, Send, TrendingUp } from "lucide-react";
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
