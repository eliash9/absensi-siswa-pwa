import {
  listSiswa, upsertSiswa, deleteSiswa, bulkUpsertSiswa,
  listGuru, upsertGuru, deleteGuru, bulkUpsertGuru,
  listMapel, upsertMapel, deleteMapel, bulkUpsertMapel,
  getSetting, setSetting
} from './db.js';
import { syncMasters, pullMastersFromSheet, syncNow, pullAbsensiForDate } from './sync.js';
import { getUnsynced, removeAbsen, listTemplates, upsertTemplate, deleteTemplate, updateAbsen } from './db.js';
import { showToast } from './ui.js';

const $ = (s)=>document.querySelector(s);

function csvParse(text){
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l=>l.trim().length>0);
  if(lines.length===0) return [];
  const split = (line)=>{
    const result=[]; let cur=''; let inQ=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){
        if(inQ && line[i+1]==='"'){ cur+='"'; i++; }
        else inQ=!inQ;
      }else if(ch===',' && !inQ){ result.push(cur); cur=''; }
      else{ cur+=ch; }
    }
    result.push(cur);
    return result.map(s=>s.trim());
  };
  const headers = split(lines[0]).map(h=>h.replace(/^"|"$/g,''));
  return lines.slice(1).map(line=>{
    const cells = split(line).map(c=>c.replace(/^"|"$/g,''));
    const obj={}; headers.forEach((h,idx)=>obj[h]=cells[idx]);
    return obj;
  });
}

