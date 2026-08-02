// ═══════════════════════════════════════════════════════════════════════════
// 81|00 — Registro Presenze via WhatsApp  (Twilio + Supabase Edge Function)
// ═══════════════════════════════════════════════════════════════════════════
// Un caposquadra invia le ore della giornata su WhatsApp; il bot le registra
// nel Gestionale (blob gestionale_dati.presenze) e in un registro permanente
// (tabella presenze_whatsapp).
//
// Flusso conversazionale (solo testo, nessun template Meta da approvare):
//   1) capo scrive qualcosa      -> bot chiede il GIORNO (oggi/ieri/gg-mm)
//   2) capo indica il giorno     -> bot elenca i CANTIERI attivi (scegli numero)
//   3) capo sceglie il cantiere  -> bot chiede CHI ha lavorato e quante ore
//   4) capo manda le righe:        "Renato 8", "Dario 8 +2", "Valerio 6 trasferta"
//                                   (una persona per riga, anche piu' righe insieme)
//   5) FINE chiude, ALTRO CANTIERE torna al passo 3.
//
// Risposta a Twilio in TwiML (<Response><Message>…): nessuna credenziale in uscita.
// ═══════════════════════════════════════════════════════════════════════════

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

// ─── util ───────────────────────────────────────────────────────────────────
const norm = (s: string) =>
  (s || "").toString().toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // togli accenti
    .replace(/['’`]/g, "").replace(/\s+/g, " ");

function escapeXml(s: string) {
  return (s || "").replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}

// Risposta TwiML: Twilio consegna il testo come messaggio WhatsApp di risposta
function twiml(text: string) {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(text)}</Message></Response>`;
  return new Response(body, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
}
const twimlVuoto = () => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
  { headers: { "Content-Type": "text/xml; charset=utf-8" } });

function numFromIt(s: string): number | null {
  const m = String(s).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// gg/mm[/aaaa] o gg-mm -> ISO yyyy-mm-dd (anno corrente se assente)
function parseData(txt: string): string | null {
  const t = norm(txt);
  const oggi = new Date();
  const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (/\b(oggi|stasera|oggi\.)\b/.test(t)) return iso(oggi);
  if (/\bieri\b/.test(t)) return iso(new Date(oggi.getTime() - 864e5));
  if (/\b(altroieri|avantieri|ier l'altro)\b/.test(t)) return iso(new Date(oggi.getTime() - 2 * 864e5));
  const m = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
  if (m) {
    const g = +m[1], mm = +m[2];
    let a = m[3] ? +m[3] : oggi.getFullYear();
    if (a < 100) a += 2000;
    if (g >= 1 && g <= 31 && mm >= 1 && mm <= 12) {
      return `${a}-${String(mm).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
    }
  }
  return null;
}
function dataItaliana(iso: string) {
  const [a, m, g] = iso.split("-");
  return `${g}/${m}/${a}`;
}

// ─── lettura dati dal blob gestionale ────────────────────────────────────────
async function leggiDati(): Promise<{ dati: any; versione: number } | null> {
  const r = await fetch(`${SB_URL}/rest/v1/gestionale_dati?id=eq.unico&select=dati,versione`, { headers: H });
  const rows = await r.json();
  const row = rows?.[0];
  if (!row) return null;
  let dati = row.dati;
  if (typeof dati === "string") dati = JSON.parse(dati);
  return { dati, versione: row.versione };
}

async function personale(): Promise<{ id: string; nome: string }[]> {
  const d = await leggiDati();
  return (d?.dati?.personale || []).filter((p: any) => p?.nome)
    .map((p: any) => ({ id: String(p.id), nome: String(p.nome) }));
}

// Cantieri attivi ordinati (stessa logica del bot Telegram rifornimenti)
async function cantieriAttivi(): Promise<string[]> {
  try {
    const d = await leggiDati();
    const oggi = new Date().toISOString().slice(0, 10);
    const da = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const a = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    return (d?.dati?.cantieri || [])
      .filter((c: any) => {
        if (!c.nome || c.archiviato) return false;
        if (c.stato === "concluso") return false;
        const ini = c.periodoInizio || "", fin = c.periodoFine || c.periodoInizio || "9999-12-31";
        return ini <= a && fin >= da;
      })
      .map((c: any) => {
        const ini = c.periodoInizio || "0000", fin = c.periodoFine || c.periodoInizio || "9999";
        const inCorso = ini <= oggi && fin >= oggi;
        const prio = (c.stato === "in corso" ? 0 : 1) + (inCorso ? 0 : 2);
        const dist = inCorso ? 0 : Math.abs(new Date(ini).getTime() - Date.now());
        return { nome: String(c.nome), prio, dist };
      })
      .sort((x: any, y: any) => x.prio - y.prio || x.dist - y.dist)
      .slice(0, 12).map((c: any) => c.nome);
  } catch { return []; }
}

