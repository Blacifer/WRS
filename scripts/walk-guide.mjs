#!/usr/bin/env node
/**
 * A role's walkthrough as a page: every step of its section with the
 * screenshot the machine took, the exact taps, what must be on the screen,
 * what the machine saw (the walk's result.json) and what to do when it is
 * not there.
 *
 *   node scripts/inspector-walk.mjs                 # section 2, → docs/artifacts/inspector-walk/
 *   node scripts/role-walks.mjs supervisor|drm|admin # sections 3–5, → docs/artifacts/<role>-walk/
 *   node scripts/walk-guide.mjs <role>               # this page, → docs/artifacts/<role>-guide/index.html
 *   HANDOUT=1 node scripts/walk-guide.mjs <role>     # the same for the shop, → docs/handouts/<role>-walk.html
 *
 * The words a person reads are in scripts/walk-guides/<role>.mjs; the
 * evidence is the machine's and is never edited.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROLE = (process.argv[2] || 'inspector').toLowerCase();
const G = await import(`./walk-guides/${ROLE}.mjs`);
const { GUIDE, GROUPS, DEVICE, TITLE, EYEBROW, H1, ACCOUNT, WALK_CMD } = G;
// HANDOUT=1: the same page for the shop and the DRM's office — images embedded,
// the evidence worded as "verified on the build", no tick controls, no
// commands, nothing about how the page was produced. Written to docs/handouts/.
const HANDOUT = process.env.HANDOUT === '1';
const WALK = `docs/artifacts/${ROLE}-walk`;
const OUT = HANDOUT ? 'docs/handouts' : `docs/artifacts/${ROLE}-guide`;
const SHOTS = `docs/artifacts/${ROLE}-guide/shots`;
const WIDE = DEVICE !== 'phone';
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });
const result = JSON.parse(readFileSync(`${WALK}/result.json`, 'utf8'));

// Lighter copies of the screenshots for the page (full-page PNGs run to 1 MB each).
for (const s of result.steps) for (const f of s.shots) {
  const jpg = `${SHOTS}/${f.replace(/\.png$/, '.jpg')}`;
  if (!existsSync(jpg)) execSync(`sips -Z 1600 --setProperty format jpeg --setProperty formatOptions 70 "${WALK}/${f}" --out "${jpg}"`, { stdio: 'ignore' });
}
// The published page references the files; the handout carries them inside itself.
const src = (jpg) => HANDOUT ? `data:image/jpeg;base64,${readFileSync(`${SHOTS}/${jpg.replace(/^shots\//, '')}`).toString('base64')}` : jpg;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const when = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const day = new Date(result.startedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

/*
 * The guide, by hand. `do` is the taps in order; `see` is what must be on the
 * screen; `why` is what the step proves to the room; `ifNot` is the fault to
 * suspect. Keep every button name exactly as the screen prints it.
 */
const matched = result.steps.filter((s) => s.ok).length;
const byHand = result.steps.filter((s) => s.byHand).length;
const total = result.steps.length;

