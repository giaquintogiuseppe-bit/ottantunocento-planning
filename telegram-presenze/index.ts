// ═══════════════════════════════════════════════════════════════════════════
// 81|00 — Registro Presenze via Telegram  (Supabase Edge Function)
// ═══════════════════════════════════════════════════════════════════════════
// Un capo (Giuseppe o Roberto) registra le ore della squadra per cantiere.
// Flusso con pulsanti:
//   1) /start            -> scegli GIORNO (Oggi / Ieri / Altra data)
//   2) giorno            -> scegli CANTIERE (pulsanti dei cantieri attivi)
//   3) cantiere          -> scrivi le righe: "Renato 8", "Dario 8 +2", "Valerio 6 trasferta"
//   4) pulsanti: ➕ Altro cantiere · 📅 Altro giorno · ✅ Fine
//
// Salva nel registro permanente (presenze_registro) e nel Gestionale
// (gestionale_dati.presenze) con lock ottimistico sulla colonna "versione".
// ═══════════════════════════════════════════════════════════════════════════

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ⚠️ INSERIRE IL TOKEN DEL BOT (da @BotFather) al posto del segnaposto:
const TOKEN = "__INSERISCI_TOKEN_BOTFATHER__";
const SECRET = "ottantunocento-presenze-2026";
const TG = `https://api.telegram.org/bot${TOKEN}`;

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

// ─── util Telegram ────────────────────────────────────────────────────────────
async function tg(method: string, body: unknown) {
  return fetch(`${TG}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function kb(rows: { text: string; callback_data: string }[][]) { return { inline_keyboard: rows }; }

// ─── util testo ───────────────────────────────────────────────────────────────
const norm = (s: string) =>
  (s || "").toString().toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "").replace(/\s+/g, " ");

function parseData(txt: string): string | null {
  const t = norm(txt);
  const oggi = new Date();
  const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (/\b(oggi|stasera)\b/.test(t)) return iso(oggi);
  if (/\bieri\b/.test(t)) return iso(new Date(oggi.getTime() - 864e5));
  if (/\b(altroieri|avantieri)\b/.test(t)) return iso(new Date(oggi.getTime() - 2 * 864e5));
  const m = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
  if (m) {
    const g = +m[1], mm = +m[2];
    let a = m[3] ? +m[3] : oggi.getFullYear();
    if (a < 100) a += 2000;
    if (g >= 1 && g <= 31 && mm >= 1 && mm <= 12)
      return `${a}-${String(mm).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
  }
  return null;
}
function dataItaliana(iso: string) { const [a, m, g] = iso.split("-"); return `${g}/${m}/${a}`; }

// ─── dati dal blob gestionale ─────────────────────────────────────────────────
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
  return (d?.dati?.personale || []).filter((p: any) => p?.nome).map((p: any) => ({ id: String(p.id), nome: String(p.nome) }));
}
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
      .slice(0, 14).map((c: any) => c.nome);
  } catch { return []; }
}

// ─── matching nome ────────────────────────────────────────────────────────────
function trovaPersona(token: string, lista: { id: string; nome: string }[]) {
  const q = norm(token);
  if (!q) return { match: null as any, ambigui: [] as any[] };
  let cand = lista.filter((p) => norm(p.nome) === q);
  if (!cand.length) cand = lista.filter((p) => norm(p.nome).split(" ").some((w) => w === q));
  if (!cand.length && q.length >= 3) cand = lista.filter((p) => norm(p.nome).split(" ").some((w) => w.startsWith(q)));
  if (!cand.length && q.length >= 3) cand = lista.filter((p) => norm(p.nome).includes(q));
  if (cand.length === 1) return { match: cand[0], ambigui: [] };
  if (cand.length > 1) return { match: null, ambigui: cand };
  return { match: null, ambigui: [] };
}
function parseRiga(riga: string) {
  const raw = riga.trim();
  if (!raw) return null;
  const trasferta = /\b(trasferta|trasf|tras|fuori|ft)\b/i.test(raw) || /\bt\b\s*$/i.test(raw);
  const straordM = raw.match(/\+\s*(\d+(?:[.,]\d+)?)/);
  const oreStraord = straordM ? parseFloat(straordM[1].replace(",", ".")) : 0;
  const senzaStraord = raw.replace(/\+\s*\d+(?:[.,]\d+)?/, " ");
  const oreM = senzaStraord.match(/(\d+(?:[.,]\d+)?)/);
  const ore = oreM ? parseFloat(oreM[1].replace(",", ".")) : null;
  const nome = senzaStraord.slice(0, oreM ? senzaStraord.indexOf(oreM[0]) : senzaStraord.length).replace(/[,;:.]+$/, "").trim();
  return { nome, ore, oreStraord, trasferta };
}

