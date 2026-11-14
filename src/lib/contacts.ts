// Extraction déterministe des contacts d'une annonce (téléphones, WhatsApp, e-mails).
// WHY: les contacts ne sont jamais laissés à l'IA — un numéro « plausible » inventé
// enverrait un client vers un inconnu. Seul ce qui est écrit dans la source est retenu.

export interface ExtractedContacts {
  /** Numéros au format international (+241XXXXXXXX), dans l'ordre d'apparition, sans doublon. */
  phones: string[];
  /** Numéro WhatsApp explicite (lien wa.me ou mention « WhatsApp » près du numéro), sinon null. */
  whatsapp: string | null;
  emails: string[];
}

const GABON = "241";
// Préfixes nationaux valides depuis le passage à 9 chiffres (2019) : fixe 11, mobiles 6x/7x.
const GABON_PREFIXES = ["11", "60", "61", "62", "65", "66", "74", "76", "77"];
// Ancienne numérotation à 8 chiffres (0X XX XX XX) → nouveau préfixe.
const GABON_LEGACY: Record<string, string> = {
  "01": "11",
  "02": "62",
  "04": "74",
  "05": "65",
  "06": "66",
  "07": "77",
};

function gabonNational(digits: string): string | null {
  // 9 chiffres avec le 0 initial : 077 12 34 56
  if (digits.length === 9 && digits.startsWith("0")) digits = digits.slice(1);
  // 8 chiffres, ancienne numérotation : 07 12 34 56
  else if (digits.length === 8 && digits.startsWith("0")) {
    const mapped = GABON_LEGACY[digits.slice(0, 2)];
    if (!mapped) return null;
    digits = mapped + digits.slice(2);
  }
  if (digits.length !== 8) return null;
  return GABON_PREFIXES.includes(digits.slice(0, 2)) ? digits : null;
}

/**
 * Normalise un numéro au format international E.164.
 * Les numéros sans indicatif sont interprétés comme gabonais.
 *
 * @example
 * normalizePhone("077 12 34 56")      // "+24177123456"
 * normalizePhone("+33 6 12 34 56 78") // "+33612345678"
 * normalizePhone("150 000")           // null
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const international = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (international) {
    if (trimmed.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith(GABON)) {
      const national = gabonNational(digits.slice(GABON.length));
      return national ? `+${GABON}${national}` : null;
    }
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  // Indicatif 241 écrit sans « + »
  if (digits.startsWith(GABON) && digits.length >= 11 && digits.length <= 12) {
    const national = gabonNational(digits.slice(GABON.length));
    if (national) return `+${GABON}${national}`;
  }

  const national = gabonNational(digits);
  return national ? `+${GABON}${national}` : null;
}

// Suite de chiffres séparés par au plus un espace, point ou tiret.
const PHONE_CANDIDATE = /(?:\+|00)?\d(?:[ .\-]?\d){6,30}/g;
const WA_LINK = /(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?(?:[^\s]*&)?phone=|whatsapp:\/\/send\?phone=)\+?(\d{8,15})/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MONEY_AFTER = /^\s*(?:f\s?cfa|cfa|xaf|frs?\b|francs?|millions?|mille|k\b|m\b)/i;
const WHATSAPP_WORD = /(whats?\s?app|watsap|wtsp|\bwa\b)/i;

// Plusieurs numéros écrits à la suite (« 077 12 34 56 066 11 22 33 ») forment un seul bloc :
// on avance groupe par groupe et on retient chaque préfixe qui forme un numéro valide.
function splitNumbers(candidate: string): string[] {
  const whole = normalizePhone(candidate);
  if (whole) return [whole];

  const groups = candidate.split(/[ .\-]+/).filter(Boolean);
  const numbers: string[] = [];
  let start = 0;
  while (start < groups.length) {
    let matched = 0;
    for (let end = start + 1; end <= groups.length; end++) {
      const n = normalizePhone(groups.slice(start, end).join(" "));
      if (n) {
        numbers.push(n);
        matched = end - start;
        break;
      }
    }
    start += matched || 1;
  }
  return numbers;
}

/**
 * Extrait les contacts écrits dans un texte (légende, description, texte OCR…).
 *
 * @example
 * extractContacts("Appelez le 077 12 34 56 ou wa.me/24166000000")
 * // { phones: ["+24177123456", "+24166000000"], whatsapp: "+24166000000", emails: [] }
 */
export function extractContacts(text: string): ExtractedContacts {
  const phones: string[] = [];
  let whatsapp: string | null = null;
  const add = (n: string) => {
    if (!phones.includes(n)) phones.push(n);
  };

  for (const match of Array.from(text.matchAll(WA_LINK))) {
    const n = normalizePhone(`+${match[1]}`);
    if (n) {
      add(n);
      whatsapp = whatsapp ?? n;
    }
  }

  for (const match of Array.from(text.matchAll(PHONE_CANDIDATE))) {
    const candidate = match[0];
    const index = match.index ?? 0;
    const digits = candidate.replace(/\D/g, "");

    // Un montant n'est pas un numéro : « 77 000 000 FCFA », « 65 000 000 ».
    if (MONEY_AFTER.test(text.slice(index + candidate.length, index + candidate.length + 12))) continue;
    if (/0{6}$/.test(digits)) continue;

    const found = splitNumbers(candidate);
    if (!found.length) continue;
    found.forEach(add);

    if (!whatsapp && WHATSAPP_WORD.test(text.slice(Math.max(0, index - 40), index))) whatsapp = found[0];
  }

  const emails = Array.from(new Set((text.match(EMAIL) || []).map((e) => e.toLowerCase())));

  return { phones, whatsapp, emails };
}
