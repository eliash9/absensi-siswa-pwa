import { getUnsynced, markSynced, countUnsynced, getSetting, listSiswa, listGuru, listMapel, bulkUpsertSiswa, bulkUpsertGuru, bulkUpsertMapel, updateAbsen, saveAbsen, listAbsenToday, listAbsenRange } from './db.js';
const GAS_DEFAULT = '<<GAS_WEB_APP_URL>>'; // fallback jika belum disetel di Pengaturan

async function getGasUrl(){
  const v = await getSetting('GAS_WEB_APP_URL');
  return v || GAS_DEFAULT;
}

function isValidAbsoluteUrl(u){
  try{
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:';
  }catch{ return false; }
}

function parseTs(ts){
  const d = ts ? new Date(ts) : null;
  return d && !isNaN(d.getTime()) ? d.getTime() : 0;
}

export async function syncNow(){
  const items = await getUnsynced();
  if(!items.length) return {sent:0};
  try{
    const url = await getGasUrl();
    if(!isValidAbsoluteUrl(url)){
      return { error: true, reason: 'missing_or_invalid_url' };
    }
    if(!navigator.onLine){
      return { error: true, reason: 'offline' };
    }
    // sanitize payload to avoid sending large blobs (foto) or local-only fields
    const rows = items.map(r=>({
      id: r.id,
      tanggal: r.tanggal,
      mode: r.mode,
      jamKe: r.jamKe,
      mapel: r.mapel,
      kegiatan: r.kegiatan,
      siswaId: r.siswaId,
      nama: r.nama,
      status: r.status,
      waktu: r.waktu,
      penanggungJawab: r.penanggungJawab,
      synced: r.synced === true
    }));
    const payload = JSON.stringify({ rows });
    let res;
    try{
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: payload });
    }catch(err){
      // Fallback to text/plain to avoid CORS preflight issues on some GAS deployments
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type':'text/plain' }, body: payload });
    }
    if(!res.ok) throw new Error('Sync failed: status '+res.status);
    let json = null;
    try{ json = await res.json(); }catch{ /* non-JSON response; fallback below */ }
    if(json?.ok && Array.isArray(json.savedIds)){
      await markSynced(json.savedIds.filter(v=> typeof v === 'number' && Number.isFinite(v)));
    }else{
      // fallback: tandai semua sebagai synced bila server jawab OK
      await markSynced(items.map(i=>i.id));
    }
    return {sent: items.length};
  }catch(err){
    console.error('Sync error', err);
    return {error: true, reason: 'failed_fetch'};
  }finally{
    updateUnsyncedBadge();
  }
}

export async function updateUnsyncedBadge(){
  const el = document.getElementById('unsynced-badge');
  if(!el) return;
  const n = await countUnsynced();
  el.textContent = `Belum sinkron: ${n}`;
}

export function watchNetwork(){
  const badge = document.getElementById('net-badge');
  const btnSync = document.getElementById('btnSync');
  const set = ()=> {
    const online = navigator.onLine;
    badge.textContent = online ? 'Online' : 'Offline';
    badge.className = online
      ? 'px-2 py-1 text-xs rounded bg-green-100'
      : 'px-2 py-1 text-xs rounded bg-gray-200';
    if(btnSync){ btnSync.disabled = !online; }
    if(online) {
      // Push lokal lalu tarik absensi hari ini untuk menjaga konsistensi multi-perangkat
      const today = new Date().toISOString().slice(0,10);
      syncNow().finally(()=>{ try{ pullAbsensiForDate(today); }catch(e){} });
    }
  };
  window.addEventListener('online', set);
  window.addEventListener('offline', set);
  set();
}

