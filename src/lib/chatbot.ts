import { createServiceClient } from "@/lib/supabase/server";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { interpretClientMessage } from "@/lib/ai";
import type { ChatbotConversation, ClientDemand } from "@/types/database";

const ONBOARDING_MESSAGES: Record<string, string> = {
  welcome:
    "Bienvenue sur *Mi Casa Alerte* ! 🏠\nJe vais vous aider à trouver le bien idéal à Libreville.\n\nComment vous appelez-vous ?",
  onboarding_type_offre:
    "Que recherchez-vous ?\n\n1️⃣ Location\n2️⃣ Vente\n3️⃣ Colocation\n\nRépondez avec le numéro ou le mot.",
  onboarding_type_bien:
    "Quel type de bien ?\n\n1️⃣ Appartement\n2️⃣ Maison\n3️⃣ Studio\n4️⃣ Villa\n5️⃣ Chambre\n6️⃣ Terrain\n7️⃣ Peu importe\n\nRépondez avec le numéro ou le mot.",
  onboarding_budget:
    "Quel est votre budget ?\n\nExemples :\n• _150000_ (budget max)\n• _100000-300000_ (fourchette)\n• _0_ (pas de limite)",
  onboarding_quartiers:
    "Quels quartiers vous intéressent ?\n\nExemples : _Angondjé, Okala, Nzeng-Ayong_\n\nTapez _tous_ si pas de préférence.",
  onboarding_chambres:
    "Combien de chambres minimum ?\n\nRépondez avec un nombre (ex: _2_) ou _0_ si pas de minimum.",
  onboarding_exigences:
    "Des exigences particulières ?\n\nExemples : _meublé, climatisé, parking, gardien_\n\nTapez _non_ si aucune.",
};

const TYPE_OFFRE_MAP: Record<string, string> = {
  "1": "location", location: "location", louer: "location",
  "2": "vente", vente: "vente", acheter: "vente", achat: "vente",
  "3": "colocation", colocation: "colocation", coloc: "colocation",
};

const TYPE_BIEN_MAP: Record<string, string> = {
  "1": "appartement", appartement: "appartement", appart: "appartement",
  "2": "maison", maison: "maison",
  "3": "studio", studio: "studio",
  "4": "villa", villa: "villa",
  "5": "chambre", chambre: "chambre",
  "6": "terrain", terrain: "terrain",
  "7": "", "peu importe": "", tout: "", tous: "",
};

