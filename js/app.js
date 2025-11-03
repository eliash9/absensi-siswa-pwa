import db, { saveAbsen, listAbsenToday, removeAbsen, updateAbsen, listGuru, listMapel, findExistingAbsen, listSiswa, getSiswaById, listTemplates, upsertTemplate, getSetting } from './db.js';
import { startQR, stopQR } from './qr.js';
import { syncNow, updateUnsyncedBadge, watchNetwork, pullAbsensiForDate } from './sync.js';
import { showToast } from './ui.js';

const $ = (s)=>document.querySelector(s);
let TZ = 'local';
let TIME_FORMAT = 'ddmmyy';
const todayISO = ()=>{
  const d = new Date();
  const target = applyTz(d);
  const y = target.getFullYear();
  const m = String(target.getMonth()+1).padStart(2,'0');
  const dd = String(target.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
};
let currentPage = 1;

function pad(n){ return n.toString().padStart(2,'0'); }
function applyTz(d){
  if(TZ==='local') return d;
  const map = { WIB: 7*60, WITA: 8*60, WIT: 9*60 };
  const targetOff = map[TZ] ?? (-(d.getTimezoneOffset()));
  const localOff = -(d.getTimezoneOffset());
  const deltaMin = targetOff - localOff;
  return new Date(d.getTime() + deltaMin*60000);
}
function timeNow(){
  const d = applyTz(new Date());
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Formatters (Indonesia)
function formatTanggalID(iso){
  if(!iso) return '';
  // Avoid timezone shifts by manual parse
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m){ return TIME_FORMAT==='ddmmyy' ? `${m[3]}/${m[2]}/${m[1]}` : `${m[1]}-${m[2]}-${m[3]}`; }
  // Fallback
  try{
    const d = new Date(iso);
    if(!isNaN(d)) return TIME_FORMAT==='ddmmyy' ? `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}` : `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }catch{}
  return String(iso);
}
function normalizeWaktu(val){
  if(!val) return '';
  const s = String(val).trim();
  // Already HH:mm or HH:mm:ss
  let m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(m){
    const hh = pad(Number(m[1])); const mm = pad(Number(m[2])); const ss = pad(Number(m[3]||'0'));
    return `${hh}:${mm}:${ss}`;
  }
  // Try parse as Date string
  try{
    const d = new Date(s);
    if(!isNaN(d)) return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }catch{}
  return s;
}
function formatTanggalWaktuID(iso, waktu){
  return `${formatTanggalID(iso)} ${normalizeWaktu(waktu)}`.trim();
}

async function renderTable(){
  const rows = await listAbsenToday($('#tanggal').value || todayISO());
  // apply filters
  const q = ($('#filterQ')?.value || '').toLowerCase();
  const fStatus = $('#filterStatus')?.value || '';
  const fMode = $('#filterMode')?.value || '';
  const fSynced = $('#filterSynced')?.value || '';
  const filtered = rows.filter(r=>{
    if(fStatus && r.status !== fStatus) return false;
    if(fMode && r.mode !== fMode) return false;
    if(fSynced !== ''){
      const want = fSynced === '1';
      if(Boolean(r.synced) !== want) return false;
    }
    if(q){
      const hay = `${r.nama||''} ${r.siswaId||''} ${r.mapel||''} ${r.kegiatan||''} ${r.penanggungJawab||''}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
  const pageSizeEl = document.getElementById('pageSizeSelect');
  const PAGE_SIZE = pageSizeEl ? Number(pageSizeEl.value||25) : 25;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if(currentPage > totalPages) currentPage = totalPages;
  if(currentPage < 1) currentPage = 1;
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(startIdx, startIdx + PAGE_SIZE);
  const tbody = $('#tbody');
  tbody.innerHTML = '';
  pageRows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-2 whitespace-nowrap">${formatTanggalWaktuID(r.tanggal, r.waktu)}</td>
      <td class="px-3 py-2">${r.nama} <span class="text-xs text-gray-400">(${r.siswaId||'-'})</span>${r.foto ? ' <span title="Ada foto" aria-label="Ada foto">📷</span>' : ''}</td>
      <td class="px-3 py-2">${r.status}</td>
      <td class="px-3 py-2">${r.mode}</td>
      <td class="px-3 py-2">${r.mode==='mapel'? (r.mapel||'-') : (r.kegiatan||'-')}</td>
      <td class="px-3 py-2">${r.jamKe||'-'}</td>
      <td class="px-3 py-2">${r.penanggungJawab||'-'}</td>
      <td class="px-3 py-2">${r.synced ? '✅' : '⏺'}</td>
      <td class="px-3 py-2 text-right">
        <button data-id="${r.id}" class="text-blue-600 hover:underline edit mr-3">Edit</button>
        <button data-id="${r.id}" class="text-red-600 hover:underline del">Hapus</button>
      </td>`;
    tbody.appendChild(tr);
  });
  $('#rekapInfo').textContent = `${total} entri (hal ${currentPage}/${totalPages})`;
  const pager = document.getElementById('pager');
  if(pager){ pager.classList.toggle('hidden', total <= PAGE_SIZE); }
  const pageInfo = document.getElementById('pageInfo');
  if(pageInfo){ pageInfo.textContent = `Menampilkan ${total ? (startIdx+1) : 0}-${Math.min(startIdx+PAGE_SIZE, total)} dari ${total}`; }
  const prevBtn = document.getElementById('btnPrevPage');
  const nextBtn = document.getElementById('btnNextPage');
  if(prevBtn){ prevBtn.disabled = currentPage <= 1; }
  if(nextBtn){ nextBtn.disabled = currentPage >= totalPages; }
  tbody.querySelectorAll('.del').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      await removeAbsen(Number(e.target.dataset.id));
      renderTable();
      updateUnsyncedBadge();
    });
  });
  tbody.querySelectorAll('.edit').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const id = Number(e.target.dataset.id);
      const r = await db.absensi.get(id);
      if(!r) return;
      const tr = e.target.closest('tr');
      tr.innerHTML = `
        <td class="px-3 py-2 whitespace-nowrap">${r.waktu}</td>
        <td class="px-3 py-2">
          <input id="edNama" class="border rounded px-3 py-2" value="${r.nama||''}">
          <div class="text-xs text-gray-400 mt-1">ID: <input id="edSiswaId" class="border rounded px-2 py-1" style="width:10rem" value="${r.siswaId||''}"></div>
        </td>
        <td class="px-3 py-2">
          <select id="edStatus" class="border rounded px-2 py-1">
            ${['Hadir','Terlambat','Izin','Sakit','Alpa'].map(s=>`<option ${s===r.status?'selected':''}>${s}</option>`).join('')}
          </select>
        </td>
        <td class="px-3 py-2">${r.mode}</td>
        <td class="px-3 py-2">
          ${r.mode==='mapel'
            ? `<input id="edMapel" list="mapelList" class="border rounded px-3 py-2" value="${r.mapel||''}">`
            : `<input id="edKegiatan" class="border rounded px-3 py-2" value="${r.kegiatan||''}">`}
        </td>
        <td class="px-3 py-2"><input id="edJamKe" type="number" min="1" class="border rounded px-3 py-2" style="width:5rem" value="${r.jamKe||1}"></td>
        <td class="px-3 py-2"><input id="edPJ" list="guruList" class="border rounded px-3 py-2" value="${r.penanggungJawab||''}"></td>
        <td class="px-3 py-2">${r.synced ? '✅' : '⏺'}</td>
        <td class="px-3 py-2 text-right">
          <button data-id="${r.id}" class="text-green-600 hover:underline save mr-3">Simpan</button>
          <button class="text-gray-600 hover:underline cancel">Batal</button>
        </td>`;
      tr.querySelector('.save').addEventListener('click', async () =>{
        const patch = {
          nama: tr.querySelector('#edNama').value.trim(),
          siswaId: tr.querySelector('#edSiswaId').value.trim(),
          status: tr.querySelector('#edStatus').value,
          jamKe: Number(tr.querySelector('#edJamKe').value||1),
          penanggungJawab: tr.querySelector('#edPJ').value.trim() || null,
          synced: false
        };
        if(r.mode==='mapel') patch.mapel = tr.querySelector('#edMapel').value.trim() || null;
        else patch.kegiatan = tr.querySelector('#edKegiatan').value.trim() || null;
        await updateAbsen(id, patch);
        await renderTable();
        updateUnsyncedBadge();
      });
      tr.querySelector('.cancel').addEventListener('click', ()=>{ renderTable(); });
    });
  });
}

async function addAbsen({siswaId, nama, status}){
  const mode = $('#mode').value;
  const tanggal = $('#tanggal').value || todayISO();
  const jamKe = Number($('#jamKe').value||1);
  const mapelVal = ($('#mapel').value||'').trim();
  const kegiatanVal = ($('#kegiatan').value||'').trim();
  const waktu = timeNow();
  const penanggungJawabVal = ($('#penanggungJawab').value||'').trim();
  const lokasiVal = ($('#lokasi').value||'').trim();
  const alasanVal = ($('#alasan').value||'').trim();
  const fotoInput = document.getElementById('foto');
  const fotoFile = fotoInput && fotoInput.files && fotoInput.files[0] ? fotoInput.files[0] : null;
  // Validasi wajib: Guru/PJ dan Mapel/Kegiatan sesuai mode
  if(!penanggungJawabVal){ showToast('Nama Guru/PJ wajib diisi','error'); return; }
  if(mode==='mapel' && !mapelVal){ showToast('Mata pelajaran wajib diisi','error'); return; }
  if(mode==='kegiatan' && !kegiatanVal){ showToast('Nama kegiatan wajib diisi','error'); return; }
  const existing = await findExistingAbsen({ tanggal, siswaId, mode, jamKe, mapel: mapelVal||null, kegiatan: kegiatanVal||null });
  if(existing){
    await updateAbsen(existing.id, { nama, status, waktu, penanggungJawab: penanggungJawabVal, alasan: alasanVal||null, lokasi: lokasiVal||null, synced:false, ...(fotoFile? { foto: fotoFile } : {}) });
  }else{
    const entry = { tanggal, mode, jamKe, mapel: mapelVal||null, kegiatan: kegiatanVal||null, siswaId, nama, status, waktu, penanggungJawab: penanggungJawabVal, alasan: alasanVal||null, lokasi: lokasiVal||null, synced:false, ...(fotoFile? { foto: fotoFile } : {}) };
    await saveAbsen(entry);
  }
  await renderTable();
  updateUnsyncedBadge();
}

function bindUI(){
  // toggle mode UI
  $('#mode').addEventListener('change', (e)=>{
    const m = e.target.value;
    $('#mapel-wrap').classList.toggle('hidden', m!=='mapel');
    $('#kegiatan-wrap').classList.toggle('hidden', m!=='kegiatan');
  });

  // tanggal default
  $('#tanggal').value = todayISO();

  // manual input (validated against master siswa)
  $('#btnAbsen').addEventListener('click', async ()=>{
    const siswaId = $('#siswaId').value.trim();
    const status = $('#status').value;
    if(!siswaId){ alert('Pilih ID Siswa dari master.'); return; }
    const s = await getSiswaById(siswaId);
    if(!s){ alert('ID Siswa tidak ditemukan di master.'); return; }
    await addAbsen({siswaId, nama: s.nama, status});
    $('#siswaId').value=''; $('#namaSiswa').value='';
  });

  // export CSV lokal
  $('#btnExportCSV').addEventListener('click', async ()=>{
    const rows = await listAbsenToday($('#tanggal').value || todayISO());
    const header = ['tanggal','mode','jamKe','mapel','kegiatan','siswaId','nama','status','waktu','penanggungJawab','lokasi','alasan','synced'];
    const csv = [header.join(','), ...rows.map(r=>header.map(h=>JSON.stringify(r[h]??'')).join(','))].join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `absensi-${$('#tanggal').value||todayISO()}.csv`;
    a.click();
  });

  // QR
  $('#btnStartQR').addEventListener('click', async ()=>{
    await startQR(async (decodedText)=>{
      // Format QR: SISWAID|NAMASISWA  (contoh: S001|Budi Santoso)
      const [siswaId,nama] = decodedText.split('|');
      if(nama){
        await addAbsen({siswaId, nama, status:'Hadir'});
      }
    });
  });
  $('#btnStopQR').addEventListener('click', stopQR);

  // Sync
  $('#btnSync').addEventListener('click', async ()=>{
    const r = await syncNow();
    if(r?.error){
      if(r.reason === 'missing_or_invalid_url'){
        if(confirm('URL Web App belum disetel atau tidak valid. Buka Pengaturan sekarang?')){
          location.href = '/settings.html';
        }
      }else if(r.reason === 'offline'){
        showToast('Perangkat offline. Coba lagi saat online.','error');
      }else{
        showToast('Gagal sinkron. Coba lagi saat online.','error');
      }
    }
    else{ showToast(`Terkirim: ${r.sent||0}`,'success'); }
    // Pull absensi dari sheet untuk tanggal terpilih
    const tgl = $('#tanggal').value || todayISO();
    const pulled = await pullAbsensiForDate(tgl);
    if(pulled?.ok){ console.log('Pulled absensi', pulled); }
    await renderTable();
  });

  // Filters
  ['filterQ','filterStatus','filterMode','filterSynced','tanggal'].forEach(id=>{
    const el = document.getElementById(id);
    if(el){ el.addEventListener('input', ()=>{ currentPage = 1; renderTable(); }); }
    if(el && el.tagName === 'SELECT'){ el.addEventListener('change', ()=>{ currentPage = 1; renderTable(); }); }
  });
  document.getElementById('btnPrevPage')?.addEventListener('click', ()=>{ if(currentPage>1){ currentPage--; renderTable(); } });
  document.getElementById('btnNextPage')?.addEventListener('click', ()=>{ currentPage++; renderTable(); });
  const pageSizeEl = document.getElementById('pageSizeSelect');
  pageSizeEl?.addEventListener('change', ()=>{ currentPage = 1; renderTable(); });

  // populate datalists for master Mapel & Guru
  (async function populateMasters(){
    try{
      const [mapels, gurus] = await Promise.all([listMapel(), listGuru()]);
      const mapelList = document.getElementById('mapelList');
      const guruList = document.getElementById('guruList');
      if(mapelList){ mapelList.innerHTML = mapels.map(m=>`<option value="${m.nama}"></option>`).join(''); }
      if(guruList){ guruList.innerHTML = gurus.map(g=>`<option value="${g.nama}"></option>`).join(''); }
    }catch(err){ console.warn('Gagal memuat master', err); }
  })();
  // Visibility change: auto refresh masters & siswa
  document.addEventListener('repopulate', async ()=>{
    try{
      const [mapels, gurus, siswa] = await Promise.all([listMapel(), listGuru(), listSiswa()]);
      const mapelList = document.getElementById('mapelList');
      const guruList = document.getElementById('guruList');
      const siswaList = document.getElementById('siswaList');
      if(mapelList){ mapelList.innerHTML = mapels.map(m=>`<option value="${m.nama}"></option>`).join(''); }
      if(guruList){ guruList.innerHTML = gurus.map(g=>`<option value="${g.nama}"></option>`).join(''); }
      if(siswaList){ siswaList.innerHTML = siswa.map(s=>`<option value="${s.siswaId}" label="${s.siswaId} - ${s.nama}${s.kelas? ' ('+s.kelas+')':''}"></option>`).join(''); }
      showToast('Master diperbarui','success',1500);
    }catch(err){ console.warn('Repopulate gagal', err); }
  });

  // populate datalist Siswa and auto-fill nama
  (async function populateSiswa(){
    try{
      const siswa = await listSiswa();
      const list = document.getElementById('siswaList');
      if(list){
        list.innerHTML = siswa.map(s=>`<option value="${s.siswaId}" label="${s.siswaId} - ${s.nama}${s.kelas? ' ('+s.kelas+')':''}"></option>`).join('');
      }
    }catch(err){ console.warn('Gagal memuat siswa', err); }
  })();
  const idInput = document.getElementById('siswaId');
  if(idInput){
    const autofill = async ()=>{
      const s = await getSiswaById(idInput.value.trim());
      const nameEl = document.getElementById('namaSiswa');
      if(nameEl) nameEl.value = s?.nama || '';
    };
    idInput.addEventListener('change', autofill);
    idInput.addEventListener('input', autofill);
  }

  // Templates
  (async function populateTemplates(){
    try{
      const templates = await listTemplates();
      const dl = document.getElementById('templateList');
      if(dl){ dl.innerHTML = templates.map(t=>`<option value="${t.name}"></option>`).join(''); }
    }catch(err){ console.warn('Gagal memuat template', err); }
  })();
  document.getElementById('btnApplyTemplate')?.addEventListener('click', async ()=>{
    const name = (document.getElementById('templateInput')?.value || '').trim();
    if(!name) return;
    const arr = await listTemplates();
    const t = arr.find(x=>x.name===name);
    if(!t) { alert('Template tidak ditemukan'); return; }
    if(t.mode){ $('#mode').value = t.mode; $('#mode').dispatchEvent(new Event('change')); }
    if(t.mode==='mapel'){ $('#mapel').value = t.mapel||''; }
    if(t.mode==='kegiatan'){ $('#kegiatan').value = t.kegiatan||''; }
    if(t.jamKe){ $('#jamKe').value = t.jamKe; }
    if(t.penanggungJawab){ $('#penanggungJawab').value = t.penanggungJawab; }
    if(t.lokasi){ $('#lokasi').value = t.lokasi; }
  });
  document.getElementById('btnSaveTemplate')?.addEventListener('click', async ()=>{
    const defaultName = document.getElementById('templateInput')?.value || '';
    const name = prompt('Nama template', defaultName.trim());
    if(!name) return;
    const mode = $('#mode').value;
    const obj = {
      name: name.trim(),
      mode,
      mapel: mode==='mapel' ? ($('#mapel').value||'').trim() : '',
      kegiatan: mode==='kegiatan' ? ($('#kegiatan').value||'').trim() : '',
      jamKe: Number($('#jamKe').value||1),
      penanggungJawab: ($('#penanggungJawab').value||'').trim(),
      lokasi: ($('#lokasi').value||'').trim()
    };
    await upsertTemplate(obj);
    const dl = document.getElementById('templateList');
    if(dl){ const opt = document.createElement('option'); opt.value = obj.name; dl.appendChild(opt); }
    alert('Template disimpan');
  });
}

window.addEventListener('DOMContentLoaded', async ()=>{
  // Load time preferences and kiosk
  try{
    TIME_FORMAT = (await getSetting('TIME_FORMAT')) || 'ddmmyy';
    TZ = (await getSetting('TZ')) || 'local';
    const KIOSK = await getSetting('KIOSK');
    if(KIOSK){
      try{ document.documentElement.requestFullscreen?.(); }catch{}
      try{
        if('wakeLock' in navigator){
          // @ts-ignore
          navigator.wakeLock.request('screen').catch(()=>{});
        }
      }catch{}
    }
  }catch{}
  bindUI();
  watchNetwork();
  renderTable();
  updateUnsyncedBadge();
});