function csvStringify(rows, headers){
  const esc = (v)=>{
    if(v==null) return '';
    const s = String(v);
    if(/[",\n]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
    return s;
  };
  const head = headers.join(',');
  const body = rows.map(r=>headers.map(h=>esc(r[h])).join(',')).join('\n');
  return head + (body? ('\n'+body):'');
}

function download(filename, content, type='text/plain'){
  const blob = new Blob([content], {type});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// Pengaturan GAS
async function initSettings(){
  const gas = await getSetting('GAS_WEB_APP_URL');
  $('#gasUrl').value = gas || '';
  $('#btnSaveGas').addEventListener('click', async ()=>{
    await setSetting('GAS_WEB_APP_URL', $('#gasUrl').value.trim());
    showToast('URL disimpan','success');
  });
  $('#btnTestGas').addEventListener('click', async ()=>{
    const url = $('#gasUrl').value.trim();
    if(!url){ alert('Isi URL terlebih dahulu.'); return; }
    try{
      const res = await fetch(url, { method: 'GET' });
      showToast(res.ok ? 'URL dapat diakses' : 'Gagal akses: '+res.status, res.ok?'success':'error');
    }catch(err){
      alert('Gagal akses: '+err);
    }
  });
  $('#btnSyncMasters').addEventListener('click', async ()=>{
    const btn = $('#btnSyncMasters');
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Menyinkron...';
    try{
      const res = await syncMasters();
      if(res?.error){
        if(res.reason==='missing_or_invalid_url') alert('URL Web App belum disetel atau tidak valid.');
        else if(res.reason==='offline') alert('Perangkat offline.');
        else alert('Gagal sinkron master.');
      }else{
        alert('Sinkron master selesai.');
      }
    }finally{
      btn.textContent = old; btn.disabled = false;
    }
  });
  // Sync Semua (range)
  document.getElementById('btnSyncAll')?.addEventListener('click', async ()=>{
    const btn = document.getElementById('btnSyncAll'); const info = document.getElementById('syncAllInfo');
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Menyinkron...'; if(info) info.textContent = '';
    try{
      const start = document.getElementById('syncStart').value;
      const end = document.getElementById('syncEnd').value;
      await syncNow();
      const sd = new Date(start); const ed = new Date(end);
      for(let d=new Date(sd); d<=ed; d.setDate(d.getDate()+1)){
        const iso = d.toISOString().slice(0,10);
        await pullAbsensiForDate(iso);
      }
      if(info) info.textContent = 'Selesai menyinkron rentang.';
      alert('Sinkron semua selesai.');
    }catch(err){
      alert('Gagal sinkron semua.');
    }finally{
      btn.textContent = old; btn.disabled = false;
    }
  });
  $('#btnPullMasters').addEventListener('click', async ()=>{
    const btn = $('#btnPullMasters');
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Mengambil...';
    try{
      const res = await pullMastersFromSheet();
      if(res?.error){
        if(res.reason==='missing_or_invalid_url') alert('URL Web App belum disetel atau tidak valid.');
        else if(res.reason==='offline') alert('Perangkat offline.');
        else showToast('Gagal mengambil master','error');
      }else{
        showToast(`Master diambil. Siswa: ${res.counts.siswa}, Guru: ${res.counts.guru}, Mapel: ${res.counts.mapel}`,'success');
        renderSiswa(); renderGuru(); renderMapel();
      }
    }finally{
      btn.textContent = old; btn.disabled = false;
    }
  });

  // Keamanan & Preferensi: load initial
  const lock = await getSetting('LOCK_SETTINGS');
  const pin = await getSetting('PIN');
  const tf = await getSetting('TIME_FORMAT');
  const tz = await getSetting('TZ');
  const kiosk = await getSetting('KIOSK');
  const lockEl = document.getElementById('lockSettings'); if(lockEl) lockEl.value = (lock? '1':'0');
  const tfEl = document.getElementById('timeFormat'); if(tfEl && tf) tfEl.value = tf;
  const tzEl = document.getElementById('tz'); if(tzEl && tz) tzEl.value = tz;
  const kioskEl = document.getElementById('kiosk'); if(kioskEl) kioskEl.value = (kiosk? '1':'0');

  // Protect settings with PIN if enabled
  if(lock && pin){
    const input = prompt('Masukkan PIN Pengaturan');
    if(input !== pin){
      alert('PIN salah. Kembali ke halaman utama.');
      location.href = '/index.html';
      return;
    }
  }

  document.getElementById('btnSaveSecurity')?.addEventListener('click', async ()=>{
    const pinVal = (document.getElementById('pinInput')?.value||'').trim();
    const lockVal = document.getElementById('lockSettings')?.value === '1';
    if(pinVal){ await setSetting('PIN', pinVal); }
    await setSetting('LOCK_SETTINGS', lockVal ? 1 : 0);
    showToast('Pengaturan keamanan disimpan','success');
    (document.getElementById('pinInput').value='');
  });
  document.getElementById('btnSavePrefs')?.addEventListener('click', async ()=>{
    const format = document.getElementById('timeFormat')?.value || 'ddmmyy';
    const tzSel = document.getElementById('tz')?.value || 'local';
    const kioskSel = document.getElementById('kiosk')?.value === '1';
    await setSetting('TIME_FORMAT', format);
    await setSetting('TZ', tzSel);
    await setSetting('KIOSK', kioskSel ? 1 : 0);
    showToast('Preferensi disimpan','success');
  });
  // init Sync Semua default dates (last 7 days)
  const end = new Date();
  const start = new Date(Date.now() - 6*24*60*60*1000);
  const toISO = (d)=> d.toISOString().slice(0,10);
  const elStart = document.getElementById('syncStart');
  const elEnd = document.getElementById('syncEnd');
  if(elStart) elStart.value = toISO(start);
  if(elEnd) elEnd.value = toISO(end);
}

// SISWA
async function renderSiswa(){
  const rows = await listSiswa();
  const q = ($('#siswaFilter').value||'').toLowerCase();
  const filtered = rows.filter(r=>!q || `${r.siswaId||''} ${r.nama||''} ${r.kelas||''}`.toLowerCase().includes(q));
  const tbody = $('#tbodySiswa');
  tbody.innerHTML = '';
  filtered.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-2">${r.siswaId}</td>
      <td class="px-3 py-2">${r.nama||''}</td>
      <td class="px-3 py-2">${r.kelas||''}</td>
      <td class="px-3 py-2 text-right">
        <button class="text-blue-600 hover:underline mr-3" data-id="${r.siswaId}" data-act="edit">Edit</button>
        <button class="text-green-600 hover:underline mr-3" data-id="${r.siswaId}" data-act="qrprint">Cetak QR</button>
        <button class="text-red-600 hover:underline" data-id="${r.siswaId}" data-act="del">Hapus</button>
      </td>`;
    tbody.appendChild(tr);
  });
  $('#siswaInfo').textContent = `${rows.length} data`;
  tbody.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const id = e.target.dataset.id;
      const act = e.target.dataset.act;
      if(act==='del'){
        if(confirm('Hapus siswa '+id+'?')){ await deleteSiswa(id); renderSiswa(); }
      }else if(act==='edit'){
        const row = (await listSiswa()).find(x=>x.siswaId===id);
        if(!row) return;
        const nama = prompt('Nama', row.nama||''); if(nama===null) return;
        const kelas = prompt('Kelas', row.kelas||''); if(kelas===null) return;
        await upsertSiswa({ siswaId:id, nama:nama.trim(), kelas:kelas.trim() });
        renderSiswa();
      }else if(act==='qrprint'){
        const row = (await listSiswa()).find(x=>x.siswaId===id);
        if(!row) return;
        await printQrCards([{ siswaId: row.siswaId, nama: row.nama, kelas: row.kelas }]);
      }
    });
  });
}

function bindSiswa(){
  $('#btnAddSiswa').addEventListener('click', async ()=>{
    const siswaId = $('#siswaIdInput').value.trim();
    const nama = $('#siswaNamaInput').value.trim();
    const kelas = $('#siswaKelasInput').value.trim();
    if(!siswaId || !nama){ alert('SiswaID dan Nama wajib.'); return; }
    await upsertSiswa({ siswaId, nama, kelas });
    $('#siswaIdInput').value=''; $('#siswaNamaInput').value=''; $('#siswaKelasInput').value='';
    renderSiswa();
  });
  $('#siswaFilter').addEventListener('input', renderSiswa);
  $('#btnImportSiswa').addEventListener('click', ()=> $('#fileImportSiswa').click());
  $('#fileImportSiswa').addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if(!file) return;
    const text = await file.text();
    const rows = csvParse(text);
    const prepared = rows.map(r=>({ siswaId:(r.siswaId||'').trim(), nama:(r.nama||'').trim(), kelas:(r.kelas||'').trim() })).filter(r=>r.siswaId && r.nama);
    if(!prepared.length){ alert('Tidak ada data valid.'); return; }
    await bulkUpsertSiswa(prepared);
    e.target.value='';
    renderSiswa();
  });
  $('#btnExportSiswa').addEventListener('click', async ()=>{
    const rows = await listSiswa();
    const headers=['siswaId','nama','kelas'];
    download('siswa.csv', csvStringify(rows, headers), 'text/csv');
  });
  $('#btnTemplateSiswa').addEventListener('click', ()=>{
    download('template-siswa.csv', 'siswaId,nama,kelas\n', 'text/csv');
  });
  $('#btnPrintQrFiltered').addEventListener('click', async ()=>{
    const rows = await listSiswa();
    const q = ($('#siswaFilter').value||'').toLowerCase();
    const filtered = rows.filter(r=>!q || `${r.siswaId||''} ${r.nama||''} ${r.kelas||''}`.toLowerCase().includes(q));
    if(!filtered.length){ alert('Tidak ada data untuk dicetak.'); return; }
    await printQrCards(filtered);
  });
}

async function getQR(){
  let QR = (window.QRCode && window.QRCode.toCanvas) ? window.QRCode : (window.qrcode && window.qrcode.toCanvas ? window.qrcode : null);
  if(QR) return QR;
  // Try local vendor (UMD) first for offline
  try{
    await loadScript('./js/vendor/qrcode.min.js');
    if(window.QRCode && window.QRCode.toCanvas){ return window.QRCode; }
  }catch(err){ console.warn('Gagal load vendor qrcode.min.js', err); }
  // Fallback to CDN ESM if available
  try{
    const mod = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.esm.js');
    QR = mod?.default || mod;
    if(QR && QR.toCanvas){ window.QRCode = QR; return QR; }
  }catch(err){ console.warn('Gagal memuat ESM QRCode', err); }
  return null;
}

function loadScript(src){
  return new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = ()=> resolve(); s.onerror = (e)=> reject(e);
    document.head.appendChild(s);
  });
}

async function printQrCards(rows){
  const QR = await getQR();
  if(!QR || !QR.toCanvas){ alert('Library QR belum dimuat. Periksa koneksi lalu coba lagi.'); return; }
  const size = 180; // px per QR
  const cards = [];
  for(const r of rows){
    const data = `${r.siswaId||''}|${r.nama||''}`;
    const canvas = document.createElement('canvas');
    await QR.toCanvas(canvas, data, { width: size, margin: 1 });
    const img = canvas.toDataURL('image/png');
    cards.push({ img, siswaId: r.siswaId||'', nama: r.nama||'', kelas: r.kelas||'' });
  }
  const html = `<!doctype html>
  <html><head><meta charset="utf-8"/>
  <title>QR Siswa</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#111827; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .card { border:1px solid #e5e7eb; border-radius:8px; padding:12px; text-align:center; }
    .card img { width: ${size}px; height: ${size}px; }
    .title { margin-top:8px; font-size:12px; font-weight:600; }
    .sub { font-size:11px; color:#6b7280; }
    .footer { font-size:10px; color:#9CA3AF; margin-top:6px; }
    @media print { .noprint{ display:none } }
  </style></head>
  <body>
    <div class="noprint" style="margin-bottom:8px; display:flex; gap:8px; align-items:center;">
      <button onclick="window.print()">Cetak</button>
      <button onclick="window.close()">Tutup</button>
    </div>
    <div class="grid">
      ${cards.map(c=>`
        <div class="card">
          <img src="${c.img}" alt="QR ${c.siswaId}">
          <div class="title">${escapeHtml(c.nama)}</div>
          <div class="sub">${escapeHtml(c.siswaId)}${c.kelas? ' • '+escapeHtml(c.kelas): ''}</div>
          
        </div>`).join('')}
    </div>
  </body></html>`;
  const w = window.open('', '_blank');
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"]/g, (ch)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[ch]));
}

// GURU
async function renderGuru(){
  const rows = await listGuru();
  const q = ($('#guruFilter').value||'').toLowerCase();
  const filtered = rows.filter(r=>!q || `${r.guruId||''} ${r.nama||''}`.toLowerCase().includes(q));
  const tbody = $('#tbodyGuru');
  tbody.innerHTML = '';
  filtered.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-2">${r.guruId}</td>
      <td class="px-3 py-2">${r.nama||''}</td>
      <td class="px-3 py-2 text-right">
        <button class="text-blue-600 hover:underline mr-3" data-id="${r.guruId}" data-act="edit">Edit</button>
        <button class="text-red-600 hover:underline" data-id="${r.guruId}" data-act="del">Hapus</button>
      </td>`;
    tbody.appendChild(tr);
  });
  $('#guruInfo').textContent = `${rows.length} data`;
  tbody.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const id = e.target.dataset.id;
      const act = e.target.dataset.act;
      if(act==='del'){
        if(confirm('Hapus guru '+id+'?')){ await deleteGuru(id); renderGuru(); }
      }else if(act==='edit'){
        const row = (await listGuru()).find(x=>x.guruId===id);
        if(!row) return;
        const nama = prompt('Nama', row.nama||''); if(nama===null) return;
        await upsertGuru({ guruId:id, nama:nama.trim() });
        renderGuru();
      }
    });
  });
}