export async function handleIncomingMessage(
  userId: string,
  clientPhone: string,
  messageText: string,
  phoneNumberId: string,
  accessToken: string
): Promise<void> {
  const supabase = createServiceClient();

  // Get or create conversation
  const { data: existingConv } = await supabase
    .from("chatbot_conversations")
    .select("*")
    .eq("user_id", userId)
    .eq("client_phone", clientPhone)
    .maybeSingle();

  let conv = existingConv as unknown as ChatbotConversation | null;

  if (!conv) {
    const { data: newConv } = await supabase
      .from("chatbot_conversations")
      .insert({
        user_id: userId,
        client_phone: clientPhone,
        conversation_state: "welcome",
        context: {},
      })
      .select()
      .single();
    conv = newConv as unknown as ChatbotConversation;

    // Send welcome message
    const reply = ONBOARDING_MESSAGES.welcome;
    await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, reply);

    await supabase
      .from("chatbot_conversations")
      .update({ conversation_state: "onboarding_name", last_interaction_at: new Date().toISOString() })
      .eq("id", conv!.id);
    return;
  }

  // Update last interaction
  await supabase
    .from("chatbot_conversations")
    .update({ last_interaction_at: new Date().toISOString() })
    .eq("id", conv.id);

  const text = messageText.trim();
  const state = conv.conversation_state;
  const ctx = (conv.context || {}) as Record<string, unknown>;

  // Handle active state (AI-driven)
  if (state === "active") {
    await handleActiveConversation(supabase, conv, userId, clientPhone, text, phoneNumberId, accessToken);
    return;
  }

  // Handle onboarding states (state machine)
  let reply = "";
  let nextState = state;
  const newCtx = { ...ctx };

  switch (state) {
    case "onboarding_name": {
      newCtx.client_name = text;
      nextState = "onboarding_type_offre";
      reply = `Enchanté ${text} ! 👋\n\n${ONBOARDING_MESSAGES.onboarding_type_offre}`;
      break;
    }

    case "onboarding_type_offre": {
      const mapped = TYPE_OFFRE_MAP[text.toLowerCase()];
      if (mapped === undefined) {
        reply = "Je n'ai pas compris. " + ONBOARDING_MESSAGES.onboarding_type_offre;
        break;
      }
      newCtx.type_offre = mapped;
      nextState = "onboarding_type_bien";
      reply = ONBOARDING_MESSAGES.onboarding_type_bien;
      break;
    }

    case "onboarding_type_bien": {
      const mapped = TYPE_BIEN_MAP[text.toLowerCase()];
      if (mapped === undefined) {
        reply = "Je n'ai pas compris. " + ONBOARDING_MESSAGES.onboarding_type_bien;
        break;
      }
      newCtx.type_bien = mapped;
      nextState = "onboarding_budget";
      reply = ONBOARDING_MESSAGES.onboarding_budget;
      break;
    }

    case "onboarding_budget": {
      const rangeMatch = text.match(/(\d+)\s*[-–à]\s*(\d+)/);
      const singleMatch = text.match(/(\d+)/);
      if (rangeMatch) {
        newCtx.prix_min = parseInt(rangeMatch[1]);
        newCtx.prix_max = parseInt(rangeMatch[2]);
      } else if (singleMatch) {
        const val = parseInt(singleMatch[1]);
        if (val === 0) {
          newCtx.prix_min = null;
          newCtx.prix_max = null;
        } else {
          newCtx.prix_min = null;
          newCtx.prix_max = val;
        }
      } else {
        reply = "Je n'ai pas compris le budget. " + ONBOARDING_MESSAGES.onboarding_budget;
        break;
      }
      nextState = "onboarding_quartiers";
      reply = ONBOARDING_MESSAGES.onboarding_quartiers;
      break;
    }

    case "onboarding_quartiers": {
      if (text.toLowerCase() === "tous" || text.toLowerCase() === "tout" || text.toLowerCase() === "partout") {
        newCtx.quartiers = [];
      } else {
        newCtx.quartiers = text.split(/[,;]+/).map((q: string) => q.trim()).filter(Boolean);
      }
      nextState = "onboarding_chambres";
      reply = ONBOARDING_MESSAGES.onboarding_chambres;
      break;
    }

    case "onboarding_chambres": {
      const num = parseInt(text);
      if (isNaN(num)) {
        reply = "Répondez avec un nombre. " + ONBOARDING_MESSAGES.onboarding_chambres;
        break;
      }
      newCtx.nb_chambres_min = num === 0 ? null : num;
      nextState = "onboarding_exigences";
      reply = ONBOARDING_MESSAGES.onboarding_exigences;
      break;
    }

    case "onboarding_exigences": {
      newCtx.exigences = text.toLowerCase() === "non" ? null : text;
      nextState = "onboarding_confirm";

      // Build summary
      const summary = [
        `*Récapitulatif de votre recherche :*`,
        ``,
        `👤 Nom : ${newCtx.client_name}`,
        `🏷️ Type : ${newCtx.type_offre || "Tous"} - ${newCtx.type_bien || "Tous types"}`,
        newCtx.prix_max ? `💰 Budget : ${newCtx.prix_min ? `${newCtx.prix_min} - ` : "max "}${newCtx.prix_max} FCFA` : `💰 Budget : Sans limite`,
        (newCtx.quartiers as string[])?.length ? `📍 Quartiers : ${(newCtx.quartiers as string[]).join(", ")}` : `📍 Quartiers : Tous`,
        newCtx.nb_chambres_min ? `🛏️ Chambres min : ${newCtx.nb_chambres_min}` : `🛏️ Chambres : Pas de minimum`,
        newCtx.exigences ? `✨ Exigences : ${newCtx.exigences}` : ``,
        ``,
        `C'est correct ? Répondez *oui* ou *non*.`,
      ].filter(Boolean).join("\n");
      reply = summary;
      break;
    }

    case "onboarding_confirm": {
      if (text.toLowerCase().startsWith("oui") || text === "o" || text === "ok") {
        // Create client demand
        await supabase.from("client_demands").upsert({
          user_id: userId,
          client_phone: clientPhone,
          client_name: newCtx.client_name as string,
          is_active: true,
          filter_type_offre: newCtx.type_offre ? [newCtx.type_offre as string] : [],
          filter_type_bien: newCtx.type_bien ? [newCtx.type_bien as string] : [],
          filter_prix_min: (newCtx.prix_min as number) || null,
          filter_prix_max: (newCtx.prix_max as number) || null,
          filter_nb_chambres_min: (newCtx.nb_chambres_min as number) || null,
          filter_quartiers: (newCtx.quartiers as string[]) || [],
          filter_ville: "Libreville",
          exigences: (newCtx.exigences as string) || null,
          source: "chatbot",
          last_message_at: new Date().toISOString(),
        }, { onConflict: "user_id,client_phone" });

        nextState = "active";
        reply = "Parfait ! ✅ Votre recherche est enregistrée.\n\nVous recevrez les nouvelles annonces correspondantes automatiquement.\n\nVous pouvez aussi me dire :\n• _\"Montre-moi des annonces\"_\n• _\"Je cherche plutôt à Nzeng-Ayong\"_\n• _\"Change mon budget à 200000\"_\n• _\"Mes critères\"_ pour voir votre recherche";
      } else if (text.toLowerCase().startsWith("non") || text === "n") {
        nextState = "onboarding_type_offre";
        reply = "OK, recommençons !\n\n" + ONBOARDING_MESSAGES.onboarding_type_offre;
        // Reset context
        Object.keys(newCtx).forEach(k => { if (k !== "client_name") delete newCtx[k]; });
      } else {
        reply = "Répondez *oui* pour confirmer ou *non* pour recommencer.";
      }
      break;
    }

    default:
      nextState = "onboarding_name";
      reply = ONBOARDING_MESSAGES.welcome;
  }

  // Update conversation state
  await supabase
    .from("chatbot_conversations")
    .update({ conversation_state: nextState, context: newCtx })
    .eq("id", conv.id);

  if (reply) {
    await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, reply);
  }
}