// ─── matching nome dipendente ────────────────────────────────────────────────
// Ritorna { match, ambigui[] }. Match per nome/cognome, "contiene", o iniziali.
function trovaPersona(token: string, lista: { id: string; nome: string }[]) {
  const q = norm(token);
  if (!q) return { match: null as any, ambigui: [] as any[] };
  // 1) match esatto sull'intero nome
  let cand = lista.filter((p) => norm(p.nome) === q);
  // 2) il nome contiene la query come parola intera (nome o cognome)
  if (!cand.length) {
    cand = lista.filter((p) => norm(p.nome).split(" ").some((w) => w === q));
  }
  // 3) una parola del nome inizia con la query (>=3 lettere)
  if (!cand.length && q.length >= 3) {
    cand = lista.filter((p) => norm(p.nome).split(" ").some((w) => w.startsWith(q)));
  }
  // 4) la query e' contenuta nel nome intero
  if (!cand.length && q.length >= 3) {
    cand = lista.filter((p) => norm(p.nome).includes(q));
  }
  if (cand.length === 1) return { match: cand[0], ambigui: [] };
  if (cand.length > 1) return { match: null, ambigui: cand };
  return { match: null, ambigui: [] };
}

// Riga tipo: "Renato 8", "Dario 8 +2", "Valerio 6 trasferta", "Kir 8,5 +1 t"
function parseRiga(riga: string) {
  const raw = riga.trim();
  if (!raw) return null;
  const trasferta = /\b(trasferta|trasf|tras|fuori|ft)\b/i.test(raw) || /\bt\b\s*$/i.test(raw);
  const straordM = raw.match(/\+\s*(\d+(?:[.,]\d+)?)/);   // "+2" straordinario
  const oreStraord = straordM ? parseFloat(straordM[1].replace(",", ".")) : 0;
  // togli lo straordinario, poi cerca il primo numero = ore ordinarie
  const senzaStraord = raw.replace(/\+\s*\d+(?:[.,]\d+)?/, " ");
  const oreM = senzaStraord.match(/(\d+(?:[.,]\d+)?)/);
  const ore = oreM ? parseFloat(oreM[1].replace(",", ".")) : null;
  // il nome = tutto cio' che precede il primo numero
  const nome = senzaStraord.slice(0, oreM ? senzaStraord.indexOf(oreM[0]) : senzaStraord.length)
    .replace(/[,;:.]+$/, "").trim();
  return { nome, ore, oreStraord, trasferta };
}

// ─── stato conversazione ─────────────────────────────────────────────────────
async function getSessione(tel: string) {
  const r = await fetch(`${SB_URL}/rest/v1/whatsapp_presenze_sessioni?telefono=eq.${encodeURIComponent(tel)}&select=*`, { headers: H });
  const rows = await r.json();
  const s = rows?.[0];
  if (!s) return null;
  // scade dopo 3 ore di inattivita'
  if (Date.now() - new Date(s.aggiornato_il).getTime() > 3 * 3600e3) return null;
  return s;
}
async function setSessione(tel: string, stato: string, contesto: any) {
  await fetch(`${SB_URL}/rest/v1/whatsapp_presenze_sessioni?on_conflict=telefono`, {
    method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ telefono: tel, stato, contesto, aggiornato_il: new Date().toISOString() }),
  });
}
async function resetSessione(tel: string) {
  await fetch(`${SB_URL}/rest/v1/whatsapp_presenze_sessioni?telefono=eq.${encodeURIComponent(tel)}`, { method: "DELETE", headers: H });
}

// ─── autorizzazione ("un capo per tutti") ────────────────────────────────────
// Se la tabella e' vuota => accetta tutti (bootstrap sandbox). Altrimenti solo i numeri attivi.
async function autorizzato(tel: string): Promise<{ ok: boolean; nome?: string; tabellaVuota: boolean }> {
  const r = await fetch(`${SB_URL}/rest/v1/whatsapp_autorizzati?select=telefono,nome,attivo`, { headers: H });
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true, tabellaVuota: true };
  const found = rows.find((x: any) => x.telefono === tel && x.attivo !== false);
  return { ok: !!found, nome: found?.nome, tabellaVuota: false };
}

