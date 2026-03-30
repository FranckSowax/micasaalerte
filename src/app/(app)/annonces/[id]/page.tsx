import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatPrice,
  formatDate,
  getTypeBienLabel,
  getTypeOffreLabel,
  getStatusColor,
} from "@/lib/utils";
import {
  ArrowLeft,
  MapPin,
  Phone,
  MessageSquare,
  Mail,
  ExternalLink,
  Home,
  Bed,
  Bath,
  Maximize,
} from "lucide-react";
import Link from "next/link";
import { AnnonceActions } from "./actions";
import type { Annonce } from "@/types/database";

export default async function AnnonceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("annonces")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!data) notFound();
  const annonce = data as unknown as Annonce;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Link href="/annonces">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">
            {annonce.type_offre && <span className="capitalize">{getTypeOffreLabel(annonce.type_offre)}</span>}
            {annonce.type_bien && <span> - {getTypeBienLabel(annonce.type_bien)}</span>}
          </h1>
          <p className="text-muted-foreground">
            {annonce.quartier && `${annonce.quartier}, `}{annonce.ville}
          </p>
        </div>
        <Badge className={getStatusColor(annonce.status)}>{annonce.status}</Badge>
      </div>

      {/* Images gallery */}
      {annonce.raw_images?.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {annonce.raw_images.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
              <div className="relative aspect-video rounded-lg overflow-hidden bg-secondary border border-border hover:border-primary/50 transition-colors">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Photo ${i + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                    (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="flex items-center justify-center h-full text-xs text-muted-foreground">Image indisponible</div>';
                  }}
                />
              </div>
            </a>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Prix et caractéristiques */}
          <Card>
            <CardContent className="p-6">
              {annonce.prix && (
                <p className="text-3xl font-bold text-primary mb-4">
                  {formatPrice(annonce.prix, annonce.devise)}
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {annonce.nb_pieces && (
                  <div className="flex items-center gap-2">
                    <Home className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{annonce.nb_pieces} pièce(s)</span>
                  </div>
                )}
                {annonce.nb_chambres && (
                  <div className="flex items-center gap-2">
                    <Bed className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{annonce.nb_chambres} chambre(s)</span>
                  </div>
                )}
                {annonce.nb_salles_bain && (
                  <div className="flex items-center gap-2">
                    <Bath className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{annonce.nb_salles_bain} SdB</span>
                  </div>
                )}
                {annonce.superficie && (
                  <div className="flex items-center gap-2">
                    <Maximize className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{annonce.superficie} m²</span>
                  </div>
                )}
              </div>
              {annonce.meuble !== null && (
                <p className="mt-3 text-sm">
                  {annonce.meuble ? "Meublé" : "Non meublé"}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Résumé IA */}
          {annonce.ai_summary && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Résumé IA</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-foreground/90">{annonce.ai_summary}</p>
                {annonce.ai_confidence && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Confiance : {Math.round(annonce.ai_confidence * 100)}%
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Tags */}
          {annonce.ai_tags?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {annonce.ai_tags.map((tag) => (
                <Badge key={tag} variant="outline">{tag}</Badge>
              ))}
            </div>
          )}

          {/* Texte brut */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Texte original</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-foreground/80 whitespace-pre-wrap">{annonce.raw_text}</p>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Contact */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {annonce.telephone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <a href={`tel:${annonce.telephone}`} className="text-sm hover:text-primary">
                    {annonce.telephone}
                  </a>
                </div>
              )}
              {annonce.whatsapp && (
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <a
                    href={`https://wa.me/${annonce.whatsapp.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm hover:text-primary"
                  >
                    {annonce.whatsapp}
                  </a>
                </div>
              )}
              {annonce.email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a href={`mailto:${annonce.email}`} className="text-sm hover:text-primary">
                    {annonce.email}
                  </a>
                </div>
              )}
              {annonce.fb_author_name && (
                <p className="text-sm text-muted-foreground">
                  Publié par : {annonce.fb_author_name}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Localisation */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Localisation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  {annonce.quartier && <p className="text-sm">{annonce.quartier}</p>}
                  <p className="text-sm">{annonce.ville}</p>
                  {annonce.adresse_complete && (
                    <p className="text-xs text-muted-foreground">{annonce.adresse_complete}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <AnnonceActions annonce={annonce} />

          {/* Liens */}
          {annonce.fb_post_url && (
            <a
              href={annonce.fb_post_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" className="w-full">
                <ExternalLink className="h-4 w-4 mr-2" />
                Voir sur Facebook
              </Button>
            </a>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Ajoutée le {formatDate(annonce.created_at)}
          </p>
        </div>
      </div>
    </div>
  );
}
