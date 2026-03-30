"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Eye, EyeOff } from "lucide-react";
import type { Profile } from "@/types/database";

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    whatsapp_phone: "",
    rapidapi_key: "",
    kimi_api_key: "",
    whatsapp_phone_number_id: "",
    whatsapp_access_token: "",
  });
  const supabase = createClient();

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (data) {
        setProfile(data);
        setForm({
          full_name: data.full_name || "",
          whatsapp_phone: data.whatsapp_phone || "",
          rapidapi_key: data.rapidapi_key || "",
          kimi_api_key: data.kimi_api_key || "",
          whatsapp_phone_number_id: data.whatsapp_phone_number_id || "",
          whatsapp_access_token: data.whatsapp_access_token || "",
        });
      }
      setLoading(false);
    };
    fetchProfile();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: form.full_name,
        whatsapp_phone: form.whatsapp_phone,
        rapidapi_key: form.rapidapi_key || null,
        kimi_api_key: form.kimi_api_key || null,
        whatsapp_phone_number_id: form.whatsapp_phone_number_id || null,
        whatsapp_access_token: form.whatsapp_access_token || null,
      })
      .eq("id", profile!.id);

    if (error) {
      setMessage("Erreur: " + error.message);
    } else {
      setMessage("Paramètres sauvegardés !");
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">Paramètres</h1>
        <p className="text-muted-foreground mt-1">Configurez votre compte et vos intégrations</p>
      </div>

      {message && (
        <div className={`p-3 rounded-md text-sm ${message.includes("Erreur") ? "bg-destructive/10 text-destructive" : "bg-green-500/10 text-green-400"}`}>
          {message}
        </div>
      )}

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Profil</CardTitle>
          <CardDescription>Vos informations personnelles</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Email</label>
            <Input value={profile?.email || ""} disabled />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Nom complet</label>
            <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Téléphone WhatsApp</label>
            <Input placeholder="+24177000000" value={form.whatsapp_phone} onChange={(e) => setForm({ ...form, whatsapp_phone: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Plan :</span>
            <Badge>{profile?.plan || "free"}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Clés API</CardTitle>
              <CardDescription>Configurez vos clés pour le scraping et l&apos;IA</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowKeys(!showKeys)}>
              {showKeys ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
              {showKeys ? "Masquer" : "Afficher"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Clé RapidAPI</label>
            <Input
              type={showKeys ? "text" : "password"}
              placeholder="Votre clé RapidAPI"
              value={form.rapidapi_key}
              onChange={(e) => setForm({ ...form, rapidapi_key: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Pour le scraping des groupes Facebook</p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Clé Kimi (Moonshot AI)</label>
            <Input
              type={showKeys ? "text" : "password"}
              placeholder="sk-..."
              value={form.kimi_api_key}
              onChange={(e) => setForm({ ...form, kimi_api_key: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Pour l&apos;analyse IA des annonces (Kimi K2.5)</p>
          </div>
        </CardContent>
      </Card>

      {/* WhatsApp Business */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">WhatsApp Business</CardTitle>
          <CardDescription>Configuration de l&apos;API WhatsApp Cloud</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Phone Number ID</label>
            <Input
              type={showKeys ? "text" : "password"}
              placeholder="1234567890"
              value={form.whatsapp_phone_number_id}
              onChange={(e) => setForm({ ...form, whatsapp_phone_number_id: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Access Token</label>
            <Input
              type={showKeys ? "text" : "password"}
              placeholder="EAAx..."
              value={form.whatsapp_access_token}
              onChange={(e) => setForm({ ...form, whatsapp_access_token: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
        Sauvegarder
      </Button>
    </div>
  );
}
