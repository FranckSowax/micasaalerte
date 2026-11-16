"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Eye, Film, ImageIcon, Loader2, Megaphone, Pause, Play, Plus, Save, Send, Settings2, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DripChannel, DripConfig, MediaItem } from "@/lib/diffusion";
import { VOLUME_HIGH_AT, VOLUME_MODERATE_AT } from "@/lib/whatsapp-volume";

// Onglet Diffusion : campagnes qui publient les annonces par quartier et la médiathèque dans un
// groupe WhatsApp, et en option sur le statut, une chaîne, Facebook et Instagram.

interface CampaignSummary {
  slot: number;
  title: string;
  enabled: boolean;
  group_name: string | null;
  quartiers: string[];
  products: { enabled: boolean; hours: number[] };
  announcements: { enabled: boolean; hours: number[]; per_slot: number };
  extra_channels: DripChannel[];
  last_run_at: string | null;
}

interface Payload {
  installed: boolean;
  error?: string;
  campaigns: CampaignSummary[];
  totals: Record<DripChannel, number>;
  whatsapp: { ok: boolean; status: string; message: string | null };
  groups: { id: string; name: string; participantsCount: number | null }[];
  groups_stale: boolean;
  channels: { id: string; name: string; subscribers: number | null }[];
  quartiers: { quartier: string; count: number }[];
  media: MediaItem[];
  ready: Record<DripChannel, boolean>;
  next_free_slot: number | null;
  slot?: number;
  config?: DripConfig | null;
  categories?: number;
  next?: { quartier: string; index: number; total: number; header: string; products: { id: string; imageUrl: string; caption: string }[] } | null;
  next_batch?: { item: MediaItem; caption: string }[];
  volume?: Record<DripChannel, number>;
  recent?: { note: string; done_by: string; done_at: string }[];
}