const stepHtml = (s) => {
  const g = GUIDE[s.num];
  const shots = s.shots.map((f) => { const jpg = `shots/${f.replace(/\.png$/, '.jpg')}`; const cap = f.replace(/^\d+-/, '').replace(/\.png$/, '').replace(/-/g, ' '); return HANDOUT ? `<figure><img src="${src(jpg)}" alt="Step ${s.num} — ${esc(cap)}"><figcaption>${esc(cap)}</figcaption></figure>` : `<figure><a href="${jpg}" target="_blank" rel="noopener"><img src="${jpg}" alt="Step ${s.num} — ${esc(cap)}" loading="lazy"></a><figcaption>${esc(cap)} · tap to open in full</figcaption></figure>`; }).join('');
  const id = s.num.replace('.', '-');
  return `
<article class="step" id="s-${id}" data-num="${s.num}">
  <header class="step-head">
    <div class="step-num">${s.num}</div>
    <h3>${esc(g.title)}</h3>
    ${HANDOUT ? '<div class="step-tick"><span class="box" aria-hidden="true"></span><span>Seen it</span></div>' : `<div class="step-tick">
      <label><input type="checkbox" id="chk-${id}" aria-label="Step ${s.num} seen"> <span>Seen it</span></label>
      <button type="button" id="bad-${id}" aria-pressed="false">Didn't match</button>
    </div>`}
  </header>
  ${HANDOUT ? '' : `<div class="note" hidden><textarea id="note-${id}" placeholder="What you saw instead — and the screen you photographed"></textarea></div>`}
  <div class="step-body">
    <div class="shots">${shots}</div>
    <div class="text">
      <section class="do"><h4>Do</h4><ol>${g.do.map((d) => `<li>${d}</li>`).join('')}</ol></section>
      <section class="see"><h4>You must see</h4><ul>${g.see.map((d) => `<li>${d}</li>`).join('')}</ul></section>
      <section class="why"><h4>What it proves</h4><p>${g.why}</p></section>
      <section class="machine ${s.ok ? 'ok' : 'bad'}">
        <h4>${HANDOUT ? 'Checked on the build' : 'The machine saw'} <span class="stamp">${s.ok ? (HANDOUT ? 'verified' : 'matched') : 'did not match'} · ${when(s.startedAt)}</span></h4>
        <ul>${s.saw.map((x) => `<li class="${x.ok ? 'ok' : 'bad'}">${esc(x.text)}</li>`).join('')}</ul>
        ${s.byHand ? `<p class="byhand"><b>By hand:</b> ${esc(HANDOUT ? (g.byHandNote || s.byHand).replace(/The machine[^.]*\./g, '').replace(/it had no painted number to read\.?/i, '').replace(/\s+/g, ' ').trim() : (g.byHandNote || s.byHand))}</p>` : ''}
      </section>
      ${g.ifNot.length ? `<section class="ifnot"><h4>If it is not there</h4><ul>${g.ifNot.map((d) => `<li>${d}</li>`).join('')}</ul></section>` : ''}
    </div>
  </div>
</article>`;
};

const groupHtml = ([key, title, range, who]) => {
  const steps = result.steps.filter((s) => GUIDE[s.num].group === key);
  return `<section class="group" id="g-${key}">
  <div class="group-head"><h2>${esc(title)}</h2><span class="range">${esc(range)}</span>${HANDOUT ? '' : `<button type="button" class="sec-clear" data-sec="${key}">Clear these ticks</button>`}</div>
  <p class="who">${esc(who)}</p>
  ${steps.map(stepHtml).join('')}
</section>`;
};

const RUN_CARD = HANDOUT ? `
    <div class="card run">
      <h2>Verified on the packaged build</h2>
      <div class="big">${matched} / ${total} <small>steps verified</small></div>
      <dl>
        <dt>When</dt><dd>${esc(day)}</dd>
        <dt>On</dt><dd>the packaged bundle, seeded with the demonstration record, ${DEVICE === 'phone' ? 'on a phone-sized screen with the camera allowed' : 'on a laptop screen'}</dd>
        <dt>By hand</dt><dd>${byHand ? `${byHand} step${byHand === 1 ? '' : 's'} (${result.steps.filter((s) => s.byHand).map((s) => s.num).join(', ')}) need a person or a second device` : 'none'}</dd>
      </dl>
    </div>` : `
    <div class="card run">
      <h2>The machine's run of these 22 steps</h2>
      <div class="big">${matched} / ${total} <small>matched</small></div>
      <dl>
        <dt>When</dt><dd>${esc(day)}, ${when(result.startedAt)} – ${when(result.finishedAt)}</dd>
        <dt>Against</dt><dd>${esc(result.base)} (the packaged bundle, seeded by DEMO‑DATA's command)</dd>
        <dt>As</dt><dd>${DEVICE === 'phone' ? 'a 412 × 915 phone, touch, camera allowed' : 'a 1280 × 900 laptop screen'}</dd>
        <dt>By hand</dt><dd>${byHand ? `${byHand} step${byHand === 1 ? '' : 's'} need${byHand === 1 ? 's' : ''} a person or a second device (${result.steps.filter((s) => s.byHand).map((s) => s.num).join(', ')}) — the machine proved the screen, you do the rest` : 'none — every step was done by the machine'}</dd>
        <dt>Page errors</dt><dd>${result.consoleErrors.length ? esc(result.consoleErrors.join('; ')) : 'none'}</dd>
        <dt>Rerun</dt><dd>${WALK_CMD} · node scripts/walk-guide.mjs ${ROLE}</dd>
      </dl>
    </div>`;