// ─── scrittura nel blob gestionale (lock ottimistico su "versione") ──────────
type Voce = { data: string; pid: string; cantiere: string; ore: number; oreStraord: number; trasferta: boolean };
async function scriviBlob(voci: Voce[]): Promise<boolean> {
  for (let tentativo = 0; tentativo < 6; tentativo++) {
    const d = await leggiDati();
    if (!d) return false;
    const dati = d.dati;
    dati.presenze = dati.presenze || {};
    for (const v of voci) {
      dati.presenze[v.data] = dati.presenze[v.data] || {};
      const prev = dati.presenze[v.data][v.pid] || {};
      dati.presenze[v.data][v.pid] = {
        ...prev,                        // preserva eventuali campi paga gia' presenti
        cantiere: v.cantiere,
        ore: v.ore,                     // campi NUOVI, ignorati dal codice vecchio
        oreStraord: v.oreStraord,
        trasferta: v.trasferta,
        fonte: "whatsapp",
        aggiornato: new Date().toISOString(),
      };
    }
    const patch = await fetch(
      `${SB_URL}/rest/v1/gestionale_dati?id=eq.unico&versione=eq.${d.versione}`,
      { method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ dati }) },
    );
    const res = await patch.json().catch(() => []);
    if (patch.ok && Array.isArray(res) && res.length) return true;   // scritto
    await new Promise((r) => setTimeout(r, 150 * (tentativo + 1)));   // conflitto -> rileggi e riprova
  }
  return false;
}

async function logPresenze(rows: any[]) {
  if (!rows.length) return;
  await fetch(`${SB_URL}/rest/v1/presenze_whatsapp`, {
    method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(rows),
  });
}

// ─── testi ───────────────────────────────────────────────────────────────────
function elencoCantieri(cants: string[]) {
  if (!cants.length) return "Nessun cantiere attivo trovato. Scrivi il *nome del cantiere*:";
  const righe = cants.map((c, i) => `${i + 1}) ${c}`).join("\n");
  return `📍 Su quale cantiere?\n${righe}\n0) Altro (scrivi il nome)`;
}
const ISTRUZIONI_RIGHE =
  "👷 Chi ha lavorato e quante ore?\n" +
  "Scrivi *una persona per riga*, ad esempio:\n" +
  "• Renato 8\n" +
  "• Dario 8 +2   (2 di straordinario)\n" +
  "• Valerio 6 trasferta\n\n" +
  "Puoi mandare più righe insieme.\n" +
  "Poi: *ALTRO CANTIERE* per cambiare, *FINE* per chiudere.";

