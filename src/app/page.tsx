import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Home,
  Search,
  Brain,
  MessageSquare,
  BarChart3,
  Zap,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Home className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold text-primary">Mi Casa Alerte</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost">Connexion</Button>
            </Link>
            <Link href="/signup">
              <Button>S&apos;inscrire</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-6xl font-bold mb-6 leading-tight">
            Ne manquez plus aucune{" "}
            <span className="text-primary">annonce immobilière</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Mi Casa Alerte scrape automatiquement les groupes Facebook, analyse les annonces avec l&apos;IA
            et vous les envoie sur WhatsApp en temps réel.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/signup">
              <Button size="lg" className="text-lg px-8">
                Commencer gratuitement
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4 bg-card/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            Comment ça marche ?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: Search,
                title: "Scraping automatique",
                desc: "Surveillez les groupes Facebook immobiliers au Gabon. Les nouvelles annonces sont collectées automatiquement.",
              },
              {
                icon: Brain,
                title: "Analyse IA intelligente",
                desc: "Claude IA extrait prix, quartier, type de bien, nombre de pièces et toutes les infos clés de chaque annonce.",
              },
              {
                icon: MessageSquare,
                title: "Alertes WhatsApp",
                desc: "Recevez les annonces qui vous intéressent directement sur WhatsApp, filtrées selon vos critères.",
              },
            ].map((feature) => (
              <Card key={feature.title} className="bg-card border-border">
                <CardContent className="p-6 text-center">
                  <feature.icon className="h-12 w-12 text-primary mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm">{feature.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* More features */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            Tout ce dont vous avez besoin
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: BarChart3, title: "Dashboard complet", desc: "Statistiques en temps réel sur vos annonces" },
              { icon: Zap, title: "Filtres avancés", desc: "Triez par prix, quartier, type de bien et plus" },
              { icon: Search, title: "Multi-groupes", desc: "Surveillez plusieurs groupes Facebook simultanément" },
              { icon: Brain, title: "Détection intelligente", desc: "L'IA distingue les vraies annonces du bruit" },
              { icon: MessageSquare, title: "Multi-canaux", desc: "Envoyez à différents contacts avec des filtres" },
              { icon: CheckCircle2, title: "Favoris", desc: "Sauvegardez et organisez vos annonces préférées" },
            ].map((feature) => (
              <div key={feature.title} className="flex items-start gap-3 p-4">
                <feature.icon className="h-6 w-6 text-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-medium mb-1">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20 px-4 bg-card/50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Tarifs</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
            <Card className="border-border">
              <CardContent className="p-8">
                <h3 className="text-xl font-bold mb-2">Free</h3>
                <p className="text-3xl font-bold mb-4">0 FCFA<span className="text-sm font-normal text-muted-foreground">/mois</span></p>
                <ul className="space-y-2 mb-6">
                  {["2 groupes Facebook", "50 annonces/mois", "1 canal WhatsApp", "Analyse IA basique"].map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-primary" /> {f}
                    </li>
                  ))}
                </ul>
                <Link href="/signup">
                  <Button variant="outline" className="w-full">Commencer</Button>
                </Link>
              </CardContent>
            </Card>
            <Card className="border-primary">
              <CardContent className="p-8">
                <h3 className="text-xl font-bold mb-2 text-primary">Pro</h3>
                <p className="text-3xl font-bold mb-4">15 000 FCFA<span className="text-sm font-normal text-muted-foreground">/mois</span></p>
                <ul className="space-y-2 mb-6">
                  {["Groupes illimités", "Annonces illimitées", "Canaux WhatsApp illimités", "Analyse IA avancée", "Collecte automatique", "Support prioritaire"].map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-primary" /> {f}
                    </li>
                  ))}
                </ul>
                <Link href="/signup">
                  <Button className="w-full">Commencer l&apos;essai</Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">
            Prêt à ne plus rater d&apos;annonces ?
          </h2>
          <p className="text-muted-foreground mb-8">
            Rejoignez Mi Casa Alerte et trouvez votre prochain bien immobilier avant tout le monde.
          </p>
          <Link href="/signup">
            <Button size="lg" className="text-lg px-8">
              Créer mon compte
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Home className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium text-primary">Mi Casa Alerte</span>
          </div>
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Mi Casa Alerte. Tous droits réservés.
          </p>
        </div>
      </footer>
    </div>
  );
}