export async function syncMasters(){
  try{
    const base = await getGasUrl();
    if(!isValidAbsoluteUrl(base)){
      return { error: true, reason: 'missing_or_invalid_url' };
    }
    if(!navigator.onLine){
      return { error: true, reason: 'offline' };
    }
    // Get current sheet masters
    const urlGet = base.includes('?') ? base + '&action=masters' : base + '?action=masters';
    const resGet = await fetch(urlGet);
    if(!resGet.ok) throw new Error('Get masters failed: status '+resGet.status);
    const js = await resGet.json();
    const sSheet = (Array.isArray(js.siswa)? js.siswa: []).reduce((m,r)=>{ m.set(String(r.siswaId), r); return m; }, new Map());
    const gSheet = (Array.isArray(js.guru)?  js.guru : []).reduce((m,r)=>{ m.set(String(r.guruId), r); return m; }, new Map());
    const mSheet = (Array.isArray(js.mapel)? js.mapel: []).reduce((m,r)=>{ m.set(String(r.mapelId), r); return m; }, new Map());
    // Local
    const [sLocalA, gLocalA, mLocalA] = await Promise.all([listSiswa(), listGuru(), listMapel()]);
    const sLocal = sLocalA.reduce((m,r)=>{ m.set(String(r.siswaId), r); return m; }, new Map());
    const gLocal = gLocalA.reduce((m,r)=>{ m.set(String(r.guruId), r); return m; }, new Map());
    const mLocal = mLocalA.reduce((m,r)=>{ m.set(String(r.mapelId), r); return m; }, new Map());

    const nowIso = new Date().toISOString();
    const upS = [];
    const upG = [];
    const upM = [];

    // Merge siswa
    const allSIds = new Set([...sSheet.keys(), ...sLocal.keys()]);
    for(const id of allSIds){
      const a = sLocal.get(id); const b = sSheet.get(id);
      if(a && !b){
        upS.push({ siswaId: id, nama: a.nama||'', kelas: a.kelas||'', updatedAt: a.updatedAt||nowIso });
      }else if(!a && b){
        await bulkUpsertSiswa([{ siswaId: id, nama: b.nama||'', kelas: b.kelas||'', updatedAt: b.updatedAt||nowIso }]);
      }else if(a && b){
        const ta = parseTs(a.updatedAt); const tb = parseTs(b.updatedAt);
        if(ta > tb){
          upS.push({ siswaId: id, nama: a.nama||'', kelas: a.kelas||'', updatedAt: a.updatedAt||nowIso });
        }else if(tb > ta){
          await bulkUpsertSiswa([{ siswaId: id, nama: b.nama||'', kelas: b.kelas||'', updatedAt: b.updatedAt||nowIso }]);
        }
      }
    }

    // Merge guru
    const allGIds = new Set([...gSheet.keys(), ...gLocal.keys()]);
    for(const id of allGIds){
      const a = gLocal.get(id); const b = gSheet.get(id);
      if(a && !b){
        upG.push({ guruId: id, nama: a.nama||'', updatedAt: a.updatedAt||nowIso });
      }else if(!a && b){
        await bulkUpsertGuru([{ guruId: id, nama: b.nama||'', updatedAt: b.updatedAt||nowIso }]);
      }else if(a && b){
        const ta = parseTs(a.updatedAt); const tb = parseTs(b.updatedAt);
        if(ta > tb) upG.push({ guruId: id, nama: a.nama||'', updatedAt: a.updatedAt||nowIso });
        else if(tb > ta) await bulkUpsertGuru([{ guruId: id, nama: b.nama||'', updatedAt: b.updatedAt||nowIso }]);
      }
    }

    // Merge mapel
    const allMIds = new Set([...mSheet.keys(), ...mLocal.keys()]);
    for(const id of allMIds){
      const a = mLocal.get(id); const b = mSheet.get(id);
      if(a && !b){
        upM.push({ mapelId: id, nama: a.nama||'', updatedAt: a.updatedAt||nowIso });
      }else if(!a && b){
        await bulkUpsertMapel([{ mapelId: id, nama: b.nama||'', updatedAt: b.updatedAt||nowIso }]);
      }else if(a && b){
        const ta = parseTs(a.updatedAt); const tb = parseTs(b.updatedAt);
        if(ta > tb) upM.push({ mapelId: id, nama: a.nama||'', updatedAt: a.updatedAt||nowIso });
        else if(tb > ta) await bulkUpsertMapel([{ mapelId: id, nama: b.nama||'', updatedAt: b.updatedAt||nowIso }]);
      }
    }

    // Push updates to sheet (upsert)
    if(upS.length || upG.length || upM.length){
      const payload = JSON.stringify({ action: 'mastersUpsert', siswa: upS, guru: upG, mapel: upM });
      let res;
      try{
        res = await fetch(base, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: payload });
      }catch(err){
        res = await fetch(base, { method: 'POST', headers: { 'Content-Type':'text/plain' }, body: payload });
      }
      if(!res.ok) throw new Error('Upsert masters failed: status '+res.status);
    }
    return { ok:true, pushed: { siswa: upS.length, guru: upG.length, mapel: upM.length } };
  }catch(err){
    console.error('Sync masters error', err);
    return { error: true, reason: 'failed_fetch' };
  }
}