function bindGuru(){
  $('#btnAddGuru').addEventListener('click', async ()=>{
    const guruId = $('#guruIdInput').value.trim();
    const nama = $('#guruNamaInput').value.trim();
    if(!guruId || !nama){ alert('GuruID dan Nama wajib.'); return; }
    await upsertGuru({ guruId, nama });
    $('#guruIdInput').value=''; $('#guruNamaInput').value='';
    renderGuru();
  });
  $('#guruFilter').addEventListener('input', renderGuru);
  $('#btnImportGuru').addEventListener('click', ()=> $('#fileImportGuru').click());
  $('#fileImportGuru').addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if(!file) return;
    const text = await file.text();
    const rows = csvParse(text);
    const prepared = rows.map(r=>({ guruId:(r.guruId||'').trim(), nama:(r.nama||'').trim() })).filter(r=>r.guruId && r.nama);
    if(!prepared.length){ alert('Tidak ada data valid.'); return; }
    await bulkUpsertGuru(prepared);
    e.target.value='';
    renderGuru();
  });
  $('#btnExportGuru').addEventListener('click', async ()=>{
    const rows = await listGuru();
    const headers=['guruId','nama'];
    download('guru.csv', csvStringify(rows, headers), 'text/csv');
  });
  $('#btnTemplateGuru').addEventListener('click', ()=>{
    download('template-guru.csv', 'guruId,nama\n', 'text/csv');
  });
}

