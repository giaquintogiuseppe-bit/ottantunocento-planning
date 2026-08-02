# 81|00 — Registro Presenze via WhatsApp

Bot WhatsApp per registrare l'**orario di lavoro dei dipendenti per cantiere**.
Un caposquadra (o Giuseppe) invia le ore a fine giornata; il bot le scrive nel
**Gestionale** (`gestionale_dati.presenze`) e in un **registro permanente**
(tabella `presenze_whatsapp`).

- **Backend:** Supabase Edge Function `whatsapp-presenze` (progetto `xqbhujcnjvwbwzpwjujf`)
- **Canale:** Twilio WhatsApp (risposte in TwiML, nessun template Meta da approvare)
- **URL webhook:** `https://xqbhujcnjvwbwzpwjujf.supabase.co/functions/v1/whatsapp-presenze`

## Come si usa (dal telefono del capo)

```
Capo:  presenze
Bot:   👋 Per quale giorno? (OGGI / IERI / gg-mm)
Capo:  oggi
Bot:   📍 Su quale cantiere?
       1) Firenze   2) Gaeta   3) Teatro Capua …   0) Altro
Capo:  2
Bot:   👷 Chi ha lavorato e quante ore?
Capo:  Renato 8
       Dario 8 +2
       Valerio 6 trasferta
Bot:   ✅ Registrato su Gaeta (02/08):
       • Renato Maiorano — 8h
       • Dario Campi — 8h (+2 str)
       • Valerio Buco — 6h (trasferta)
       Altre persone? oppure ALTRO CANTIERE / FINE
Capo:  fine
```

Sintassi di una riga: `Nome ORE [+STRAORD] [trasferta]` — es. `Kir 8,5 +1 t`.
Comandi: **ALTRO CANTIERE**, **ALTRO GIORNO**, **FINE**, **ANNULLA**, **AIUTO**.

## Attivazione Twilio (sandbox, ~5 minuti)

1. Twilio Console → **Messaging → Try it out → Send a WhatsApp message**.
2. Tab **Sandbox settings** → campo *"When a message comes in"*:
   incolla l'URL del webhook (sopra), metodo **POST**. Salva.
3. Dal telefono del capo, invia al numero sandbox Twilio il messaggio
   `join <due-parole>` (il codice mostrato nella console) per agganciare la sandbox.
4. Scrivi **`presenze`** e prova il flusso.

## Passaggio in produzione

La sandbox va bene per i test, ma richiede il `join` ogni 72h e usa un numero
condiviso. Per l'uso quotidiano:

1. Twilio → **Messaging → Senders → WhatsApp senders**: registra un mittente
   WhatsApp (numero Twilio + collegamento a un profilo Meta Business).
2. Imposta lo stesso URL webhook sul mittente.
3. Nessuna modifica al codice: la funzione risponde in TwiML a qualunque numero.

## Autorizzazione ("un capo per tutti")

Finché la tabella `whatsapp_autorizzati` è **vuota**, il bot accetta **tutti**
(comodo per il primo test). Appena inserisci un numero, **solo** quelli
autorizzati possono registrare.

```sql
-- Abilita i numeri dei capi (formato E.164, come li invia Twilio):
insert into public.whatsapp_autorizzati (telefono, nome, ruolo) values
  ('+39XXXXXXXXXX', 'Giuseppe Giaquinto', 'titolare'),
  ('+39YYYYYYYYYY', 'Renato Maiorano',   'caposquadra')
on conflict (telefono) do update set nome = excluded.nome, attivo = true;
```

Per scoprire il numero esatto nel formato giusto, fai inviare un messaggio dal
telefono e leggi la colonna `telefono` in `presenze_whatsapp` (o
`whatsapp_presenze_sessioni`).

## Dati prodotti

**Registro permanente** — tabella `presenze_whatsapp`
(`data, personale_id, personale_nome, cantiere, ore, ore_straord, trasferta,
registrato_da, telefono, creato_il`). È la fonte affidabile: non viene mai
sovrascritta.

**Gestionale** — `gestionale_dati.dati.presenze[data][idDipendente]` riceve i
campi **nuovi** `ore`, `oreStraord`, `trasferta`, `cantiere`, `fonte:"whatsapp"`
accanto agli eventuali campi paga esistenti, con scrittura protetta dal **lock
ottimistico** (`versione`) per non azzerare i dati aperti in altre schede.

> ⚠️ Se la scheda Presenze del Gestionale, salvando, **ricostruisce** l'oggetto
> del dipendente dai suoi soli campi (base/straord/totale/cantiere), i campi
> `ore`/`oreStraord`/`trasferta` verrebbero persi al successivo salvataggio.
> Il registro `presenze_whatsapp` resta comunque intatto. Per mostrare le ore
> WhatsApp direttamente nel Gestionale va aggiornata la scheda Presenze
> (lettura/preservazione dei nuovi campi): intervento separato sul file del
> Gestionale.