// Riga con orario: "Renato, Valerio e Francesco dalle 7 alle 13"
// Produce un TURNO (oraI/oraF/notturno) per ogni persona elencata.
function fmtOra(h: number, m: number) { return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }
function parseOrario(riga: string, lista: { id: string; nome: string }[]) {
  const raw = riga.trim();
  const rangeRe = /(?:dalle?\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:alle?|-|–|\/)\s*(\d{1,2})(?:[:.](\d{2}))?/i;
  const m = raw.match(rangeRe);
  if (!m || m.index === undefined) return null;
  const h1 = +m[1], min1 = m[2] ? +m[2] : 0, h2 = +m[3], min2 = m[4] ? +m[4] : 0;
  if (h1 > 23 || h2 > 23 || min1 > 59 || min2 > 59) return null;
  let ore = (h2 * 60 + min2 - (h1 * 60 + min1)) / 60;
  if (ore < 0) ore += 24;              // turno che passa la mezzanotte
  if (ore <= 0 || ore > 24) return null;
  ore = Math.round(ore * 100) / 100;
  const oraI = fmtOra(h1, min1), oraF = fmtOra(h2, min2);
  // notturno: inizio dalle 22 in poi, o fine entro le 6, o turno che scavalca la mezzanotte
  const notturno = h1 >= 22 || h2 <= 6 || (h2 * 60 + min2) < (h1 * 60 + min1);
  const namesPart = raw.slice(0, m.index).replace(/[,;]+$/, "").trim();
  const tokens = namesPart.split(/,|\bed\b|\be\b|&/i).map((s) => s.trim()).filter(Boolean);
  const range = `${oraI}–${oraF}`;
  const entries: any[] = [], problemi: string[] = [];
  if (!tokens.length) return { entries, problemi: [`• "${raw}" → manca il nome prima dell'orario`], oraI, oraF, notturno, ore, range };
  for (const tk of tokens) {
    const { match, ambigui } = trovaPersona(tk, lista);
    if (ambigui.length) { problemi.push(`• "${tk}" → più nomi: ${ambigui.map((a: any) => a.nome).join(", ")} — usa il cognome`); continue; }
    if (!match) { problemi.push(`• "${tk}" → non trovato in anagrafica`); continue; }
    entries.push({ match, oraI, oraF, notturno, ore });
  }
  return { entries, problemi, oraI, oraF, notturno, ore, range };
}

// ─── sessione ─────────────────────────────────────────────────────────────────
async function getSessione(chatId: string) {
  const r = await fetch(`${SB_URL}/rest/v1/presenze_sessioni?chat_id=eq.${encodeURIComponent(chatId)}&select=*`, { headers: H });
  const s = (await r.json())?.[0];
  if (!s) return null;
  if (Date.now() - new Date(s.aggiornato_il).getTime() > 3 * 3600e3) return null;
  return s;
}
async function setSessione(chatId: string, stato: string, contesto: any) {
  await fetch(`${SB_URL}/rest/v1/presenze_sessioni?on_conflict=chat_id`, {
    method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ chat_id: chatId, stato, contesto, aggiornato_il: new Date().toISOString() }),
  });
}
async function resetSessione(chatId: string) {
  await fetch(`${SB_URL}/rest/v1/presenze_sessioni?chat_id=eq.${encodeURIComponent(chatId)}`, { method: "DELETE", headers: H });
}

// ─── autorizzazione (vuota = accetta tutti, per il primo test) ───────────────
async function autorizzato(chatId: string): Promise<{ ok: boolean; nome?: string }> {
  const r = await fetch(`${SB_URL}/rest/v1/presenze_autorizzati?select=chat_id,nome,attivo`, { headers: H });
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true };
  const f = rows.find((x: any) => String(x.chat_id) === String(chatId) && x.attivo !== false);
  return { ok: !!f, nome: f?.nome };
}