// MAPEL
async function renderMapel(){
  const rows = await listMapel();
  const q = ($('#mapelFilter').value||'').toLowerCase();
  const filtered = rows.filter(r=>!q || `${r.mapelId||''} ${r.nama||''}`.toLowerCase().includes(q));
  const tbody = $('#tbodyMapel');
  tbody.innerHTML = '';
  filtered.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-2">${r.mapelId}</td>
      <td class="px-3 py-2">${r.nama||''}</td>
      <td class="px-3 py-2 text-right">
        <button class="text-blue-600 hover:underline mr-3" data-id="${r.mapelId}" data-act="edit">Edit</button>
        <button class="text-red-600 hover:underline" data-id="${r.mapelId}" data-act="del">Hapus</button>
      </td>`;
    tbody.appendChild(tr);
  });
  $('#mapelInfo').textContent = `${rows.length} data`;
  tbody.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const id = e.target.dataset.id;
      const act = e.target.dataset.act;
      if(act==='del'){
        if(confirm('Hapus mapel '+id+'?')){ await deleteMapel(id); renderMapel(); }
      }else if(act==='edit'){
        const row = (await listMapel()).find(x=>x.mapelId===id);
        if(!row) return;
        const nama = prompt('Nama', row.nama||''); if(nama===null) return;
        await upsertMapel({ mapelId:id, nama:nama.trim() });
        renderMapel();
      }
    });
  });
}

function bindMapel(){
  $('#btnAddMapel').addEventListener('click', async ()=>{
    const mapelId = $('#mapelIdInput').value.trim();
    const nama = $('#mapelNamaInput').value.trim();
    if(!mapelId || !nama){ alert('MapelID dan Nama wajib.'); return; }
    await upsertMapel({ mapelId, nama });
    $('#mapelIdInput').value=''; $('#mapelNamaInput').value='';
    renderMapel();
  });
  $('#mapelFilter').addEventListener('input', renderMapel);
  $('#btnImportMapel').addEventListener('click', ()=> $('#fileImportMapel').click());
  $('#fileImportMapel').addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if(!file) return;
    const text = await file.text();
    const rows = csvParse(text);
    const prepared = rows.map(r=>({ mapelId:(r.mapelId||'').trim(), nama:(r.nama||'').trim() })).filter(r=>r.mapelId && r.nama);
    if(!prepared.length){ alert('Tidak ada data valid.'); return; }
    await bulkUpsertMapel(prepared);
    e.target.value='';
    renderMapel();
  });
  $('#btnExportMapel').addEventListener('click', async ()=>{
    const rows = await listMapel();
    const headers=['mapelId','nama'];
    download('mapel.csv', csvStringify(rows, headers), 'text/csv');
  });
  $('#btnTemplateMapel').addEventListener('click', ()=>{
    download('template-mapel.csv', 'mapelId,nama\n', 'text/csv');
  });
}

window.addEventListener('DOMContentLoaded', async ()=>{
  await initSettings();
  bindSiswa(); bindGuru(); bindMapel();
  renderSiswa(); renderGuru(); renderMapel();
  bindCombined();
  bindQueue();
  bindTemplates();
  renderTemplates();
});

async function renderQueue(){
  const rows = await getUnsynced();
  const tbody = document.getElementById('tbodyQueue');
  const info = document.getElementById('queueInfo');
  if(!tbody) return;
  tbody.innerHTML = '';
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    const mapelAtauKeg = r.mode==='mapel' ? (r.mapel||'') : (r.kegiatan||'');
    tr.innerHTML = `
      <td class="px-3 py-2">${r.tanggal||''}</td>
      <td class="px-3 py-2">${r.waktu||''}</td>
      <td class="px-3 py-2">${r.nama||''} <span class="text-xs text-gray-400">(${r.siswaId||''})</span></td>
      <td class="px-3 py-2">${r.mode||''}</td>
      <td class="px-3 py-2">${mapelAtauKeg}</td>
      <td class="px-3 py-2 text-right">
        <button class="text-blue-600 hover:underline mr-3" data-id="${r.id}" data-act="edit">Edit</button>
        <button class="text-red-600 hover:underline" data-id="${r.id}" data-act="del">Hapus</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  if(info) info.textContent = `${rows.length} item belum sinkron`;
  tbody.querySelectorAll('button[data-act="del"]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const id = Number(e.target.getAttribute('data-id'));
      if(confirm('Hapus item dari antrian?')){
        await removeAbsen(id);
        renderQueue();
      }
    });
  });
  tbody.querySelectorAll('button[data-act="edit"]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const id = Number(e.target.getAttribute('data-id'));
      const r = rows.find(x=>x.id===id);
      if(!r) return;
      const status = prompt('Status (Hadir/Izin/Sakit/Alpa)', r.status||'Hadir');
      if(status===null) return;
      const alasan = prompt('Alasan/Keterangan', r.alasan||'');
      await updateAbsen(id, { status, alasan, synced:false });
      renderQueue();
    });
  });
}

