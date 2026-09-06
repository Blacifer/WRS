/**
 * One process for the concurrent lifecycle drill.
 *
 * Drives whole wagons through registration, the five stage transitions, all
 * forty-one checklist verdicts, a spring reading, the §720-C air brake test
 * and a signed release. Run by scripts/concurrent-lifecycle-drill.mjs, which
 * starts several of these against one database file; there is no reason to
 * run it directly.
 */
/** One process, driving wagons through the whole lifecycle to release. */
process.env.DB_PATH = process.argv[2];
const { createApp } = await import('/Users/patty/Desktop/WRS_Raipur/server/src/app.ts');
const { generateToken } = await import('/Users/patty/Desktop/WRS_Raipur/server/src/auth/jwt.ts');

const [, , dbPath, tag, countStr] = process.argv;
const app = createApp(dbPath);

const insp = generateToken({ id:'usr_insp_001', username:'inspector1', role:'INSPECTOR', name:'Ramesh Kumar', employeeId:'E' });
const sup  = generateToken({ id:'usr_sup_001', username:'supervisor1', role:'SUPERVISOR', name:'S. K. Verma', employeeId:'E' });
const hi = { authorization:`Bearer ${insp}`, 'content-type':'application/json' };
const hs = { authorization:`Bearer ${sup}`,  'content-type':'application/json' };

const SWT = [
  {ref:'1',value:5.0},{ref:'2',value:5.0},{ref:'3',value:0.05},{ref:'4.1',value:24},{ref:'4.2',value:3.8},
  {ref:'4.3',value:1.45},{ref:'5.1',value:52},{ref:'6',value:4},{ref:'7',observed:true},{ref:'8.1',value:25},
  {ref:'8.2',value:3.8},{ref:'9',value:85},{ref:'10',value:0.05},{ref:'12',observed:true}
];

const released = [];
const failures = [];

for (let i = 0; i < Number(countStr); i++) {
  const W = `SECR/BOXNHL/${tag}${String(i).padStart(3, '0')}`;
  try {
    await app.dispatch({ method:'POST', url:'/api/wagons/register', headers:hi,
      body:{ wagonNumber:W, wagonType:'BOXNHL', owningRailway:'SECR' } });

    for (const s of ['DISMANTLING','COMPONENT_INSPECTION','REPAIR_REPLACEMENT','REASSEMBLY','FINAL_QC_GATE'])
      await app.dispatch({ method:'POST', url:`/api/wagons/${W}/transition`, headers:hi, body:{ targetStage:s } });

    const chk = await app.dispatch({ method:'GET', url:`/api/wagons/${W}/checklist`, headers:hi });
    for (const it of chk.body.data.allItems)
      await app.dispatch({ method:'PUT', url:`/api/wagons/${W}/checklist/items/${it.id}`, headers:hi,
        body:{ status:'PASS', reinspectedStatus:'PASS', expectedUpdatedAt: it.updatedAt } });

    await app.dispatch({ method:'POST', url:'/api/inspections', headers:hi,
      body:{ wagonNumber:W, bogieType:'CASNUB_22_NLB', condition:'USED', springPosition:'OUTER', measuredFreeHeight:258.0 } });
    await app.dispatch({ method:'POST', url:`/api/wagons/${W}/swt`, headers:hi,
      body:{ wagonType:'BOXN', pipeType:'SINGLE', loadCondition:'EMPTY', readings:SWT } });

    const r = await app.dispatch({ method:'POST', url:'/api/auth/request-otp', headers:hs, body:{ action:'OVERRIDE' } });
    const v = await app.dispatch({ method:'POST', url:'/api/auth/verify-otp', headers:hs,
      body:{ otpId: r.body?.otpId, otpCode: r.body?.devOtpCode } });

    const rel = await app.dispatch({ method:'POST', url:`/api/wagons/${W}/gate/signoff`, headers:hs,
      body:{ otpToken: v.body?.otpToken ?? v.body?.data?.otpToken, notes:'Cleared.' } });

    if (rel.status === 200) released.push(rel.body.data.certificateNumber);
    else failures.push(`${W}: ${rel.status} ${String(rel.body?.message||'').slice(0,70)}`);
  } catch (e) {
    failures.push(`${W}: threw ${String(e.message).slice(0, 70)}`);
  }
}

process.stdout.write(JSON.stringify({ tag, released, failures }) + '\n');
