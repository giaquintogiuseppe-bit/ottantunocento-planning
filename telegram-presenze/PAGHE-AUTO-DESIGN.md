# Paghe giornaliere automatiche — progetto (DA FARE in futuro)

> Stato: **congelato** su richiesta di Giuseppe (02/08/2026) — "conserva per un
> intervento futuro". Il bot presenze Telegram è già attivo e scrive i **turni**
> (orari + cantiere) nel Gestionale; manca solo il **calcolo automatico della paga**
> a partire da quegli orari. Questo documento raccoglie regole e decisioni già prese,
> pronte da implementare.

## Obiettivo
Trasformare in automatico gli **orari dei turni** (già registrati dal bot) nella
**paga giornaliera** di ogni dipendente, con una leva manuale di aggiustamento.

## Regole di calcolo (CONFERMATE da Giuseppe)

### Operai
Renato Maiorano, Francesco Scandolara, Vincenzo Pasquariello, Mohamed, Franco D'Angelo,
Marcello Feola, Gianluigi Casanova, Nazar (Nazaren) — e per default **tutti tranne Roberto**.

```
Tariffa oraria ordinaria = 50 € ÷ 9h = 5,5556 €/h
Ore presenza   = somma delle durate dei turni del giorno
Ore pagate     = max(0, presenza − 1h)          # 1h di pausa NON retribuita
Ordinarie      = min(ore pagate, 9)             → × 5,5556 €
Straordinario  = max(0, ore pagate − 9)         → × 7 €   (cioè oltre le 10h di presenza)
Paga giornata  = ordinarie + straordinario + Allineamento
```

Esempi di verifica:
| Presenza | Ore pagate | Calcolo | Paga |
|---|---|---|---|
| 10h (es. 07–17) | 9 | 9 × 5,5556 | € 50,00 |
| 6h (es. 07–13) | 5 | 5 × 5,5556 | € 27,78 |
| 12h (es. 07–19) | 11 | 9×5,5556 + 2×7 | € 64,00 |

- **Giornata corta (<10h): proporzionale alle ore** (scelta di Giuseppe), come da esempio 6h → €27,78.
- Nota di dettaglio da confermare in fase di sviluppo: la pausa −1h va applicata
  sempre o solo sopra una certa durata? (l'esempio 6h→5h pagate applica −1h.)

### Roberto Vergone (caso speciale)
- **€600 / settimana FISSI**, a prescindere da giorni e orari (anche di domenica).
- Le sue giornate registrano solo *dov'era*, non calcolano paga.
- Modello scelto: **riga settimanale fissa €600** (non €120/giorno).
- Anche per lui: tasto **Allineamento** per settimane particolari.

### Allineamento (leva manuale, CONFERMATA)
- **Un campo unico per giornata**: importo **±** (positivo o negativo) + **etichetta libera**
  (Bonus / Trasferta / Altro) scelta di volta in volta.
- Si somma alla paga giornaliera.

## Modello tecnico (proposta)

Tutto nel **Gestionale** (`ottantunocento-gestionale`, single-file HTML), dove vivono le paghe.

1. **Tariffe per persona** — salvarle in `personaleHR[]` (esiste già il campo `costoOrario`, oggi 0).
   Config suggerita per persona:
   - `pagaTipo`: `"proporzionale"` (operai) | `"settimanale"` (Roberto)
   - `tariffaGiorno`: 50 · `orePagateStandard`: 9 · `pausaOre`: 1 · `tariffaStraord`: 7
   - `fissoSettimana`: 600 (solo Roberto)
   - ⚠️ Attenzione: gli ID di `personale` (p01, p03…) sono **diversi** da quelli di
     `personaleHR` (mqlgws…, dip_…). Serve una mappa nome→config affidabile.

2. **Calcolo automatico** della paga dalla somma-ore dei `turni` del giorno.

3. **Ripartizione sui turni**: l'importo giornaliero va **distribuito sui turni in
   proporzione alle ore**, così i costi per cantiere (importo per turno) restano corretti.
   Ricordare: nel Gestionale `presenze[data][pid] = { turni:[{id,oraI,oraF,cantiere,importo,notturno}], totale }`
   e `totale = somma importi turni`.

4. **Non sovrascrivere lo storico**: l'automatismo agisce sulle giornate nuove o
   quando si preme esplicitamente **"Ricalcola paga"**. Le giornate già compilate a
   mano non vanno toccate senza conferma.

5. **UI**: sotto ogni giornata, mostra paga calcolata + campo Allineamento (importo ± ed
   etichetta) con un tasto per applicare/ricalcolare.

## Consegna
Modificare `index.html` del Gestionale (file già in possesso, caricato da Giuseppe il 02/08/2026).
Pubblicazione: o accesso al repo `giaquintogiuseppe-bit/ottantunocento-gestionale`, oppure
consegna del file a Giuseppe che lo carica su GitHub Pages ("Add files via upload").

## Punti aperti da confermare prima di sviluppare
- [ ] Formula operai (5,5556 €/h, −1h pausa, straord oltre 10h) — ok di massima, da riconfermare.
- [ ] Pausa −1h: sempre, o solo sopra una soglia di ore?
- [ ] Come/ dove far entrare i €600/sett di Roberto nel conteggio settimanale e nei saldi.
- [ ] Metodo di consegna (repo vs file).