function bindQueue(){
  document.getElementById('btnSyncQueue')?.addEventListener('click', async ()=>{
    const btn = document.getElementById('btnSyncQueue');
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Menyinkron...';
    try{ await syncNow(); } finally { btn.textContent = old; btn.disabled = false; renderQueue(); }
  });
  renderQueue();
}

async function renderTemplates(){
  const rows = await listTemplates();
  const tbody = document.getElementById('tbodyTemplates');
  const info = document.getElementById('templateInfo');
  if(!tbody) return;
  tbody.innerHTML = '';
  rows.forEach(t=>{
    const tr = document.createElement('tr');
    const mk = t.mode==='mapel' ? (t.mapel||'') : (t.kegiatan||'');
    tr.innerHTML = `
      <td class="px-3 py-2">${t.name}</td>
      <td class="px-3 py-2">${t.mode}</td>
      <td class="px-3 py-2">${mk}</td>
      <td class="px-3 py-2">${t.jamKe||''}</td>
      <td class="px-3 py-2">${t.penanggungJawab||''}</td>
      <td class="px-3 py-2">${t.lokasi||''}</td>
      <td class="px-3 py-2 text-right">
        <button class="text-blue-600 hover:underline mr-3" data-name="${t.name}" data-act="rename">Rename</button>
        <button class="text-red-600 hover:underline" data-name="${t.name}" data-act="del">Hapus</button>
      </td>`;
    tbody.appendChild(tr);
  });
  if(info) info.textContent = `${rows.length} template`;
  tbody.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const name = e.target.getAttribute('data-name');
      const act = e.target.getAttribute('data-act');
      if(act==='del'){
        if(confirm('Hapus template '+name+'?')){ await deleteTemplate(name); renderTemplates(); }
      }else if(act==='rename'){
        const newName = prompt('Nama template baru', name);
        if(newName && newName.trim()){
          const list = await listTemplates();
          const t = list.find(x=>x.name===name);
          if(t){ t.name = newName.trim(); await upsertTemplate(t); if(name!==t.name){ await deleteTemplate(name); } renderTemplates(); }
        }
      }
    });
  });
}

