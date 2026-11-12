/* ═══════════════════════════════════════════════════════════════════════
   RAGGRUPPA — elenchi lunghi divisi per anno e mese, con "Da seguire" in cima.
   Pezzo unico pensato per essere riusato (Gestionale, poi Planning e
   Amministrazione): non tocca i dati, cambia solo come si mostrano.

   Regole (decise con Giuseppe, 12/11/2026):
   - "Da seguire" in cima, per tutti gli anni: le voci ancora aperte
     (commessa attiva, da fatturare, preventivo in attesa…) non finiscono mai
     sepolte in un mese passato.
   - Il resto per anno ▸ mese, dal più recente. Aperti all'inizio: l'anno più
     recente e i suoi due mesi più recenti; le scelte di chi usa l'app restano
     ricordate su questo dispositivo.
   - Selettore dell'anno (Tutti / 2027 / 2026 …).
   - La ricerca scavalca i gruppi: con una ricerca attiva l'elenco è piatto.

   Uso in una tabella:
     RAGGRUPPA.registra('commesse', cm2Elenco);         // chi ridisegnare ai clic
     tbody.innerHTML = RAGGRUPPA.tabella({ chiave:'commesse', voci, colonne:5,
        data:v=>'2026-11-03', daSeguire:v=>true|false, riga:v=>'<tr>…</tr>',
        somma:v=>numero (facoltativo), formato:n=>'1.234 €' (facoltativo),
        cerca:'testo' (facoltativo: se pieno, elenco piatto),
        anno:'2026'|'tutti' (facoltativo: anno scelto da un selettore già esistente),
        ordina:false (tiene l'ordine ricevuto dentro i mesi), crescente:true (mesi dal
        più vicino, per le scadenze), modo:'blocchi' (intestazioni <div> per griglie di schede),
        titoloSeguire:'Prossime' (facoltativo, al posto di "Da seguire") });
   Con un solo anno (e "Tutti gli anni") l'intestazione dell'anno non compare: solo i mesi.
     selettore: RAGGRUPPA.selettoreAnno('commesse', voci, v=>data)
   Script classico: espone solo l'oggetto globale RAGGRUPPA.
   ═══════════════════════════════════════════════════════════════════════ */