// ═══ HANDLER ══════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  // Twilio invia il webhook in application/x-www-form-urlencoded
  const form = await req.formData().catch(() => null);
  if (!form) return twimlVuoto();
  const from = String(form.get("From") || "").replace(/^whatsapp:/, "").trim(); // +39...
  const bodyRaw = String(form.get("Body") || "").trim();
  const profilo = String(form.get("ProfileName") || "").trim();
  if (!from) return twimlVuoto();
  const cmd = norm(bodyRaw);

  // — autorizzazione —
  const auth = await autorizzato(from);
  if (!auth.ok) {
    return twiml(`⛔ Questo numero non è abilitato a registrare le presenze.\n\nIl tuo numero è: ${from}\nComunicalo a Giuseppe per l'abilitazione.`);
  }
  const capoNome = auth.nome || profilo || from;

  // — comandi globali —
  if (["annulla", "reset", "stop", "esci", "cancella"].includes(cmd)) {
    await resetSessione(from);
    return twiml("🔄 Registrazione annullata. Scrivi *presenze* per ricominciare.");
  }
  if (["aiuto", "help", "?", "info"].includes(cmd)) {
    return twiml("ℹ️ *Registro presenze 81|00*\nRegistro le ore dei dipendenti per cantiere.\n\nScrivi *presenze* per iniziare. In ogni momento: *annulla* per ricominciare.");
  }

  let sess = await getSessione(from);

  // — avvio / nessuna sessione attiva —
  if (!sess || ["presenze", "ore", "start", "/start", "ciao", "buonasera", "buongiorno", "salve", "inizia"].includes(cmd)) {
    await setSessione(from, "data", {});
    return twiml(
      `👋 Ciao ${capoNome.split(" ")[0] || ""}! Registro le *presenze* per cantiere.\n\n` +
      `📅 Per quale giorno?\nRispondi *OGGI*, *IERI* oppure la data (es. 30/07).`,
    );
  }

  const ctx = sess.contesto || {};

  // — STATO: data —
  if (sess.stato === "data") {
    const data = parseData(bodyRaw);
    if (!data) return twiml("📅 Non ho capito la data.\nRispondi *OGGI*, *IERI* oppure gg/mm (es. 30/07).");
    const cants = await cantieriAttivi();
    await setSessione(from, "cantiere", { data, cantieriLista: cants });
    return twiml(`📅 Giorno: *${dataItaliana(data)}*\n\n${elencoCantieri(cants)}`);
  }

  // — STATO: cantiere —
  if (sess.stato === "cantiere") {
    const cants: string[] = ctx.cantieriLista || [];
    let cantiere = "";
    if (/^\d+$/.test(cmd)) {
      const i = parseInt(cmd);
      if (i === 0) {
        await setSessione(from, "cantiere_nome", ctx);
        return twiml("✏️ Scrivi il *nome del cantiere*:");
      }
      cantiere = cants[i - 1] || "";
      if (!cantiere) return twiml(`Numero non valido.\n\n${elencoCantieri(cants)}`);
    } else {
      cantiere = bodyRaw.trim(); // ha scritto direttamente il nome
    }
    await setSessione(from, "righe", { ...ctx, cantiereNome: cantiere });
    return twiml(`📍 Cantiere: *${cantiere}* — 📅 ${dataItaliana(ctx.data)}\n\n${ISTRUZIONI_RIGHE}`);
  }

  // — STATO: cantiere_nome (digitato a mano) —
  if (sess.stato === "cantiere_nome") {
    const cantiere = bodyRaw.trim();
    if (!cantiere) return twiml("✏️ Scrivi il *nome del cantiere*:");
    await setSessione(from, "righe", { ...ctx, cantiereNome: cantiere });
    return twiml(`📍 Cantiere: *${cantiere}* — 📅 ${dataItaliana(ctx.data)}\n\n${ISTRUZIONI_RIGHE}`);
  }

  // — STATO: righe (inserimento persone/ore) —
  if (sess.stato === "righe") {
    if (["fine", "fatto", "ok", "basta", "finito", "chiudi"].includes(cmd)) {
      await resetSessione(from);
      return twiml("✅ Chiuso. Grazie e buona serata! Scrivi *presenze* per registrare un altro giorno.");
    }
    if (["altro cantiere", "cambia cantiere", "altro"].includes(cmd)) {
      const cants = await cantieriAttivi();
      await setSessione(from, "cantiere", { data: ctx.data, cantieriLista: cants });
      return twiml(elencoCantieri(cants));
    }
    if (["altro giorno", "cambia data", "cambia giorno"].includes(cmd)) {
      await setSessione(from, "data", {});
      return twiml("📅 Per quale giorno? (*OGGI*, *IERI* o gg/mm)");
    }

    const lista = await personale();
    const righe = bodyRaw.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    const ok: string[] = [], problemi: string[] = [];
    const voci: Voce[] = [];
    const logRows: any[] = [];

    for (const riga of righe) {
      const p = parseRiga(riga);
      if (!p || !p.nome) { problemi.push(`• "${riga}" → manca il nome`); continue; }
      if (p.ore === null) { problemi.push(`• ${p.nome} → mancano le ore`); continue; }
      const { match, ambigui } = trovaPersona(p.nome, lista);
      if (ambigui.length) { problemi.push(`• "${p.nome}" → più corrispondenze: ${ambigui.map((a) => a.nome).join(", ")} — scrivi cognome`); continue; }
      if (!match) { problemi.push(`• "${p.nome}" → non trovato in anagrafica`); continue; }
      voci.push({ data: ctx.data, pid: match.id, cantiere: ctx.cantiereNome, ore: p.ore, oreStraord: p.oreStraord, trasferta: p.trasferta });
      logRows.push({
        data: ctx.data, personale_id: match.id, personale_nome: match.nome, cantiere: ctx.cantiereNome,
        ore: p.ore, ore_straord: p.oreStraord, trasferta: p.trasferta,
        registrato_da: capoNome, telefono: from,
      });
      const extra = [p.oreStraord ? `+${p.oreStraord} str` : "", p.trasferta ? "trasferta" : ""].filter(Boolean).join(", ");
      ok.push(`• ${match.nome} — ${p.ore}h${extra ? " (" + extra + ")" : ""}`);
    }

    // salva: prima il registro permanente, poi il blob gestionale
    await logPresenze(logRows);
    let avviso = "";
    if (voci.length) {
      const scritto = await scriviBlob(voci);
      if (!scritto) avviso = "\n⚠️ Salvato nel registro, ma il Gestionale era occupato: verrà allineato al prossimo salvataggio.";
    }

    // rinnova la sessione (resta su 'righe' per aggiungere altre persone)
    await setSessione(from, "righe", ctx);

    let msg = "";
    if (ok.length) msg += `✅ Registrato su *${ctx.cantiereNome}* (${dataItaliana(ctx.data)}):\n${ok.join("\n")}`;
    if (problemi.length) msg += `${ok.length ? "\n\n" : ""}⚠️ Da correggere:\n${problemi.join("\n")}`;
    if (!ok.length && !problemi.length) msg = ISTRUZIONI_RIGHE;
    else msg += avviso + "\n\nAltre persone? Scrivi le righe, oppure *ALTRO CANTIERE* / *FINE*.";
    return twiml(msg);
  }

  // fallback
  await setSessione(from, "data", {});
  return twiml("📅 Ricominciamo. Per quale giorno? (*OGGI*, *IERI* o gg/mm)");
});