export async function pullMastersFromSheet(){
  try{
    const base = await getGasUrl();
    if(!isValidAbsoluteUrl(base)){
      return { error: true, reason: 'missing_or_invalid_url' };
    }
    if(!navigator.onLine){
      return { error: true, reason: 'offline' };
    }
    const url = base.includes('?') ? base + '&action=masters' : base + '?action=masters';
    const res = await fetch(url, { method: 'GET' });
    if(!res.ok) throw new Error('Pull masters failed: status '+res.status);
    const json = await res.json();
    // Expect { ok:true, siswa:[], guru:[], mapel:[] } OR { ok:true, saved:{...} } from earlier saves
    const siswa = Array.isArray(json.siswa) ? json.siswa : [];
    const guru  = Array.isArray(json.guru) ? json.guru : [];
    const mapel = Array.isArray(json.mapel)? json.mapel: [];
    // Non-destructive local upsert
    await bulkUpsertSiswa(siswa.map(r=>({ siswaId: r.siswaId, nama: r.nama, kelas: r.kelas, updatedAt: r.updatedAt })));
    await bulkUpsertGuru(guru.map(r=>({ guruId: r.guruId, nama: r.nama, updatedAt: r.updatedAt })));
    await bulkUpsertMapel(mapel.map(r=>({ mapelId: r.mapelId, nama: r.nama, updatedAt: r.updatedAt })));
    return { ok: true, counts: { siswa: siswa.length, guru: guru.length, mapel: mapel.length } };
  }catch(err){
    console.error('Pull masters error', err);
    return { error: true, reason: 'failed_fetch' };
  }
}

// Pull absensi for a given date and merge into local (dedupe by natural key)
export async function pullAbsensiForDate(isoDate){
  try{
    const base = await getGasUrl();
    if(!isValidAbsoluteUrl(base)) return { error:true, reason:'missing_or_invalid_url' };
    const url = base + (base.includes('?') ? '&' : '?') + 'action=absensi&tanggal=' + encodeURIComponent(isoDate);
    const res = await fetch(url);
    if(!res.ok) throw new Error('Pull absensi failed: status '+res.status);
    const json = await res.json();
    const rows = Array.isArray(json.rows) ? json.rows : [];
    const localRows = await listAbsenToday(isoDate);
    const keyOf = (r)=> `${r.mode||''}|${Number(r.jamKe||1)}|${r.mapel||''}|${r.kegiatan||''}|${r.siswaId||''}`;
    const localMap = new Map(localRows.map(r=>[keyOf(r), r]));
    let added=0, updated=0;
    for(const r of rows){
      const key = keyOf(r);
      const exists = localMap.get(key);
      if(!exists){
        const entry = {
          tanggal: r.tanggal,
          mode: r.mode, jamKe: Number(r.jamKe||1), mapel: r.mapel||null, kegiatan: r.kegiatan||null,
          siswaId: r.siswaId, nama: r.nama, status: r.status, waktu: r.waktu || '', penanggungJawab: r.penanggungJawab || null,
          synced: true
        };
        await saveAbsen(entry); added++;
      }else{
        if(exists.synced !== false){ // do not override pending local changes
          const patch = { nama: r.nama, status: r.status, waktu: r.waktu || exists.waktu, penanggungJawab: r.penanggungJawab || exists.penanggungJawab, synced: true };
          await updateAbsen(exists.id, patch); updated++;
        }
      }
    }
    return { ok:true, added, updated };
  }catch(err){
    console.error('Pull absensi error', err);
    return { error:true, reason:'failed_fetch' };
  }
}

export async function exportReport(startIso, endIso){
  try{
    const base = await getGasUrl();
    if(!isValidAbsoluteUrl(base)) return { error:true, reason:'missing_or_invalid_url' };
    const rows = await listAbsenRange(startIso, endIso);
    const siswa = await listSiswa();
    const mapS = new Map(siswa.map(s=>[s.siswaId, s.kelas||'']));
    const out = rows.map(r=>({
      timestampLocal: new Date().toISOString(),
      tanggal: r.tanggal, siswaId: r.siswaId, nama: r.nama,
      kelas: mapS.get(r.siswaId)||'', guru: r.penanggungJawab||'',
      mode: r.mode||'', jamKe: r.jamKe||'', mapel: r.mapel||'', kegiatan: r.kegiatan||'',
      status: r.status||''
    }));
    const payload = JSON.stringify({ action:'reportUpsert', rows: out });
    let res;
    try{ res = await fetch(base, { method:'POST', headers:{'Content-Type':'application/json'}, body: payload }); }
    catch{ res = await fetch(base, { method:'POST', headers:{'Content-Type':'text/plain'}, body: payload }); }
    if(!res.ok) throw new Error('Export failed: '+res.status);
    return { ok:true, count: out.length };
  }catch(err){
    console.error('exportReport error', err);
    return { error:true, reason:'failed_fetch' };
  }
}