function bindTemplates(){
  const modeEl = document.getElementById('templateMode');
  const wrapMapel = document.getElementById('templateMapelWrap');
  const wrapKeg = document.getElementById('templateKegiatanWrap');
  const switchMode = ()=>{
    const m = modeEl.value;
    wrapMapel.classList.toggle('hidden', m!=='mapel');
    wrapKeg.classList.toggle('hidden', m!=='kegiatan');
  };
  modeEl?.addEventListener('change', switchMode);
  switchMode();

  document.getElementById('btnAddTemplate')?.addEventListener('click', async ()=>{
    const name = (document.getElementById('templateNameInput')?.value||'').trim();
    const mode = document.getElementById('templateMode')?.value || 'mapel';
    const mapel = (document.getElementById('templateMapel')?.value||'').trim();
    const kegiatan = (document.getElementById('templateKegiatan')?.value||'').trim();
    const jamKe = Number(document.getElementById('templateJamKe')?.value||1);
    const penanggungJawab = (document.getElementById('templatePJ')?.value||'').trim();
    const lokasi = (document.getElementById('templateLokasi')?.value||'').trim();
    if(!name){ alert('Nama template wajib.'); return; }
    if(mode==='mapel' && !mapel){ alert('Nama mapel wajib.'); return; }
    if(mode==='kegiatan' && !kegiatan){ alert('Nama kegiatan wajib.'); return; }
    await upsertTemplate({ name, mode, mapel, kegiatan, jamKe, penanggungJawab, lokasi });
    (document.getElementById('templateNameInput').value='');
    (document.getElementById('templateMapel').value='');
    (document.getElementById('templateKegiatan').value='');
    (document.getElementById('templateJamKe').value='');
    (document.getElementById('templatePJ').value='');
    (document.getElementById('templateLokasi').value='');
    renderTemplates();
  });
}

