# Piano Sicurezza & Login — Ecosistema App 81|00

> Stato: ✅ **COMPLETATO (05/08/2026).** Login attivo su tutte le 8 app; database
> chiuso (RLS: solo utenti autenticati). Vedi "Esito" in fondo.
>
> _(Redatto 02/08/2026 come proposta, poi eseguito.)_

## 1. Perché è urgente (stato attuale verificato sul database)

Quasi tutte le tabelle hanno una policy RLS `USING(true)` per il ruolo `public`:
**chiunque conosca l'URL di un'app e la `anon key` (che è nel codice HTML pubblico)
può leggere e scrivere TUTTO**, senza login. Alcune tabelle sono addirittura **senza
RLS**. Esposti oggi:

- **Dati personali (GDPR):** codici fiscali, indirizzi, date di nascita, visite mediche,
  dati di un **minorenne** (Nazar, 2008).
- **Dati economici:** paghe, saldi, fatture, incassi, clienti, preventivi.
- **Tabelle senza RLS:** `_backup_gestionale`, `backup_gestionale`, `assistente_messaggi`,
  `assistente_utenti`, `pianificazioni_bot`, `salvataggi_log`, `timbrature`.

⚠️ **Una schermata di login da sola non basta:** se le regole del DB restano `USING(true)`,
i dati restano prelevabili via API anche aggirando la schermata. Sicurezza = **login + RLS**.

## 2. Obiettivo

- **App gestionali** (gestionale, planning, preventivi, mobile): login **email + password**,
  account **Giuseppe** (accesso pieno).
- **App di campo** (App Roberto, Buono Consegna): sblocco con **PIN unico identico**,
  **recuperabile/modificabile da Giuseppe via email** in qualsiasi momento.
- **Database blindato**: la `anon key` da sola non deve più leggere/scrivere nulla.
- Edge Function (bot Telegram, segreteria) **intatte** (usano `service_role`, non toccate).

## 3. Architettura di autenticazione (Supabase Auth)

Due utenti Supabase Auth:

| Account | Credenziali | Usato da | Accesso |
|---|---|---|---|
| **Giuseppe** | email + password | gestionale, planning, preventivi, mobile | pieno |
| **Campo** | email dedicata + password = **il PIN** | App Roberto, Buono Consegna | limitato (fase 2) |

Meccanismo del **PIN** (senza credenziali in chiaro nel codice):
- L'app di campo, al PIN digitato, fa `signInWithPassword(email = campo@…, password = PIN)`.
- Il PIN **non è nel codice**: lo digita l'utente. Con RLS ristretta, i dati non sono più
  raggiungibili in anonimo.
- **Cambio/recupero PIN** = cambio password dell'account "Campo":
  - opzione A: pulsante **"Cambia PIN"** nel gestionale (solo Giuseppe) → una piccola Edge
    Function aggiorna la password via Admin API;
  - opzione B: **reset via email** standard di Supabase, con la mail dell'account Campo
    impostata su una casella di Giuseppe (es. `giaquinto.giuseppe+campo@gmail.com`,
    l'alias Gmail arriva nella sua posta).

## 4. Riscrittura RLS

**Fase 1 — chiudere al pubblico (grande guadagno immediato):**
- Cambiare tutte le policy `USING(true) / public` → ruolo `authenticated`.
- Attivare RLS sulle tabelle che ora ne sono prive, con policy per `authenticated`
  (o solo `service_role` per quelle puramente di backend, es. `salvataggi_log`, i backup).
- La `anon key` da sola non accede più a nulla.

**Fase 2 — restringere l'account "Campo":**
- Limitare l'account Campo alle sole tabelle che le app di campo usano davvero
  (es. `buoni_consegna`), con policy basate su claim/email dell'utente.
- Nota delicata: se **App Roberto** legge il blob `gestionale_dati` (che contiene paghe/PII),
  l'account Campo vedrebbe anche quei dati. Da valutare: esporre a quell'app solo una vista
  ridotta (cantieri/personale senza dati sensibili) invece del blob intero.

## 5. Sequenza sicura di messa in produzione (per non fermare le app)

Se stringo l'RLS **prima** che le app abbiano il login, le app si fermano subito. Ordine:

1. Creare i due account Auth (Giuseppe + Campo).
2. Aggiungere il login a **ogni** app (email+password o PIN) e pubblicarle. Le app
   continuano a funzionare (RLS non ancora stretta).
3. Verificare che ogni app faccia login e operi da autenticata.
4. **Solo allora** stringere l'RLS a `authenticated` (passo coordinato per le tabelle
   condivise, prima fra tutte `gestionale_dati`).
