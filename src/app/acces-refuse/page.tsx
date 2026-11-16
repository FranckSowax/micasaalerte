"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

// Compte connecté mais non autorisé comme agent (voir lib/agent-access).
export default function AccessDeniedPage() {
  const [leaving, setLeaving] = useState(false);
  const logout = async () => {
    setLeaving(true);
    await createClient().auth.signOut();
    window.location.href = "/";
  };

  return (
    <div className="theme-light min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md text-center">
        <CardContent className="p-8 space-y-4">
          <BrandLogo variant="green" className="h-12 w-auto mx-auto" />
          <h1 className="text-xl font-bold">Accès réservé</h1>
          <p className="text-sm text-muted-foreground">
            Ce compte n&apos;a pas accès à l&apos;espace agent. Si vous travaillez avec Mi Casa Gabon, demandez à
            l&apos;administrateur d&apos;autoriser votre adresse email.
          </p>
          <p className="text-sm text-muted-foreground">
            Vous cherchez un logement ?{" "}
            <Link href="/signup" className="text-primary underline underline-offset-2">Créez votre alerte</Link>.
          </p>
          <Button variant="outline" className="w-full" onClick={logout} disabled={leaving}>
            Se déconnecter
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