const CHANNEL_LABELS: Record<DripChannel, string> = { group: "Groupe", status: "Statut WhatsApp", channel: "Chaîne WhatsApp", facebook: "Facebook", instagram: "Instagram" };
const EXTRA: DripChannel[] = ["status", "channel", "facebook", "instagram"];
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { timeZone: "Africa/Libreville", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
const hoursLabel = (h: number[]) => h.map((x) => `${x}h`).join(", ");

const SKIP_TEXT: Record<string, string> = {
  disabled: "Rien n'est parti : la campagne ou ce flux est coupé.",
  not_configured: "Rien n'est parti : aucun canal coché pour ce flux.",
  no_publishable_category: "Rien n'est parti : aucune annonce publiable (quartier, prix, photo, moins de 60 h) dans les quartiers choisis.",
  no_media: "Rien n'est parti : aucun visuel actif dans la sélection de la médiathèque.",
  already_sent_this_hour: "Déjà publié dans cette heure.",
  missing: "Campagne introuvable.",
};

function HourPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Heures de publication">
      {Array.from({ length: 24 }, (_, h) => {
        const on = value.includes(h);
        return (
          <button
            key={h}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const next = on ? value.filter((x) => x !== h) : [...value, h].sort((a, b) => a - b);
              if (next.length) onChange(next); // au moins une heure
            }}
            className={`h-8 w-11 rounded-md text-xs font-semibold border ${on ? "bg-primary text-primary-foreground border-primary" : "border-input text-muted-foreground hover:bg-accent"}`}
          >
            {h}h
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="inline-flex items-center gap-2 text-sm font-medium">
      <span className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-primary" : "bg-muted"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

export default function DiffusionPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [draft, setDraft] = useState<DripConfig | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (s: number | null) => {
    const res = await fetch(`/api/diffusion${s ? `?slot=${s}` : ""}`, { cache: "no-store" });
    const json = (await res.json()) as Payload;
    setData(json);
    if (s && json.config) {
      setDraft(json.config);
      setSaved(JSON.stringify(json.config));
    }
  }, []);

  useEffect(() => {
    load(slot);
  }, [load, slot]);

  const dirty = !!draft && JSON.stringify(draft) !== saved;
  const set = <K extends keyof DripConfig>(k: K, v: DripConfig[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const totalWa = useMemo(() => (data?.totals ? data.totals.group + data.totals.status + data.totals.channel : 0), [data]);

  const save = async () => {
    if (!draft || !slot) return;
    setBusy("save");
    setNotice(null);
    const res = await fetch("/api/diffusion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slot, ...draft }) });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setNotice({ ok: false, text: json.error || "Enregistrement impossible" });
    setNotice({ ok: true, text: "Campagne enregistrée." });
    await load(slot);
  };

  const create = async () => {
    setBusy("create");
    const res = await fetch("/api/diffusion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ create: true }) });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setNotice({ ok: false, text: json.error });
    setSlot(json.slot);
  };

  const toggleCampaign = async (s: number, enabled: boolean) => {
    await fetch("/api/diffusion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slot: s, enabled }) });
    await load(slot);
  };

  const remove = async () => {
    if (!slot || !confirm("Supprimer cette campagne ? Son journal reste consultable.")) return;
    await fetch(`/api/diffusion?slot=${slot}`, { method: "DELETE" });
    setSlot(null);
    setDraft(null);
  };

  const run = async (flux: "products" | "announcements", dry: boolean) => {
    if (!slot) return;
    setBusy(`${flux}-${dry}`);
    setNotice(null);
    const res = await fetch("/api/diffusion/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slot, flux, dry }) });
    const json = await res.json();
    setBusy(null);
    const r = json.results?.[0]?.result;
    if (!res.ok) setNotice({ ok: false, text: json.error || "Échec" });
    else if (r?.sent) setNotice({ ok: true, text: `Publié : ${r.summary}` });
    else if (r?.dry) setNotice({ ok: true, text: "Aperçu prêt : voir « Prochain envoi » ci-dessus (rien n'est parti)." });
    else setNotice({ ok: false, text: SKIP_TEXT[r?.skipped] || `Rien n'est parti (${r?.skipped ?? "?"})` });
    await load(slot);
  };

  if (!data) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data.installed) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">Diffusion</h1>
        <Card className="border-amber-500/50">
          <CardContent className="p-6 text-sm">{data.error}</CardContent>
        </Card>
      </div>
    );
  }

  const banner = !data.whatsapp.ok && (
    <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400" role="alert">
      <AlertTriangle className="h-5 w-5 shrink-0" />
      <p>{data.whatsapp.message} Facebook et Instagram continuent de publier s&apos;ils sont configurés.</p>
    </div>
  );

  // ---------------- Vue d'ensemble ----------------
  if (!slot || !draft) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Megaphone className="h-7 w-7 text-primary" /> Diffusion</h1>
          <p className="text-muted-foreground mt-1 max-w-3xl">
            Un groupe WhatsApp = une campagne. Chaque campagne publie dans son groupe les <b>annonces récentes par quartier</b> (moins de 60 h, avec
            photo et prix) et les <b>visuels de la médiathèque</b> (photos, vidéos), aux heures choisies, avec le lien d&apos;inscription. Le statut
            WhatsApp, une chaîne, Facebook et Instagram sont des options à cocher.
          </p>
        </div>
        {banner}
        {notice && <p className={`text-sm ${notice.ok ? "text-primary" : "text-red-400"}`}>{notice.text}</p>}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.campaigns.map((c) => (
            <Card key={c.slot} className={c.enabled ? "border-primary/60" : ""}>
              <CardContent className="p-5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" className="text-left" onClick={() => setSlot(c.slot)}>
                    <p className="font-semibold text-lg hover:underline">{c.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.group_name ?? "aucun groupe"} · {c.quartiers.length ? c.quartiers.join(", ") : "tous les quartiers"}
                    </p>
                  </button>
                  <Badge variant="outline" className={c.enabled ? "border-primary/50 text-primary" : ""}>{c.enabled ? "active" : "en pause"}</Badge>
                </div>
                <p className="text-sm">{c.products.enabled ? `Annonces ${c.products.hours.length}×/jour (${hoursLabel(c.products.hours)})` : "Annonces : désactivées"}</p>
                <p className="text-sm">
                  {c.announcements.enabled
                    ? `Médiathèque ${c.announcements.hours.length}×/jour (${hoursLabel(c.announcements.hours)}) · ${c.announcements.per_slot} par envoi`
                    : "Médiathèque : désactivée"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {c.extra_channels.length ? (
                    c.extra_channels.map((x) => <Badge key={x} variant="outline">+ {CHANNEL_LABELS[x]}</Badge>)
                  ) : (
                    <span className="text-xs text-muted-foreground">Groupe seulement</span>
                  )}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground">{c.last_run_at ? `Dernier envoi ${fmtDate(c.last_run_at)}` : "Jamais publiée"}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => toggleCampaign(c.slot, !c.enabled)}>
                      {c.enabled ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />} {c.enabled ? "Pause" : "Activer"}
                    </Button>
                    <Button size="sm" onClick={() => setSlot(c.slot)}><Settings2 className="h-4 w-4 mr-1" /> Régler</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <button
            type="button"
            onClick={create}
            disabled={!data.next_free_slot || busy === "create"}
            className="rounded-xl border-2 border-dashed border-border p-6 text-center text-muted-foreground hover:border-primary/60 hover:text-foreground disabled:opacity-50 disabled:hover:border-border"
          >
            {busy === "create" ? <Loader2 className="h-6 w-6 mx-auto animate-spin" /> : <Plus className="h-6 w-6 mx-auto" />}
            <p className="mt-2 font-semibold">Nouvelle campagne</p>
            <p className="text-xs">{data.next_free_slot ? `Emplacement ${data.next_free_slot} sur 12` : "Les 12 emplacements sont pris"}</p>
          </button>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-lg">Publications par jour, toutes campagnes actives</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {(Object.keys(CHANNEL_LABELS) as DripChannel[]).map((c) => (
                <div key={c} className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">{CHANNEL_LABELS[c]}</p>
                  <p className="text-2xl font-bold tabular-nums">{data.totals[c]}</p>
                </div>
              ))}
            </div>
            <p className={`text-xs ${totalWa >= VOLUME_HIGH_AT ? "text-red-400" : totalWa >= VOLUME_MODERATE_AT ? "text-amber-400" : "text-muted-foreground"}`}>
              WhatsApp : {totalWa} messages par jour pour la diffusion, qui s&apos;ajoutent aux alertes des abonnés. Le statut, la chaîne, Facebook et
              Instagram reçoivent la somme de toutes les campagnes qui les ont cochés : gardez ces totaux raisonnables (repères : {VOLUME_MODERATE_AT} à
              surveiller, {VOLUME_HIGH_AT} à risque pour le numéro WhatsApp).
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---------------- Éditeur ----------------
  const c = draft;
  const disabledReason = (ch: DripChannel) =>
    !data.ready[ch]
      ? ch === "facebook" || ch === "instagram"
        ? "non configuré (jeton Meta sur Railway)"
        : ch === "channel"
          ? "aucune chaîne WhatsApp administrée"
          : "WhatsApp déconnecté"
      : ch === "channel" && !c.channel_id
        ? "choisissez une chaîne ci-dessus"
        : null;

  return (
    <div className="space-y-6 pb-24">
      <button
        type="button"
        onClick={() => {
          setSlot(null);
          setDraft(null);
          load(null);
        }}
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" /> Toutes les campagnes
      </button>
      <div className="flex flex-wrap items-center gap-3">
        <Input value={c.name ?? ""} placeholder={`Campagne ${slot}`} onChange={(e) => set("name", e.target.value)} className="max-w-sm text-xl font-bold h-11" aria-label="Nom de la campagne" />
        <Toggle on={c.enabled} onChange={(v) => set("enabled", v)} label={c.enabled ? "Active" : "En pause"} />
        <Button variant="outline" size="sm" className="ml-auto text-red-400" onClick={remove}><Trash2 className="h-4 w-4 mr-1" /> Supprimer</Button>
      </div>
      {banner}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-lg">1. Groupe et quartiers</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">
              Groupe WhatsApp {data.groups_stale && <span className="text-xs text-amber-400">(liste en cache : WhatsApp ne répond pas)</span>}
            </label>
            <select value={c.group_id ?? ""} onChange={(e) => set("group_id", e.target.value || null)} className="mt-1 h-10 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm">
              <option value="">— aucun groupe —</option>
              {data.groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}{g.participantsCount ? ` (${g.participantsCount})` : ""}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Le numéro WhatsApp de la plateforme doit être membre (idéalement administrateur) du groupe. Un groupe ne sert qu&apos;à une campagne.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium mb-1">Quartiers diffusés <span className="text-muted-foreground font-normal">(aucun coché = tous)</span></p>
            <div className="flex flex-wrap gap-1.5">
              {data.quartiers.map((q) => {
                const on = c.quartiers.includes(q.quartier);
                return (
                  <button
                    key={q.quartier}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set("quartiers", on ? c.quartiers.filter((x) => x !== q.quartier) : [...c.quartiers, q.quartier])}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-accent"}`}
                  >
                    {q.quartier} <span className="opacity-70">({q.count})</span>
                  </button>
                );
              })}
              {!data.quartiers.length && (
                <p className="text-xs text-muted-foreground">Aucune annonce publiable pour l&apos;instant (il faut un quartier, un prix et une photo, moins de 60 h).</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-lg">2. Annonces par quartier</CardTitle>
          <Toggle on={c.products_enabled} onChange={(v) => set("products_enabled", v)} label={c.products_enabled ? "Activées" : "Coupées"} />
        </CardHeader>
        <CardContent className="space-y-4">
          {!c.products_enabled && (
            <p className="text-sm text-amber-400">Annonces coupées pour ce groupe : rien ne part tant que l&apos;interrupteur n&apos;est pas sur « Activées » (puis Enregistrer).</p>
          )}
          <HourPicker value={c.product_hours} onChange={(v) => set("product_hours", v)} />
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              Annonces par envoi dans le groupe
              <select value={c.per_category} onChange={(e) => set("per_category", Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Position dans la boucle
              <Input
                type="number"
                min={1}
                max={Math.max(1, data.categories ?? 1)}
                value={(c.cursor % Math.max(1, data.categories ?? 1)) + 1}
                onChange={(e) => set("cursor", Math.max(0, Number(e.target.value) - 1))}
                className="w-20 h-9"
              />
              <span className="text-muted-foreground">/ {data.categories ?? 0}</span>
            </label>
          </div>
          {data.next && (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium mb-2">Prochain envoi : {data.next.quartier} ({data.next.index + 1}/{data.next.total})</p>
              <div className="flex gap-2 overflow-x-auto">
                {data.next.products.slice(0, c.per_category).map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p.id} src={p.imageUrl} alt="" className="h-20 w-20 rounded-md object-cover" />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-lg">3. Médiathèque</CardTitle>
          <Toggle on={c.announcements_enabled} onChange={(v) => set("announcements_enabled", v)} label={c.announcements_enabled ? "Activée" : "Coupée"} />
        </CardHeader>
        <CardContent className="space-y-4">
          <HourPicker value={c.media_hours} onChange={(v) => set("media_hours", v)} />
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={c.media_scope === "all"} onChange={() => set("media_scope", "all")} /> Tous les visuels actifs
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={c.media_scope === "selected"} onChange={() => set("media_scope", "selected")} /> Une sélection
            </label>
            <label className="flex items-center gap-2">
              Par créneau
              <select value={c.media_batch} onChange={(e) => set("media_batch", Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2">
                <option value={0}>tous</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} en boucle</option>)}
              </select>
            </label>
          </div>
          <MediaLibrary media={data.media} selected={c.media_ids} selectable={c.media_scope === "selected"} onSelect={(ids) => set("media_ids", ids)} onChanged={() => load(slot)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-lg">4. Publier aussi sur</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-sm font-medium">Chaîne WhatsApp</label>
            <select value={c.channel_id ?? ""} onChange={(e) => set("channel_id", e.target.value || null)} className="mt-1 h-10 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm">
              <option value="">— aucune chaîne —</option>
              {data.channels.map((ch) => (
                <option key={ch.id} value={ch.id}>{ch.name}{ch.subscribers ? ` (${ch.subscribers} abonnés)` : ""}</option>
              ))}
            </select>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground"><th className="py-2 font-medium">Canal</th><th className="font-medium">Annonces</th><th className="font-medium">Médiathèque</th></tr>
            </thead>
            <tbody>
              {EXTRA.map((ch) => {
                const why = disabledReason(ch);
                return (
                  <tr key={ch} className="border-t border-border">
                    <td className="py-2">{CHANNEL_LABELS[ch]}{why && <span className="block text-xs text-muted-foreground">{why}</span>}</td>
                    <td>
                      <input type="checkbox" disabled={!!why} checked={c.products_channels[ch]} onChange={(e) => set("products_channels", { ...c.products_channels, [ch]: e.target.checked })} aria-label={`${CHANNEL_LABELS[ch]} pour les annonces`} />
                    </td>
                    <td>
                      <input type="checkbox" disabled={!!why} checked={c.announce_channels[ch]} onChange={(e) => set("announce_channels", { ...c.announce_channels, [ch]: e.target.checked })} aria-label={`${CHANNEL_LABELS[ch]} pour la médiathèque`} />
                      {(ch === "facebook" || ch === "instagram") && c.announce_channels[ch] && (
                        <select
                          value={c.announce_posts[ch] ? "post" : "story"}
                          onChange={(e) => set("announce_posts", { ...c.announce_posts, [ch]: e.target.value === "post" })}
                          className="ml-2 h-8 rounded-md border border-input bg-background px-2 text-xs"
                        >
                          <option value="story">story seule</option>
                          <option value="post">publication + story</option>
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.volume && (
            <p className="text-xs text-muted-foreground">
              Cette campagne : groupe {data.volume.group}/jour · statut {data.volume.status} · chaîne {data.volume.channel} · Facebook {data.volume.facebook} · Instagram {data.volume.instagram}.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-lg">Journal</CardTitle></CardHeader>
        <CardContent>
          {data.recent?.length ? (
            <ul className="space-y-1.5 text-sm">
              {data.recent.map((r, i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-muted-foreground tabular-nums shrink-0">{fmtDate(r.done_at)}</span>
                  <span className="text-muted-foreground shrink-0">{r.done_by}</span>
                  <span>{r.note}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Aucune publication pour l&apos;instant.</p>
          )}
        </CardContent>
      </Card>

      <div className="fixed bottom-0 left-0 right-0 lg:left-64 z-30 border-t border-border bg-background/95 backdrop-blur px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 max-w-6xl">
          <Button onClick={save} disabled={!dirty || busy === "save"}>
            {busy === "save" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            {dirty ? "Enregistrer" : "Enregistré"}
          </Button>
          <Button variant="outline" onClick={() => run("products", true)} disabled={!!busy}><Eye className="h-4 w-4 mr-1" /> Aperçu</Button>
          <Button variant="outline" onClick={() => run("products", false)} disabled={dirty || !c.enabled || !!busy} title={dirty ? "Enregistrez d'abord" : !c.enabled ? "Campagne en pause" : ""}>
            {busy === "products-false" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />} Publier les annonces
          </Button>
          <Button variant="outline" onClick={() => run("announcements", false)} disabled={dirty || !c.enabled || !!busy} title={dirty ? "Enregistrez d'abord" : !c.enabled ? "Campagne en pause" : ""}>
            {busy === "announcements-false" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />} Publier la médiathèque
          </Button>
          {notice && <span className={`text-sm ${notice.ok ? "text-primary" : "text-red-400"}`}>{notice.text}</span>}
        </div>
      </div>
    </div>
  );
}

function MediaLibrary({
  media,
  selected,
  selectable,
  onSelect,
  onChanged,
}: {
  media: MediaItem[];
  selected: string[];
  selectable: boolean;
  onSelect: (ids: string[]) => void;
  onChanged: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("title", title);
    form.append("caption", caption);
    const res = await fetch("/api/diffusion/media", { method: "POST", body: form });
    const json = await res.json();
    setUploading(false);
    if (!res.ok) return setError(json.error || "Téléversement impossible");
    setFile(null);
    setTitle("");
    setCaption("");
    onChanged();
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    await fetch("/api/diffusion/media", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
    onChanged();
  };
  const del = async (id: string) => {
    if (!confirm("Retirer ce visuel de la médiathèque (toutes campagnes) ?")) return;
    await fetch("/api/diffusion/media", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
        <p className="text-sm font-medium flex items-center gap-1"><Upload className="h-4 w-4" /> Ajouter une photo (≤ 10 Mo) ou une vidéo MP4 (≤ 50 Mo)</p>
        <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        <Input placeholder="Titre (usage interne)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        <textarea
          placeholder="Légende publiée avec le visuel"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={1000}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <Button size="sm" onClick={upload} disabled={!file || uploading}>
          {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Ajouter
        </Button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
      {media.length ? (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {media.map((m) => (
            <li key={m.id} className={`flex gap-3 rounded-lg border border-border p-2 ${m.active ? "" : "opacity-60"}`}>
              <div className="h-16 w-16 shrink-0 rounded-md bg-muted flex items-center justify-center overflow-hidden">
                {m.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Film className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium truncate flex items-center gap-1">
                  {m.kind === "image" ? <ImageIcon className="h-3.5 w-3.5" /> : <Film className="h-3.5 w-3.5" />}
                  {m.title || "Sans titre"}
                </p>
                <p className="text-xs text-muted-foreground line-clamp-2">{m.caption || "Sans légende"}</p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                  {selectable && (
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={selected.includes(m.id)} onChange={(e) => onSelect(e.target.checked ? [...selected, m.id] : selected.filter((x) => x !== m.id))} /> dans cette campagne
                    </label>
                  )}
                  <button type="button" className="underline" onClick={() => patch(m.id, { active: !m.active })}>{m.active ? "Désactiver" : "Activer"}</button>
                  <button type="button" className="underline text-red-400" onClick={() => del(m.id)}>Retirer</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">La médiathèque est vide.</p>
      )}
    </div>
  );
}