const SETUP_CARD = HANDOUT ? `
    <div class="card">
      <h2>Before you start — five minutes, once</h2>
      <ol>
        <li>On the shop PC, double‑click <b>START.cmd</b>; it prints the address for the tablet.</li>
        <li>On the tablet, turn <b>mobile data off</b> and join the shop Wi‑Fi.</li>
        <li>Install the certificate on the tablet once — <b>server\\certs\\lan‑cert.crt</b>, as in TABLET_TRUST.md — so the address opens with no warning and the camera and offline mode are allowed.</li>
        <li>Open the address START.cmd printed and accept <em>Add to home screen</em>.</li>
        <li>Sign in with ${ACCOUNT.handout}.</li>
      </ol>
      <p style="margin-top:10px">Then go step by step. Each step shows the screen as it should look, the taps in order, what must be on your screen, and what to suspect when it is not. Tick <b>Seen it</b> only when you saw it.</p>
    </div>` : `
    <div class="card">
      <h2>Before you start — five minutes, once</h2>
      <ol>
        <li>On the Mac: <code>bash scripts/rehearsal.sh start</code>, then <code>bash scripts/rehearsal.sh status</code> for the two addresses. On the demo laptop: double‑click <b>START.cmd</b>; it prints the address.</li>
        <li>On the phone, turn <b>mobile data off</b> and join the same Wi‑Fi as the server.</li>
        <li>Install the certificate on the phone once — <b>lan‑cert.crt</b>, as in TABLET_TRUST.md — so the address opens with no warning and the camera and offline mode are allowed. Without it the page opens but 2.7, 2.18 and 2.20 cannot pass.</li>
        <li>Open <b>https://&lt;the Wi‑Fi address&gt;:3200</b> and accept <em>Add to home screen</em>.</li>
        <li>Sign in as <b>${ACCOUNT.user}</b>, password <b>password123</b>.</li>
      </ol>
      <p style="margin-top:10px">Then go step by step. Each step shows the phone screenshot the machine took on this build, the taps in order, what must be on your screen, and what to suspect when it is not. Tick <b>Seen it</b> only when you saw it; <b>Didn't match</b> and a note is the bug report.</p>
    </div>`;
