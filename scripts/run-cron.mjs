#!/usr/bin/env node
// Lanceur des tâches planifiées, exécuté par le service cron Railway
// (voir railway.cron.json). Il appelle les routes /api/cron/* du service web
// l'une après l'autre, puis se termine : Railway exige qu'un service cron
// rende la main, sinon l'exécution suivante est sautée.
//
// Variables requises sur le service cron :
//   CRON_TARGET_URL  URL du service web, ex. https://monapp.up.railway.app
//                    ou l'adresse privée http://<service>.railway.internal:<port>
//   CRON_SECRET      même valeur que sur le service web

import http from "node:http";
import https from "node:https";

// Ordre voulu : collecter, puis diffuser aux canaux, puis servir les demandes clients.
const JOBS = ["/api/cron/scrape", "/api/cron/whatsapp", "/api/cron/demands"];

// La collecte enchaîne des appels externes lents : on laisse 30 min par tâche.
const TIMEOUT_MS = 30 * 60 * 1000;

const baseUrl = process.env.CRON_TARGET_URL || process.env.NEXT_PUBLIC_APP_URL;
const secret = process.env.CRON_SECRET;

if (!baseUrl || !secret) {
  console.error("CRON_TARGET_URL (ou NEXT_PUBLIC_APP_URL) et CRON_SECRET sont requis.");
  process.exit(1);
}

// WHY: node:http plutôt que fetch — fetch coupe après 5 min sans en-têtes de réponse,
// ce qu'une collecte longue dépasse.
function call(path) {
  const url = new URL(path, baseUrl);
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      { method: "POST", headers: { Authorization: `Bearer ${secret}` } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`délai dépassé (${TIMEOUT_MS} ms)`)));
    req.on("error", reject);
    req.end();
  });
}

let failed = false;

for (const path of JOBS) {
  const startedAt = Date.now();
  try {
    const { status, body } = await call(path);
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    const ok = status >= 200 && status < 300;
    if (!ok) failed = true;
    console.log(`${ok ? "OK " : "ERR"} ${path} → ${status} en ${seconds}s ${body.slice(0, 500)}`);
  } catch (error) {
    failed = true;
    console.error(`ERR ${path} → ${error instanceof Error ? error.message : error}`);
  }
}

// Code de sortie non nul = exécution marquée en échec dans Railway.
process.exit(failed ? 1 : 0);