const RAGGRUPPA = (function(){
  const MESI=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const ridisegna={}, anno={}, aperti={};
  const e = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  (function stile(){
    if(document.getElementById('rg-css')) return;
    const s=document.createElement('style'); s.id='rg-css';
    s.textContent=`
    tr.rg-h td{padding:0!important;border-bottom:1px solid var(--brd);background:var(--card)}
    div.rg-h{grid-column:1/-1;border:1px solid var(--brd);border-radius:8px;background:var(--card);margin-bottom:8px}
    .rg-h button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:9px 10px;cursor:pointer;font-size:12.5px}
    .rg-h button:focus-visible{outline:2px solid var(--teal);outline-offset:-2px}
    .rg-h .rg-fr{display:inline-block;width:12px;transition:transform .15s;color:var(--text2)}
    .rg-h.on .rg-fr{transform:rotate(90deg)}
    .rg-h .rg-t{font-weight:700;letter-spacing:.02em}
    .rg-h .rg-n{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;color:var(--text2)}
    .rg-h .rg-s{margin-left:auto;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;color:var(--text2);font-variant-numeric:tabular-nums}
    tr.rg-anno td,div.rg-anno{background:var(--m2-soft,rgba(154,122,31,.06))}
    .rg-anno .rg-t{font-size:14px}
    .rg-mese button{padding-left:26px}
    tr.rg-seg td,div.rg-seg{background:color-mix(in srgb,var(--gold,#c07d16) 10%,var(--card))}
    .rg-seg .rg-t{text-transform:uppercase;font-size:11.5px;letter-spacing:.06em}
    .rg-anno-sel{width:auto!important;max-width:100%;margin:0!important;border:1px solid var(--brd);background:var(--card);color:var(--text);border-radius:99px;padding:5px 10px;font:inherit;font-size:12.5px;cursor:pointer}
    `;
    document.head.appendChild(s);
  })();

  function leggi(chiave){
    if(aperti[chiave]) return aperti[chiave];
    let o={}; try{ o=JSON.parse(localStorage.getItem('rg:'+chiave)||'{}')||{}; }catch(_){ o={}; }
    return (aperti[chiave]=o);
  }
  function scrivi(chiave){ try{ localStorage.setItem('rg:'+chiave, JSON.stringify(aperti[chiave]||{})); }catch(_){} }
  function annoDi(chiave){
    if(anno[chiave]==null){ let v='tutti'; try{ v=localStorage.getItem('rg-anno:'+chiave)||'tutti'; }catch(_){} anno[chiave]=v; }
    return anno[chiave];
  }
  const meseDi = d => (/^\d{4}-\d{2}/.test(String(d||'')) ? String(d).slice(0,7) : '');

  function registra(chiave, fn){ ridisegna[chiave]=fn; }
  function rifai(chiave){ const f=ridisegna[chiave]; if(typeof f==='function') f(); }

  function apri(chiave, gruppo, predef){
    const o=leggi(chiave); const ora = gruppo in o ? o[gruppo] : !!predef;
    o[gruppo]=!ora; scrivi(chiave); rifai(chiave);
  }
  function scegliAnno(chiave, v){ anno[chiave]=v||'tutti'; try{ localStorage.setItem('rg-anno:'+chiave, anno[chiave]); }catch(_){} rifai(chiave); }

  function selettoreAnno(chiave, voci, data){
    const anni=[...new Set((voci||[]).map(v=>meseDi(data(v)).slice(0,4)).filter(Boolean))].sort().reverse();
    const cur=new Date().getFullYear()+''; if(!anni.includes(cur)) anni.unshift(cur);
    let sel=annoDi(chiave); if(sel!=='tutti' && !anni.includes(sel)) sel='tutti';
    return `<select class="rg-anno-sel" aria-label="Anno" title="Anno" onchange="RAGGRUPPA.scegliAnno('${e(chiave)}',this.value)">
      <option value="tutti"${sel==='tutti'?' selected':''}>Tutti gli anni</option>
      ${anni.map(a=>`<option value="${a}"${sel===a?' selected':''}>${a}</option>`).join('')}</select>`;
  }

  function tabella(o){
    const chiave=o.chiave, col=o.colonne||1, riga=o.riga, data=o.data, fm=o.formato||(n=>String(Math.round(n)));
    const voci=o.voci||[];
    if((o.cerca||'').trim()) return voci.map(riga).join('');           // ricerca: elenco piatto
    const seg=[], resto=[];
    voci.forEach(v=>(o.daSeguire && o.daSeguire(v) ? seg : resto).push(v));
    if(!resto.length) return seg.map(riga).join('');                     // tutto aperto: niente intestazioni
    const st=leggi(chiave), sel=o.anno!=null ? (o.anno||'tutti') : annoDi(chiave), blk=o.modo==='blocchi';
    const ord = o.crescente ? (a,b)=>a.localeCompare(b) : (a,b)=>b.localeCompare(a);
    const somma = arr => o.somma ? `<span class="rg-s">${e(fm(arr.reduce((s,v)=>s+(+o.somma(v)||0),0)))}</span>` : '';
    const titoloSeg = o.titoloSeguire || 'Da seguire';
    const testa = (cls, gruppo, predef, titolo, arr) => {
      const on = gruppo in st ? st[gruppo] : predef;
      const btn=`<button type="button" aria-expanded="${on}"
        onclick="RAGGRUPPA.apri('${e(chiave)}','${e(gruppo)}',${predef?'true':'false'})"><span class="rg-fr">▸</span>
        <span class="rg-t">${titolo}</span><span class="rg-n">${arr.length}</span>${somma(arr)}</button>`;
      return { on, html: blk ? `<div class="rg-h ${cls}${on?' on':''}">${btn}</div>`
                             : `<tr class="rg-h ${cls}${on?' on':''}"><td colspan="${col}">${btn}</td></tr>` };
    };
    let h='';
    if(seg.length){ const t=testa('rg-seg','_seg',true,e(titoloSeg),seg); h+=t.html; if(t.on) h+=seg.map(riga).join(''); }

    // per anno ▸ mese, dal più recente; senza data in fondo
    const perMese={}; let senza=[];
    resto.forEach(v=>{ const m=meseDi(data(v)); if(!m){ senza.push(v); return; } (perMese[m]=perMese[m]||[]).push(v); });
    let mesi=Object.keys(perMese).sort(ord);
    if(sel!=='tutti'){ mesi=mesi.filter(m=>m.startsWith(sel)); senza=[]; }
    if(o.ordina!==false) Object.values(perMese).forEach(a=>a.sort((x,y)=>ord(String(data(x)||''),String(data(y)||''))));
    const recenti=new Set(mesi.slice(0,2));
    const anni=[...new Set(mesi.map(m=>m.slice(0,4)))];
    const primoAnno=anni[0];
    anni.forEach(a=>{
      const mm=mesi.filter(m=>m.startsWith(a));
      let apertoAnno=true;
      if(sel==='tutti' && (anni.length>1 || o.titoloAnno)){ const tot=mm.flatMap(m=>perMese[m]); const t=testa('rg-anno','a'+a,a===primoAnno||mm.some(m=>recenti.has(m)),a,tot); h+=t.html; apertoAnno=t.on; }
      if(!apertoAnno) return;
      mm.forEach(m=>{
        const arr=perMese[m], t=testa('rg-mese','m'+m,recenti.has(m),`${MESI[+m.slice(5,7)-1]} ${m.slice(0,4)}`,arr);
        h+=t.html; if(t.on) h+=arr.map(riga).join('');
      });
    });
    if(senza.length){ const t=testa('rg-anno','_senza',false,'Senza data',senza); h+=t.html; if(t.on) h+=senza.map(riga).join(''); }
    if(!seg.length && !mesi.length && !senza.length) h+= blk ? `<div style="grid-column:1/-1;color:var(--text2);font-size:13px;padding:12px">Niente in ${e(sel)}.</div>`
      : `<tr><td colspan="${col}" style="color:var(--text2);font-size:13px;padding:12px">Niente in ${e(sel)}.</td></tr>`;
    return h;
  }

  return { registra, apri, scegliAnno, selettoreAnno, tabella, annoDi };
})();