const html = `<title>${TITLE}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root{
    --ground:#eef0f2; --paper:#ffffff; --ink:#1b2027; --ink-2:#48525c; --ink-3:#7a8590; --line:#d5d9de;
    --accent:#1f4e79; --accent-soft:#e3ecf5; --ok:#2e7d4f; --ok-soft:#e2f1e7; --bad:#b3261e; --bad-soft:#fbe7e5; --warn:#8a6100; --warn-soft:#fff3d6;
    --shot-frame:#0f1216;
  }
  @media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
    --ground:#14181c; --paper:#1c2228; --ink:#eceef0; --ink-2:#b7bfc7; --ink-3:#86909b; --line:#2e3740;
    --accent:#82b3e4; --accent-soft:#1c2e41; --ok:#6fcf97; --ok-soft:#1b3226; --bad:#f28b82; --bad-soft:#3c1f1d; --warn:#f2c14e; --warn-soft:#3a2f10;
    --shot-frame:#000;
  }}
  :root[data-theme="dark"]{
    --ground:#14181c; --paper:#1c2228; --ink:#eceef0; --ink-2:#b7bfc7; --ink-3:#86909b; --line:#2e3740;
    --accent:#82b3e4; --accent-soft:#1c2e41; --ok:#6fcf97; --ok-soft:#1b3226; --bad:#f28b82; --bad-soft:#3c1f1d; --warn:#f2c14e; --warn-soft:#3a2f10;
    --shot-frame:#000;
  }
  body{background:var(--ground);color:var(--ink);font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;line-height:1.5;margin:0;padding-block:0 56px;padding-inline:16px}
  .wrap{max-width:1080px;margin:0 auto}
  header.top{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--ground);border-bottom:1px solid var(--line);padding:12px 0 10px;margin-bottom:18px}
  .top-row{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 16px}
  .eyebrow{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
  h1{font-size:21px;font-weight:700;margin:0;letter-spacing:-.01em;text-wrap:balance}
  .progress{display:flex;align-items:center;gap:10px;font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--ink-2);font-variant-numeric:tabular-nums}
  .bar{width:160px;max-width:38vw;height:8px;background:var(--line);border-radius:4px;overflow:hidden}
  .bar i{display:block;height:100%;background:var(--ok);width:0%}
  .intro{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-bottom:22px}
  @media (max-width:760px){ .intro{grid-template-columns:1fr} }
  .card{background:var(--paper);border:1px solid var(--line);padding:16px 18px}
  .card h2{font-size:15px;margin:0 0 8px}
  .card p{margin:0 0 8px;max-width:70ch}
  .card ol,.card ul{margin:6px 0 0;padding-left:20px}
  .card li{margin-bottom:4px}
  code{font-family:"IBM Plex Mono",monospace;font-size:13px;background:var(--accent-soft);color:var(--accent);padding:1px 6px;border-radius:3px}
  .run{border-left:4px solid var(--ok)}
  .run .big{font-size:30px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
  .run .big small{font-size:14px;font-weight:500;color:var(--ink-2)}
  .run dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:10px 0 0;font-size:13px}
  .run dt{color:var(--ink-3)} .run dd{margin:0;font-family:"IBM Plex Mono",monospace;font-size:12.5px;word-break:break-all}
  .toc{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 22px}
  .toc a{font-size:13px;text-decoration:none;color:var(--accent);background:var(--paper);border:1px solid var(--line);padding:6px 10px}
  .group{margin-bottom:30px}
  .group-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px 14px;border-bottom:2px solid var(--ink);padding-bottom:6px;margin-bottom:6px}
  .group-head h2{font-size:18px;margin:0;text-wrap:balance}
  .range{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--ink-3)}
  .who{font-size:13px;color:var(--ink-2);margin:0 0 12px}
  .sec-clear{margin-left:auto;font:inherit;font-size:11px;border:1px solid var(--line);background:transparent;color:var(--ink-3);padding:2px 8px;cursor:pointer}
  .sec-clear.danger,.foot button.danger{background:var(--bad);color:#fff;border-color:var(--bad)}
  .step{background:var(--paper);border:1px solid var(--line);margin-bottom:14px}
  .step.done{border-color:var(--ok)} .step.bad{border-color:var(--bad)}
  .step-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:12px 16px;border-bottom:1px solid var(--line)}
  .step.done .step-head{background:var(--ok-soft)} .step.bad .step-head{background:var(--bad-soft)}
  .step-num{font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--accent);font-weight:500;min-width:36px}
  .step-head h3{font-size:16px;margin:0;flex:1 1 200px;text-wrap:balance}
  .step-tick{display:flex;align-items:center;gap:10px;font-size:13px}
  .step-tick label{display:flex;align-items:center;gap:6px;cursor:pointer}
  .step-tick input{width:20px;height:20px;accent-color:var(--ok);margin:0}
  .step-tick .box{display:inline-block;width:16px;height:16px;border:1.5px solid var(--ink-2);border-radius:3px;margin-right:6px;vertical-align:-3px}
  .step-tick button{font:inherit;font-size:12px;border:1px solid var(--line);background:transparent;color:var(--ink-2);padding:4px 8px;cursor:pointer}
  .step-tick button[aria-pressed=true]{background:var(--bad);color:#fff;border-color:var(--bad)}
  .note{padding:10px 16px 0}
  .note textarea{width:100%;box-sizing:border-box;font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--bad);background:var(--paper);color:var(--ink);min-height:48px;resize:vertical}
  .step-body{display:grid;grid-template-columns:230px 1fr;gap:18px;padding:14px 16px 16px}
  @media (max-width:640px){ .step-body{grid-template-columns:1fr} .shots{display:flex;gap:10px;overflow-x:auto} .shots figure{flex:0 0 200px} }
  .wrap.wide .step-body{grid-template-columns:1fr}
  .wrap.wide .shots{flex-direction:row;flex-wrap:wrap}
  .wrap.wide .shots figure{flex:1 1 320px;max-width:640px}
  .wrap.wide .shots img{max-height:420px;border-radius:8px;border-width:4px}
  .shots{display:flex;flex-direction:column;gap:10px}
  .shots figure{margin:0}
  .shots img{display:block;width:100%;max-width:100%;max-height:520px;object-fit:cover;object-position:top;background:var(--shot-frame);border:6px solid var(--shot-frame);border-radius:14px;box-sizing:border-box}
  .shots figcaption{font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--ink-3);margin-top:4px;text-align:center}
  .text{display:flex;flex-direction:column;gap:12px;min-width:0}
  .text h4{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin:0 0 4px;font-weight:500}
  .text ol,.text ul{margin:0;padding-left:20px}
  .text li{margin-bottom:3px;max-width:70ch}
  .text p{margin:0;max-width:70ch}
  .see li{list-style:none;position:relative;padding-left:0;margin-left:-20px}
  .see li::before{content:"▸";color:var(--accent);margin-right:6px}
  .why p{color:var(--ink-2);font-size:14px}
  .machine{border:1px solid var(--line);padding:10px 12px;background:var(--ground)}
  .machine.ok{border-color:var(--ok)} .machine.bad{border-color:var(--bad)}
  .machine h4 .stamp{float:right;text-transform:none;letter-spacing:0;color:var(--ok);font-variant-numeric:tabular-nums}
  .machine.bad h4 .stamp{color:var(--bad)}
  .machine ul{padding-left:0;list-style:none;font-size:13px}
  .machine li{padding-left:20px;position:relative;font-family:"IBM Plex Mono",monospace;font-size:12px;line-height:1.45;word-break:break-word}
  .machine li::before{position:absolute;left:0;font-weight:700}
  .machine li.ok::before{content:"✓";color:var(--ok)} .machine li.bad::before{content:"✗";color:var(--bad)}
  .byhand{font-size:13px;color:var(--warn);margin-top:8px!important}
  .ifnot{border-left:3px solid var(--warn);padding-left:12px}
  .band{display:inline-block;padding:0 6px;border-radius:3px;font-size:12.5px;font-weight:600;border:1px solid var(--line);white-space:nowrap}
  .band.blue{background:#1d4ed8;color:#fff} .band.green{background:#15803d;color:#fff} .band.yellow{background:#ca8a04;color:#fff} .band.orange{background:#ea580c;color:#fff} .band.white{background:#f1f5f9;color:#1b2027} .band.red{background:#dc2626;color:#fff}
  .foot{margin-top:26px;font-size:13px;color:var(--ink-2);max-width:72ch}
  .foot button{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--paper);color:var(--ink);padding:6px 10px;cursor:pointer;margin-right:8px}
  .summary{font-family:"IBM Plex Mono",monospace;font-size:13px;white-space:pre-wrap;background:var(--paper);border:1px solid var(--line);padding:12px;margin-top:10px;display:none}
  :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  @media print{ header.top{position:static} .foot,.sec-clear,.step-tick button{display:none} .step{break-inside:avoid} .step-body{grid-template-columns:190px 1fr} .shots img{max-height:120mm;border-width:3px} .machine li{font-size:10.5px} body{font-size:12.5px} }
  @media (prefers-reduced-motion:reduce){ *{transition:none!important} }
</style>

<div class="wrap${WIDE ? ' wide' : ''}">
  <header class="top">
    <div class="top-row">
      <div>
        <div class="eyebrow">WRS Raipur · Spring &amp; Wagon QC · ${EYEBROW}</div>
        <h1>${HANDOUT ? H1.handout : H1.rehearsal}</h1>
      </div>
      ${HANDOUT ? '' : `<div class="progress"><span id="count">0 / ${total}</span><div class="bar"><i id="fill"></i></div><span id="badcount"></span></div>`}
    </div>
  </header>

  <div class="intro">${SETUP_CARD}${RUN_CARD}
  </div>

  <nav class="toc">${GROUPS.map(([k, t, r]) => `<a href="#g-${k}">${esc(r)} · ${esc(t)}</a>`).join('')}</nav>

  <div id="sections">${GROUPS.map(groupHtml).join('')}</div>

  ${HANDOUT ? '' : `<div class="foot">
    <p>When you finish, press <b>Show summary</b> and send the text to Pratik's chat — the "did not match" lines with their notes are what gets fixed. Ticks live only in this browser.</p>
    <button type="button" id="summarise">Show summary</button>
    <button type="button" id="reset">Clear all ticks</button>
    <span id="reset-confirm" hidden>Clear every tick and note on this page? <button type="button" id="reset-yes" class="danger">Yes, clear all</button> <button type="button" id="reset-no">Keep them</button></span>
    <div class="summary" id="summary"></div>
  </div>`}
</div>

${HANDOUT ? '' : `<script>
const KEY='wrs-${ROLE}-walk-v1';
let state={};
try{ state=JSON.parse(localStorage.getItem(KEY)||'{}')||{}; }catch(e){ state={}; }
function save(){ try{ localStorage.setItem(KEY,JSON.stringify(state)); }catch(e){} }
const steps=[...document.querySelectorAll('.step')];
const rows={};
const total=steps.length;
for(const row of steps){
  const num=row.dataset.num, id=num.replace('.','-');
  const chk=document.getElementById('chk-'+id), btn=document.getElementById('bad-'+id), noteWrap=row.querySelector('.note'), ta=document.getElementById('note-'+id);
  const st=state[num]||{done:false,bad:false,note:''};
  const paint=()=>{ row.classList.toggle('done',st.done&&!st.bad); row.classList.toggle('bad',st.bad); chk.checked=st.done; btn.setAttribute('aria-pressed',String(st.bad)); noteWrap.hidden=!st.bad; ta.value=st.note||''; };
  chk.addEventListener('change',()=>{ st.done=chk.checked; if(st.done) st.bad=false; state[num]=st; save(); paint(); refresh(); });
  btn.addEventListener('click',()=>{ st.bad=!st.bad; if(st.bad) st.done=false; state[num]=st; save(); paint(); refresh(); if(st.bad) ta.focus(); });
  ta.addEventListener('input',()=>{ st.note=ta.value; state[num]=st; save(); });
  rows[num]=()=>{ st.done=false; st.bad=false; st.note=''; paint(); };
  paint();
}
function refresh(){
  let done=0,bad=0;
  for(const n in rows){ const st=state[n]; if(st&&st.done) done++; if(st&&st.bad) bad++; }
  document.getElementById('count').textContent=done+' / '+total+' seen';
  document.getElementById('fill').style.width=Math.round(done/total*100)+'%';
  document.getElementById('badcount').textContent=bad?bad+" didn't match":'';
}
function clearSteps(nums){ for(const n of nums){ delete state[n]; if(rows[n]) rows[n](); } save(); try{ if(!Object.keys(state).length) localStorage.removeItem(KEY); }catch(e){} refresh(); }
refresh();
// No browser pop-ups anywhere on this page: the frame it is shown in swallows them.
for(const b of document.querySelectorAll('.sec-clear')){
  b.addEventListener('click',()=>{
    const nums=[...document.querySelectorAll('#g-'+b.dataset.sec+' .step')].map((r)=>r.dataset.num);
    if(b.dataset.armed!=='1'){ b.dataset.armed='1'; b.textContent='Really clear '+nums.length+' ticks? Click again'; b.classList.add('danger'); setTimeout(()=>{ b.dataset.armed=''; b.textContent='Clear these ticks'; b.classList.remove('danger'); },4000); return; }
    b.dataset.armed=''; b.textContent='Clear these ticks'; b.classList.remove('danger');
    clearSteps(nums);
  });
}
document.getElementById('reset').addEventListener('click',()=>{ document.getElementById('reset-confirm').hidden=false; });
document.getElementById('reset-no').addEventListener('click',()=>{ document.getElementById('reset-confirm').hidden=true; });
document.getElementById('reset-yes').addEventListener('click',()=>{ clearSteps(Object.keys(rows)); document.getElementById('reset-confirm').hidden=true; document.getElementById('summary').style.display='none'; window.scrollTo({top:0}); });
document.getElementById('summarise').addEventListener('click',()=>{
  const lines=['WRS Raipur — ${ROLE} walk — '+new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})];
  let done=0,bad=[];
  for(const row of steps){ const n=row.dataset.num, st=state[n]; if(st&&st.done) done++; if(st&&st.bad) bad.push(n+' '+row.querySelector('h3').textContent+' — '+(st.note||'(no note)')); }
  lines.push(done+' of '+total+' steps seen; '+bad.length+' did not match.');
  if(bad.length){ lines.push(''); lines.push('Did not match:'); lines.push(...bad.map((b)=>'  - '+b)); }
  const el=document.getElementById('summary'); el.textContent=lines.join('\\n'); el.style.display='block';
});
</script>`}
`;
const outFile = HANDOUT ? `${OUT}/${ROLE}-walk.html` : `${OUT}/index.html`;
// The handout goes to the shop and the DRM's office: shop commands only, the shop's own accounts.
const handoutText = (h) => h
  .replace(/run DEMO‑DATA\.cmd \(laptop\) or <code>bash scripts\/rehearsal\.sh start<\/code> \(Mac\)/g, 'run DEMO‑DATA.cmd on the PC')
  .replace(/re-seed \(DEMO‑DATA\.cmd \/ rehearsal\.sh start\)/g, 're-seed with DEMO‑DATA.cmd on the PC')
  .replace(/run INDEX‑MANUALS\.cmd on the laptop \(the Mac does this in rehearsal\.sh start\)/g, 'run INDEX‑MANUALS.cmd on the PC')
  .replace(/Sign in as <b>inspector1<\/b> \/ password123\./g, 'Sign in with the inspector account you were given.')
  .replace(/https?:\/\/localhost:\d+/g, 'https://<the PC\'s address>')
  .replace(/in rehearsal/g, 'in this check').replace(/the rehearsal record/g, 'the demonstration record')
  .replace(/Sign in as inspector1\./g, 'Sign in as an inspector.')
  .replace(/Sign in as supervisor1\./g, 'Sign in as a supervisor.').replace(/Sign in as drm1\./g, 'Sign in as the DRM.').replace(/Sign in as admin1\./g, 'Sign in as the administrator.')
  .replace(/Sign in as <b>(supervisor1|drm1|admin1)<\/b> \/ password123\./g, 'Sign in with the account you were given.');
writeFileSync(outFile, HANDOUT ? handoutText(html) : html);
console.log(`${outFile} — ${matched}/${total} matched, ${byHand} by hand, ${result.steps.reduce((n, s) => n + s.shots.length, 0)} screenshots`);