async function handleActiveConversation(
  supabase: ReturnType<typeof createServiceClient>,
  conv: ChatbotConversation,
  userId: string,
  clientPhone: string,
  messageText: string,
  phoneNumberId: string,
  accessToken: string
): Promise<void> {
  // Get client demand
  const { data: demandData } = await supabase
    .from("client_demands")
    .select("*")
    .eq("user_id", userId)
    .eq("client_phone", clientPhone)
    .maybeSingle();

  const demand = demandData as unknown as ClientDemand | null;

  // Quick commands (no AI needed)
  const lower = messageText.toLowerCase();

  if (lower === "mes critères" || lower === "mes criteres" || lower === "critères" || lower === "criteres") {
    if (!demand) {
      await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, "Vous n'avez pas encore de recherche enregistrée. Tapez *bonjour* pour commencer.");
      return;
    }
    const summary = formatDemandSummary(demand);
    await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, summary);
    return;
  }

  if (lower === "stop" || lower === "arrêter" || lower === "arreter" || lower === "désabonner") {
    if (demand) {
      await supabase.from("client_demands").update({ is_active: false }).eq("id", demand.id);
    }
    await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, "Vos alertes ont été désactivées. Tapez *bonjour* pour les réactiver.");
    return;
  }

  if (lower === "bonjour" || lower === "salut" || lower === "hello" || lower === "hi") {
    if (!demand) {
      // Restart onboarding
      await supabase.from("chatbot_conversations").update({ conversation_state: "welcome", context: {} }).eq("id", conv.id);
      await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, ONBOARDING_MESSAGES.welcome);
      await supabase.from("chatbot_conversations").update({ conversation_state: "onboarding_name" }).eq("id", conv.id);
      return;
    }
    await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, `Bonjour ${demand.client_name || ""} ! 👋\n\nVotre recherche est toujours active. Vous pouvez me dire :\n• _\"Montre-moi des annonces\"_\n• _\"Change mon budget\"_\n• _\"Mes critères\"_\n• _\"Stop\"_ pour désactiver`);
    return;
  }

  // AI interpretation for complex messages
  try {
    const kimiKey = process.env.KIMI_API_KEY;
    if (!kimiKey) {
      await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, "Service temporairement indisponible. Réessayez plus tard.");
      return;
    }

    const intent = await interpretClientMessage(messageText, demand, kimiKey);

    switch (intent.type) {
      case "search_more": {
        // Find matching annonces not yet sent
        const { data: annonces } = await supabase
          .from("annonces")
          .select("*")
          .eq("user_id", userId)
          .eq("ai_is_real_estate", true)
          .order("created_at", { ascending: false })
          .limit(5);

        if (!annonces?.length) {
          await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, "Aucune annonce disponible pour le moment. Vous serez notifié dès qu'une nouvelle annonce correspond à vos critères !");
          return;
        }

        const { formatAnnonceMessage } = await import("@/lib/whatsapp");
        let count = 0;
        for (const a of annonces) {
          if (count >= 3) break;
          const msg = formatAnnonceMessage(a);
          await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, msg);
          count++;
        }
        await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, `${count} annonce(s) envoyée(s). Dites _\"encore\"_ pour en voir plus.`);
        break;
      }

      case "modify_criteria": {
        if (!demand) {
          await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, "Vous n'avez pas encore de recherche. Tapez *bonjour* pour commencer.");
          return;
        }

        const updates: Record<string, unknown> = {};
        if (intent.changes.quartiers) updates.filter_quartiers = intent.changes.quartiers;
        if (intent.changes.prix_max !== undefined) updates.filter_prix_max = intent.changes.prix_max;
        if (intent.changes.prix_min !== undefined) updates.filter_prix_min = intent.changes.prix_min;
        if (intent.changes.type_offre) updates.filter_type_offre = [intent.changes.type_offre];
        if (intent.changes.type_bien) updates.filter_type_bien = [intent.changes.type_bien];
        if (intent.changes.nb_chambres_min !== undefined) updates.filter_nb_chambres_min = intent.changes.nb_chambres_min;

        if (Object.keys(updates).length > 0) {
          await supabase.from("client_demands").update(updates).eq("id", demand.id);
          const { data: updatedDemand } = await supabase.from("client_demands").select("*").eq("id", demand.id).single();
          const summary = formatDemandSummary(updatedDemand as unknown as ClientDemand);
          await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, "Critères mis à jour ! ✅\n\n" + summary);
        } else {
          await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, "Je n'ai pas compris les modifications. Essayez par exemple :\n• _\"Budget 200000\"_\n• _\"Quartier Angondjé\"_\n• _\"3 chambres\"_");
        }
        break;
      }

      case "help":
        await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, "*Commandes disponibles :*\n\n• _\"Mes critères\"_ - voir votre recherche\n• _\"Montre-moi des annonces\"_ - dernières annonces\n• _\"Change mon budget à 200000\"_\n• _\"Je cherche à Angondjé\"_\n• _\"3 chambres minimum\"_\n• _\"Stop\"_ - désactiver les alertes\n• _\"Bonjour\"_ - recommencer");
        break;

      default:
        await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, "Je n'ai pas bien compris. Tapez _\"aide\"_ pour voir les commandes disponibles.");
    }
  } catch (error) {
    console.error("Chatbot AI error:", error);
    await sendWhatsAppMessage(phoneNumberId, accessToken, clientPhone, "Désolé, une erreur est survenue. Tapez _\"aide\"_ pour voir les commandes.");
  }

  // Update last_message_at on demand
  await supabase
    .from("client_demands")
    .update({ last_message_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("client_phone", clientPhone);
}

function formatDemandSummary(demand: ClientDemand): string {
  const lines = [
    `*Votre recherche :*`,
    ``,
    `👤 ${demand.client_name || "Client"}`,
    demand.filter_type_offre?.length ? `🏷️ ${demand.filter_type_offre.join(", ")}` : `🏷️ Tous types d'offre`,
    demand.filter_type_bien?.length ? `🏠 ${demand.filter_type_bien.join(", ")}` : `🏠 Tous types de bien`,
    demand.filter_prix_max ? `💰 ${demand.filter_prix_min ? `${demand.filter_prix_min} - ` : "max "}${demand.filter_prix_max} FCFA` : `💰 Sans limite de budget`,
    demand.filter_quartiers?.length ? `📍 ${demand.filter_quartiers.join(", ")}` : `📍 Tous quartiers`,
    demand.filter_nb_chambres_min ? `🛏️ ${demand.filter_nb_chambres_min}+ chambres` : `🛏️ Pas de minimum`,
    demand.exigences ? `✨ ${demand.exigences}` : ``,
  ];
  return lines.filter(Boolean).join("\n");
}