// ─── scrittura nel blob gestionale: AGGIUNGE turni (lock ottimistico) ─────────
// Formato nativo del Gestionale:
//   presenze[data][pid] = { turni: [ {id, oraI, oraF, cantiere, importo, notturno} ], totale }
// L'importo lo lascia 0 (la paga si completa nel Gestionale); totale = somma importi.
type Voce = { data: string; pid: string; cantiere: string; oraI: string; oraF: string; notturno: boolean };
function genId() { return "wa" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
async function scriviBlob(voci: Voce[]): Promise<boolean> {
  for (let t = 0; t < 6; t++) {
    const d = await leggiDati();
    if (!d) return false;
    const dati = d.dati;
    dati.presenze = dati.presenze || {};
    for (const v of voci) {
      dati.presenze[v.data] = dati.presenze[v.data] || {};
      const prev = dati.presenze[v.data][v.pid] || {};
      const turni = Array.isArray(prev.turni) ? prev.turni.slice() : [];
      // se il record è nel VECCHIO formato (base/straord/totale) migra prima quel valore
      // in un turno, così non perdo la paga già presente (come fa il Gestionale).
      if (!turni.length) {
        const impPrev = (parseFloat(prev.base) || 0) + (parseFloat(prev.straord) || 0) || (parseFloat(prev.totale) || 0);
        if (impPrev > 0 || prev.cantiere) {
          turni.push({ id: genId(), cantiere: prev.cantiere || "", oraI: "08:00", oraF: "18:00", importo: impPrev, notturno: false });
        }
      }
      // evita doppioni: stesso orario+cantiere già presente
      const gia = turni.some((x: any) => x.oraI === v.oraI && x.oraF === v.oraF && x.cantiere === v.cantiere);
      if (!gia) turni.push({ id: genId(), oraI: v.oraI, oraF: v.oraF, cantiere: v.cantiere, importo: 0, notturno: v.notturno });
      const totale = turni.reduce((s: number, x: any) => s + (Number(x.importo) || 0), 0);
      // conserva eventuali campi legittimi preesistenti, senza i vecchi campi "piatti" del bot
      const { ore, oreStraord, trasferta, fonte, aggiornato, turni: _t, totale: _tot, ...rest } = prev;
      dati.presenze[v.data][v.pid] = { ...rest, turni, totale };
    }
    const patch = await fetch(`${SB_URL}/rest/v1/gestionale_dati?id=eq.unico&versione=eq.${d.versione}`,
      { method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ dati }) });
    const res = await patch.json().catch(() => []);
    if (patch.ok && Array.isArray(res) && res.length) return true;
    await new Promise((r) => setTimeout(r, 150 * (t + 1)));
  }
  return false;
}
async function logRegistro(rows: any[]) {
  if (!rows.length) return;
  await fetch(`${SB_URL}/rest/v1/presenze_registro`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(rows) });
}

// ─── tastiere / testi ─────────────────────────────────────────────────────────
function kbGiorno() {
  return kb([
    [{ text: "📅 Oggi", callback_data: "g:oggi" }, { text: "Ieri", callback_data: "g:ieri" }],
    [{ text: "🗓 Altra data…", callback_data: "g:altra" }],
  ]);
}
function kbCantieri(cants: string[]) {
  const rows = cants.map((c, i) => [{ text: c.length > 34 ? c.slice(0, 32) + "…" : c, callback_data: `c:${i}` }]);
  rows.push([{ text: "✏️ Altro cantiere…", callback_data: "c:alt" }]);
  return kb(rows);
}
function kbDopoRighe() {
  return kb([[{ text: "➕ Altro cantiere", callback_data: "altrocant" }, { text: "📅 Altro giorno", callback_data: "altrogiorno" }], [{ text: "✅ Fine", callback_data: "fine" }]]);
}
const ISTRUZIONI =
  "👷 Chi ha lavorato e con che orario?\n" +
  "Scrivi persona/e + orario, es:\n" +
  "• Renato, Valerio e Francesco dalle 7 alle 13\n" +
  "• Kir dalle 7:30 alle 16\n\n" +
  "Ogni riga crea un turno. Per un secondo turno/cantiere: manda un'altra riga o usa ➕ Altro cantiere.\n" +
  "La paga (importo) la completi poi nel Gestionale.";