async function exportCombinedJSON(){
  const [siswa, guru, mapel] = await Promise.all([listSiswa(), listGuru(), listMapel()]);
  download('master.json', JSON.stringify({ siswa, guru, mapel }, null, 2), 'application/json');
}

async function exportCombinedZIP(){
  const JSZip = window.JSZip; if(!JSZip){ alert('JSZip belum dimuat'); return; }
  const [siswa, guru, mapel] = await Promise.all([listSiswa(), listGuru(), listMapel()]);
  const zip = new JSZip();
  const csvS = csvStringify(siswa, ['siswaId','nama','kelas']);
  const csvG = csvStringify(guru, ['guruId','nama']);
  const csvM = csvStringify(mapel, ['mapelId','nama']);
  zip.file('siswa.csv', csvS);
  zip.file('guru.csv', csvG);
  zip.file('mapel.csv', csvM);
  const blob = await zip.generateAsync({type:'blob'});
  download('master.zip', blob, 'application/zip');
}

function bindCombined(){
  $('#btnExportCombinedZip').addEventListener('click', exportCombinedZIP);
  $('#btnExportCombinedJson').addEventListener('click', exportCombinedJSON);
  $('#btnImportCombined').addEventListener('click', ()=> $('#fileImportCombined').click());
  $('#fileImportCombined').addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if(!file) return;
    try{
      if(file.name.toLowerCase().endsWith('.json')){
        const text = await file.text();
        const obj = JSON.parse(text||'{}');
        if(Array.isArray(obj.siswa)) await bulkUpsertSiswa(obj.siswa.map(r=>({ siswaId:r.siswaId, nama:r.nama, kelas:r.kelas })));
        if(Array.isArray(obj.guru)) await bulkUpsertGuru(obj.guru.map(r=>({ guruId:r.guruId, nama:r.nama })));
        if(Array.isArray(obj.mapel)) await bulkUpsertMapel(obj.mapel.map(r=>({ mapelId:r.mapelId, nama:r.nama })));
        alert('Import JSON selesai');
      }else if(file.name.toLowerCase().endsWith('.zip')){
        const JSZip = window.JSZip; if(!JSZip){ alert('JSZip belum dimuat'); return; }
        const zip = await JSZip.loadAsync(file);
        async function tryCsv(name){
          const f = zip.file(name) || zip.file(name.toUpperCase()) || zip.file(name.toLowerCase());
          if(!f) return null; return await f.async('string');
        }
        const sText = await tryCsv('siswa.csv');
        const gText = await tryCsv('guru.csv');
        const mText = await tryCsv('mapel.csv');
        if(sText){ const rows = csvParse(sText); const prepared = rows.map(r=>({ siswaId:(r.siswaId||'').trim(), nama:(r.nama||'').trim(), kelas:(r.kelas||'').trim() })).filter(r=>r.siswaId&&r.nama); await bulkUpsertSiswa(prepared); }
        if(gText){ const rows = csvParse(gText); const prepared = rows.map(r=>({ guruId:(r.guruId||'').trim(), nama:(r.nama||'').trim() })).filter(r=>r.guruId&&r.nama); await bulkUpsertGuru(prepared); }
        if(mText){ const rows = csvParse(mText); const prepared = rows.map(r=>({ mapelId:(r.mapelId||'').trim(), nama:(r.nama||'').trim() })).filter(r=>r.mapelId&&r.nama); await bulkUpsertMapel(prepared); }
        alert('Import ZIP selesai');
      }else{
        alert('Format file tidak didukung. Gunakan .json atau .zip');
      }
    }catch(err){
      alert('Gagal import: '+err);
    }finally{
      e.target.value='';
      renderSiswa(); renderGuru(); renderMapel();
    }
  });
}