5. Verificare tutte le app **e** il bot Telegram.
6. Fase 2: restringere l'account Campo.

## 6. Cosa serve per farlo (accessi e input)

- **App già disponibili:** `planning` (repo in sessione), `gestionale` (file caricato).
- **App da fornire** (repo o file HTML): **mobile, App Roberto, preventivi, buono consegna**.
  Senza queste non posso metterle in sicurezza e resterebbero la "porta aperta".
- **Email per l'account Giuseppe:** `giaquinto.giuseppe@gmail.com` (password forte impostata al primo accesso).
- **Email per l'account Campo:** proposta `giaquinto.giuseppe+campo@gmail.com` (per ricevere i reset del PIN).
- **PIN iniziale** da scegliere (poi modificabile).
- **Deploy:** o accesso ai repo per pubblicare io, oppure ti consegno i file e li carichi tu.

## 7. Cosa NON viene toccato
- Edge Function: `telegram-presenze`, `telegram-bot`, `segreteria-*` (usano `service_role`).
- Il bot presenze continua a funzionare durante e dopo la messa in sicurezza.

## 8. Rischi & mitigazioni
- **Rischio:** un'app dimenticata senza login → resta la porta aperta. → Mitigazione: censire
  TUTTE le app prima di stringere l'RLS; stringere solo quando tutte hanno il login.
- **Rischio:** lockout (perdo l'accesso). → Mitigazione: tengo il `service_role` come via di
  servizio e testo il login prima di stringere.
- **Rischio:** PIN condiviso che gira. → Mitigazione: cambio PIN rapido (pulsante nel gestionale)
  e, in fase 2, account Campo con accesso ridotto.

## 9. Decisioni ancora aperte (da confermare con Giuseppe)
- [ ] Email account Campo (proposta `…+campo@gmail.com`) e PIN iniziale.
- [ ] Recupero PIN: pulsante nel gestionale, reset via email, o entrambi.
- [ ] Fornire mobile / App Roberto / preventivi / buono consegna (repo o file).
- [ ] Deploy: accesso ai repo o consegna file.
- [ ] Ordine di partenza tra le app gestionali (proposta: gestionale per primo).

---
_Approvazione richiesta prima di qualsiasi modifica a database o app._

---

## Esito (05/08/2026) — COMPLETATO

**Login attivo su tutte le 8 app** (modulo `login-81100`, fetch-wrapper + Supabase Auth):
- Email+password (account Giuseppe, SSO condiviso stesso dominio): gestionale, mobile,
  planning, preventivi, layout-giornate, riconciliazione-carburanti.
- PIN 501101 (account "Campo", sessione volatile, PIN a ogni apertura): buono-consegna,
  ottantunocento-roberto (tastierina nativa collegata a Supabase Auth).

**Database chiuso:** tutte le policy `public/anon` spostate a `authenticated`; RLS abilitato
su ogni tabella (chiuse anche i backup e le tabelle "assistente" prima scoperte). Verifica:
`policy_aperte_ad_anon = 0`, nessuna tabella senza RLS. Backup pre-modifica: snapshot #904.

**Account Auth:**
- `giaquinto.giuseppe@gmail.com` (titolare, password personale).
- `giaquinto.giuseppe+campo@gmail.com` (app di campo, password = PIN 501101).
- Edge Function `auth-setup` (creazione/reset account, apribile via URL con secret).

**Intoppi risolti:**
- App Roberto leggeva dati prima del login → invertito l'ordine (prima auth, poi dati).
- La password dell'account Campo era stata ricreata diversa da 501101 → reimpostata via SQL
  (`crypt('501101', gen_salt('bf'))`), verificata.

## Ancora da fare (fase 2, facoltativo)
- [ ] Limitare l'account "Campo" (PIN) alle sole tabelle delle app di campo, così i ragazzi
      non raggiungono paghe/dati personali (ora authenticated = accesso pieno per tutti).
- [ ] "Cambia password" nelle app gestionali (Giuseppe è ancora sulla password temporanea).
- [ ] Bump `sw.js` (service worker) per aggiornamento cache automatico senza scheda privata.