async function chiediGiorno(chatId: string, nome: string) {
  await setSessione(chatId, "data", {});
  await tg("sendMessage", { chat_id: chatId, text: `👋 Ciao ${nome.split(" ")[0] || ""}! Registro le presenze per cantiere.\n\n📅 Per quale giorno?`, reply_markup: kbGiorno() });
}
async function chiediCantiere(chatId: string, data: string) {
  const cants = await cantieriAttivi();
  await setSessione(chatId, "cantiere", { data, cantieriLista: cants });
  const txt = `📅 Giorno: ${dataItaliana(data)}\n\n📍 Su quale cantiere?`;
  if (cants.length) await tg("sendMessage", { chat_id: chatId, text: txt, reply_markup: kbCantieri(cants) });
  else { await setSessione(chatId, "cantiere_nome", { data }); await tg("sendMessage", { chat_id: chatId, text: `${txt}\n(nessun cantiere attivo trovato — scrivi il nome)` }); }
}

// ═══ HANDLER ══════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // setup webhook: apri  …/telegram-presenze?setup  una volta sola
  if (url.searchParams.has("setup")) {
    const hook = `${SB_URL}/functions/v1/telegram-presenze`;
    const r = await tg("setWebhook", { url: hook, secret_token: SECRET, allowed_updates: ["message", "callback_query"] });
    return new Response(JSON.stringify(await r.json(), null, 2), { headers: { "Content-Type": "application/json" } });
  }

  if (req.method !== "POST") return new Response("ok");
  if (req.headers.get("x-telegram-bot-api-secret-token") !== SECRET) return new Response("forbidden", { status: 403 });

  const up = await req.json().catch(() => null);
  if (!up) return new Response("ok");

  // ─── callback dei pulsanti ───
  if (up.callback_query) {
    const cq = up.callback_query;
    const chatId = String(cq.message.chat.id);
    const data = String(cq.data || "");
    await tg("answerCallbackQuery", { callback_query_id: cq.id });

    const auth = await autorizzato(chatId);
    if (!auth.ok) { await tg("sendMessage", { chat_id: chatId, text: `⛔ Non abilitato. Il tuo ID Telegram è: ${chatId}\nComunicalo a Giuseppe.` }); return new Response("ok"); }
    const sess = await getSessione(chatId);
    const ctx = sess?.contesto || {};

    if (data.startsWith("g:")) {
      const scelta = data.slice(2);
      if (scelta === "altra") { await setSessione(chatId, "data_manual", {}); await tg("sendMessage", { chat_id: chatId, text: "🗓 Scrivi la data (gg/mm), es. 30/07" }); return new Response("ok"); }
      const giorno = scelta === "ieri" ? parseData("ieri") : parseData("oggi");
      await chiediCantiere(chatId, giorno!);
      return new Response("ok");
    }
    if (data.startsWith("c:")) {
      const arg = data.slice(2);
      if (arg === "alt") { await setSessione(chatId, "cantiere_nome", ctx); await tg("sendMessage", { chat_id: chatId, text: "✏️ Scrivi il nome del cantiere:" }); return new Response("ok"); }
      const cant = (ctx.cantieriLista || [])[parseInt(arg)] || "";
      if (!cant) { await tg("sendMessage", { chat_id: chatId, text: "Cantiere non valido, riprova." }); return new Response("ok"); }
      await setSessione(chatId, "righe", { ...ctx, cantiereNome: cant });
      await tg("sendMessage", { chat_id: chatId, text: `📍 ${cant} — 📅 ${dataItaliana(ctx.data)}\n\n${ISTRUZIONI}`, reply_markup: kbDopoRighe() });
      return new Response("ok");
    }
    if (data === "altrocant") { await chiediCantiere(chatId, ctx.data); return new Response("ok"); }
    if (data === "altrogiorno") { await chiediGiorno(chatId, auth.nome || ""); return new Response("ok"); }
    if (data === "fine") { await resetSessione(chatId); await tg("sendMessage", { chat_id: chatId, text: "✅ Chiuso. Grazie! Scrivi /start per un altro giorno." }); return new Response("ok"); }
    return new Response("ok");
  }

  // ─── messaggi di testo ───
  const msg = up.message;
  if (!msg) return new Response("ok");
  const chatId = String(msg.chat.id);
  const nomeTg = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "";
  const testo = (msg.text || "").trim();
  const cmd = norm(testo);

  const auth = await autorizzato(chatId);
  if (!auth.ok) { await tg("sendMessage", { chat_id: chatId, text: `⛔ Questo Telegram non è abilitato a registrare le presenze.\n\nIl tuo ID è: ${chatId}\nComunicalo a Giuseppe per l'abilitazione.` }); return new Response("ok"); }
  const capoNome = auth.nome || nomeTg || chatId;

  if (["annulla", "reset", "/annulla", "stop"].includes(cmd)) { await resetSessione(chatId); await tg("sendMessage", { chat_id: chatId, text: "🔄 Annullato. /start per ricominciare." }); return new Response("ok"); }

  let sess = await getSessione(chatId);
  if (!sess || ["/start", "start", "presenze", "ore", "ciao"].includes(cmd)) { await chiediGiorno(chatId, capoNome); return new Response("ok"); }
  const ctx = sess.contesto || {};

  if (sess.stato === "data" || sess.stato === "data_manual") {
    const d = parseData(testo);
    if (!d) { await tg("sendMessage", { chat_id: chatId, text: "📅 Non ho capito. Scrivi OGGI, IERI o gg/mm.", reply_markup: kbGiorno() }); return new Response("ok"); }
    await chiediCantiere(chatId, d);
    return new Response("ok");
  }

  if (sess.stato === "cantiere" || sess.stato === "cantiere_nome") {
    const cant = testo.trim();
    if (!cant) { await tg("sendMessage", { chat_id: chatId, text: "✏️ Scrivi il nome del cantiere:" }); return new Response("ok"); }
    await setSessione(chatId, "righe", { ...ctx, cantiereNome: cant });
    await tg("sendMessage", { chat_id: chatId, text: `📍 ${cant} — 📅 ${dataItaliana(ctx.data)}\n\n${ISTRUZIONI}`, reply_markup: kbDopoRighe() });
    return new Response("ok");
  }

  if (sess.stato === "righe") {
    const lista = await personale();
    const righe = testo.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    const ok: string[] = [], problemi: string[] = [];
    const voci: Voce[] = [], logRows: any[] = [];
    const salva = (match: any, oraI: string, oraF: string, notturno: boolean, ore: number) => {
      voci.push({ data: ctx.data, pid: match.id, cantiere: ctx.cantiereNome, oraI, oraF, notturno });
      logRows.push({ data: ctx.data, personale_id: match.id, personale_nome: match.nome, cantiere: ctx.cantiereNome, ore, ora_inizio: oraI, ora_fine: oraF, notturno, registrato_da: capoNome, canale: "telegram", chat_id: chatId });
      ok.push(`• ${match.nome} — ${oraI}–${oraF}${notturno ? " 🌙" : ""} (${ore}h)`);
    };
    for (const riga of righe) {
      const org = parseOrario(riga, lista);
      if (!org) { problemi.push(`• "${riga}" → manca l'orario. Scrivi es: ${riga.split(/\s+/)[0] || "Nome"} dalle 8 alle 16`); continue; }
      for (const e of org.entries) salva(e.match, e.oraI, e.oraF, e.notturno, e.ore);
      for (const pr of org.problemi) problemi.push(pr);
    }
    await logRegistro(logRows);
    let avviso = "";
    if (voci.length) { const s = await scriviBlob(voci); if (!s) avviso = "\n⚠️ Salvato nel registro; Gestionale occupato, si allinea al prossimo salvataggio."; }
    await setSessione(chatId, "righe", ctx);
    let out = "";
    if (ok.length) out += `✅ Registrato su ${ctx.cantiereNome} (${dataItaliana(ctx.data)}):\n${ok.join("\n")}`;
    if (problemi.length) out += `${ok.length ? "\n\n" : ""}⚠️ Da correggere:\n${problemi.join("\n")}`;
    if (!ok.length && !problemi.length) out = ISTRUZIONI;
    else out += avviso;
    await tg("sendMessage", { chat_id: chatId, text: out, reply_markup: kbDopoRighe() });
    return new Response("ok");
  }

  await chiediGiorno(chatId, capoNome);
  return new Response("ok");
});
