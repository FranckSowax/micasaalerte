"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star, Archive, Send, Loader2 } from "lucide-react";
import type { Annonce } from "@/types/database";

export function AnnonceActions({ annonce }: { annonce: Annonce }) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const supabase = createClient();

  const updateStatus = async (status: "new" | "sent" | "archived" | "favorite") => {
    await supabase.from("annonces").update({ status }).eq("id", annonce.id);
    router.refresh();
  };

  const sendWhatsApp = async () => {
    setSending(true);
    setMessage("");
    try {
      const res = await fetch(`/api/whatsapp/send/${annonce.id}`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage("Envoyé avec succès !");
        router.refresh();
      } else {
        setMessage(data.error || "Erreur d'envoi");
      }
    } catch {
      setMessage("Erreur de connexion");
    }
    setSending(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button
          variant={annonce.status === "favorite" ? "default" : "outline"}
          className="w-full"
          onClick={() => updateStatus(annonce.status === "favorite" ? "new" : "favorite")}
        >
          <Star className={`h-4 w-4 mr-2 ${annonce.status === "favorite" ? "fill-current" : ""}`} />
          {annonce.status === "favorite" ? "Retirer des favoris" : "Ajouter aux favoris"}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => updateStatus("archived")}
        >
          <Archive className="h-4 w-4 mr-2" />
          Archiver
        </Button>
        <Button className="w-full" onClick={sendWhatsApp} disabled={sending}>
          {sending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          Envoyer par WhatsApp
        </Button>
        {message && (
          <p className={`text-sm text-center ${message.includes("succès") ? "text-green-400" : "text-destructive"}`}>
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
