// Dexie via global vendor (offline-first)
const Dexie = window.Dexie;
// Dexie schema
const db = new Dexie('absensi_db');
// v1: initial schema
db.version(1).stores({
  absensi: '++id, tanggal, mode, jamKe, mapel, kegiatan, siswaId, nama, status, waktu, synced',
  siswa: 'siswaId, nama'
});
// v2: add penanggungJawab (indexed for optional filtering)
db.version(2).stores({
  absensi: '++id, tanggal, mode, jamKe, mapel, kegiatan, siswaId, nama, status, waktu, penanggungJawab, synced',
  siswa: 'siswaId, nama'
});
// v3: add guru, mapel, settings stores
db.version(3).stores({
  absensi: '++id, tanggal, mode, jamKe, mapel, kegiatan, siswaId, nama, status, waktu, penanggungJawab, synced',
  siswa: 'siswaId, nama, kelas',
  guru: 'guruId, nama',
  mapel: 'mapelId, nama',
  settings: 'key'
});

// v4: add updatedAt on master tables
db.version(4).stores({
  absensi: '++id, tanggal, mode, jamKe, mapel, kegiatan, siswaId, nama, status, waktu, penanggungJawab, synced',
  siswa: 'siswaId, nama, kelas, updatedAt',
  guru: 'guruId, nama, updatedAt',
  mapel: 'mapelId, nama, updatedAt',
  settings: 'key'
});

// v5: add alasan, lokasi on absensi and templates store
db.version(5).stores({
  absensi: '++id, tanggal, mode, jamKe, mapel, kegiatan, siswaId, nama, status, waktu, penanggungJawab, alasan, lokasi, synced',
  siswa: 'siswaId, nama, kelas, updatedAt',
  guru: 'guruId, nama, updatedAt',
  mapel: 'mapelId, nama, updatedAt',
  settings: 'key',
  templates: 'name'
});

export async function saveAbsen(entry){
  return db.absensi.add(entry);
}
export async function listAbsenToday(isoDate){
  const key = (typeof isoDate === 'string' && isoDate) ? isoDate : new Date().toISOString().slice(0,10);
  try{
    return await db.absensi.where('tanggal').equals(key).sortBy('id');
  }catch(err){
    console.warn('listAbsenToday: fallback due to invalid key', err);
    return [];
  }
}
export async function listAbsenRange(startIso, endIso){
  const s = (typeof startIso==='string' && startIso) ? startIso : '0000-01-01';
  const e = (typeof endIso==='string' && endIso) ? endIso : '9999-12-31';
  try{
    return await db.absensi.where('tanggal').between(s, e, true, true).toArray();
  }catch(err){
    console.warn('listAbsenRange error', err);
    // fallback: full scan
    return (await db.absensi.toArray()).filter(r=> r.tanggal>=s && r.tanggal<=e);
  }
}
export async function markSynced(ids){
  const keys = (Array.isArray(ids)? ids: []).filter(v=> typeof v === 'number' && Number.isFinite(v));
  if(!keys.length) return 0;
  return db.absensi.where('id').anyOf(keys).modify({synced:true});
}
export async function getUnsynced(){
  try{
    // Treat missing/undefined as unsynced too
    return await db.absensi.filter(r => r.synced !== true).toArray();
  }catch(err){
    console.warn('getUnsynced error', err);
    return [];
  }
}
export async function removeAbsen(id){
  return db.absensi.delete(id);
}
export async function countUnsynced(){
  try{
    return await db.absensi.filter(r => r.synced !== true).count();
  }catch(err){
    console.warn('countUnsynced error', err);
    return 0;
  }
}
export async function updateAbsen(id, patch){
  return db.absensi.update(id, patch);
}

export async function findExistingAbsen({ tanggal, siswaId, mode, jamKe, mapel, kegiatan }){
  if(!tanggal || !siswaId || !mode) return null;
  const tgtJam = Number(jamKe||1);
  const m = mode;
  const keyMapel = (mapel ?? null);
  const keyKeg = (kegiatan ?? null);
  return db.absensi
    .where('tanggal').equals(tanggal)
    .and(r => r.siswaId === siswaId
      && r.mode === m
      && Number(r.jamKe||1) === tgtJam
      && (m === 'mapel' ? (r.mapel ?? null) === keyMapel : (r.kegiatan ?? null) === keyKeg)
    )
    .first();
}

// Master Siswa
export async function listSiswa(){
  return db.siswa.orderBy('siswaId').toArray();
}
export async function upsertSiswa(row){
  const now = new Date().toISOString();
  return db.siswa.put({ ...row, updatedAt: row.updatedAt || now });
}
export async function deleteSiswa(siswaId){
  return db.siswa.delete(siswaId);
}
export async function bulkUpsertSiswa(rows){
  const now = new Date().toISOString();
  return db.siswa.bulkPut(rows.map(r=>({ ...r, updatedAt: r.updatedAt || now })));
}
export async function getSiswaById(siswaId){
  if(!siswaId) return null;
  return db.siswa.get(siswaId);
}
export async function replaceMasterSiswa(rows){
  await db.siswa.clear();
  if(Array.isArray(rows) && rows.length){
    await db.siswa.bulkPut(rows.map(r=>({ siswaId: r.siswaId, nama: r.nama, kelas: r.kelas })));
  }
}

// Master Guru
export async function listGuru(){
  return db.guru.orderBy('guruId').toArray();
}
export async function upsertGuru(row){
  const now = new Date().toISOString();
  return db.guru.put({ ...row, updatedAt: row.updatedAt || now });
}
export async function deleteGuru(guruId){
  return db.guru.delete(guruId);
}
export async function bulkUpsertGuru(rows){
  const now = new Date().toISOString();
  return db.guru.bulkPut(rows.map(r=>({ ...r, updatedAt: r.updatedAt || now })));
}
export async function replaceMasterGuru(rows){
  await db.guru.clear();
  if(Array.isArray(rows) && rows.length){
    await db.guru.bulkPut(rows.map(r=>({ guruId: r.guruId, nama: r.nama })));
  }
}

// Master Mapel
export async function listMapel(){
  return db.mapel.orderBy('mapelId').toArray();
}
export async function upsertMapel(row){
  const now = new Date().toISOString();
  return db.mapel.put({ ...row, updatedAt: row.updatedAt || now });
}
export async function deleteMapel(mapelId){
  return db.mapel.delete(mapelId);
}
export async function bulkUpsertMapel(rows){
  const now = new Date().toISOString();
  return db.mapel.bulkPut(rows.map(r=>({ ...r, updatedAt: r.updatedAt || now })));
}
export async function replaceMasterMapel(rows){
  await db.mapel.clear();
  if(Array.isArray(rows) && rows.length){
    await db.mapel.bulkPut(rows.map(r=>({ mapelId: r.mapelId, nama: r.nama })));
  }
}

// Settings
export async function getSetting(key){
  const row = await db.settings.get(key);
  return row ? row.value : null;
}
export async function setSetting(key, value){
  return db.settings.put({ key, value });
}

// Templates (mapel/kegiatan prefill)
export async function listTemplates(){
  return db.templates.toArray();
}
export async function upsertTemplate(t){
  // t: { name, mode, mapel, kegiatan, jamKe, penanggungJawab, lokasi }
  return db.templates.put(t);
}
export async function deleteTemplate(name){
  return db.templates.delete(name);
}
export default db;
