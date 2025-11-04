import { listAbsenToday } from './db.js';
import { syncNow, updateUnsyncedBadge, watchNetwork, pullAbsensiForDate } from './sync.js';
import { showToast } from './ui.js';

const $ = (s)=>document.querySelector(s);
let currentPage = 1;

function pad(n){ return n.toString().padStart(2,'0'); }
function todayISO(){ const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function formatTanggalID(iso){
  if(!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m){ return `${m[3]}/${m[2]}/${m[1]}`; }
  try{ const d = new Date(iso); if(!isNaN(d)) return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`; }catch{}
  return String(iso);
}
function normalizeWaktu(val){
  if(!val) return '';
  const s = String(val).trim();
  let m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(m){ const hh=pad(Number(m[1])); const mm=pad(Number(m[2])); const ss=pad(Number(m[3]||'0')); return `${hh}:${mm}:${ss}`; }
  try{ const d = new Date(s); if(!isNaN(d)) return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }catch{}
  return s;
}
function statusPillCls(s){
  const map = { Hadir:'bg-green-100', Izin:'bg-amber-100', Sakit:'bg-cyan-100', Alpa:'bg-red-100', Terlambat:'bg-yellow-100' };
  return map[s] || 'bg-gray-100';
}

async function renderHistory(){
  const tgl = $('#tanggalHistory')?.value || todayISO();
  const rows = await listAbsenToday(tgl);
  const q = ($('#filterQ')?.value || '').toLowerCase();
  const fStatus = $('#filterStatus')?.value || '';
  const fMode = $('#filterMode')?.value || '';
  const fSynced = $('#filterSynced')?.value || '';
  const filtered = rows.filter(r=>{
    if(fStatus && r.status !== fStatus) return false;
    if(fMode && r.mode !== fMode) return false;
    if(fSynced !== ''){ const want = fSynced==='1'; if(Boolean(r.synced)!==want) return false; }
    if(q){ const hay = `${r.nama||''} ${r.siswaId||''} ${r.mapel||''} ${r.kegiatan||''} ${r.penanggungJawab||''}`.toLowerCase(); if(!hay.includes(q)) return false; }
    return true;
  }).sort((a,b)=> (b.id||0)-(a.id||0));

  // Pagination
  const pageSizeEl = document.getElementById('pageSizeHist');
  const PAGE_SIZE = pageSizeEl ? Number(pageSizeEl.value||25) : 25;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if(currentPage > totalPages) currentPage = totalPages;
  if(currentPage < 1) currentPage = 1;
  const startIdx = (currentPage-1) * PAGE_SIZE;
  const pageRows = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  // Desktop table
  const tbody = document.getElementById('tbodyHist');
  if(tbody){
    tbody.innerHTML = '';
    pageRows.forEach(r=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-3 py-2 whitespace-nowrap">${formatTanggalID(r.tanggal)} ${normalizeWaktu(r.waktu)}</td>
        <td class="px-3 py-2">${r.nama} <span class="text-xs text-gray-400">(${r.siswaId||'-'})</span>${r.foto ? ' <span title="Ada foto">📷</span>' : ''}</td>
        <td class="px-3 py-2">${r.status}</td>
        <td class="px-3 py-2">${r.mode}</td>
        <td class="px-3 py-2">${r.mode==='mapel' ? (r.mapel||'-') : (r.kegiatan||'-')}</td>
        <td class="px-3 py-2">${r.jamKe||'-'}</td>
        <td class="px-3 py-2">${r.penanggungJawab||'-'}</td>
        <td class="px-3 py-2">${r.synced ? '✅' : '⏺'}</td>`;
      tbody.appendChild(tr);
    });
  }

  // Mobile cards
  const list = document.getElementById('listCards');
  if(list){
    list.innerHTML = '';
    pageRows.forEach(r=>{
      const el = document.createElement('div');
      el.className = 'surface p-3 rounded-lg';
      el.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="font-medium">${r.nama} <span class="text-xs text-gray-400">(${r.siswaId||'-'})</span>${r.foto ? ' <span title="Ada foto">📷</span>' : ''}</div>
            <div class="text-xs text-gray-500">${formatTanggalID(r.tanggal)} ${normalizeWaktu(r.waktu)}</div>
          </div>
          <span class="px-2 py-1 text-xs rounded ${statusPillCls(r.status)}">${r.status}</span>
        </div>
        <div class="mt-2 text-sm text-gray-700 flex flex-wrap gap-x-4 gap-y-1">
          <div><span class="text-gray-400">Mode:</span> ${r.mode}</div>
          <div><span class="text-gray-400">Mapel/Keg:</span> ${r.mode==='mapel' ? (r.mapel||'-') : (r.kegiatan||'-')}</div>
          <div><span class="text-gray-400">Jam:</span> ${r.jamKe||'-'}</div>
          <div><span class="text-gray-400">PJ:</span> ${r.penanggungJawab||'-'}</div>
          <div><span class="text-gray-400">Synced:</span> ${r.synced ? '✅' : '⏺'}</div>
        </div>`;
      list.appendChild(el);
    });
  }

  const info = document.getElementById('histInfo');
  if(info){ info.textContent = `${total} entri (hal ${currentPage}/${Math.max(1, Math.ceil(total/PAGE_SIZE))})`; }
  const pager = document.getElementById('pagerHist');
  if(pager){ pager.classList.toggle('hidden', total <= PAGE_SIZE); }
  const pageInfo = document.getElementById('pageInfoHist');
  if(pageInfo){ pageInfo.textContent = `Menampilkan ${total ? (startIdx+1) : 0}-${Math.min(startIdx+PAGE_SIZE, total)} dari ${total}`; }
  const prevBtn = document.getElementById('btnPrevHist');
  const nextBtn = document.getElementById('btnNextHist');
  if(prevBtn){ prevBtn.disabled = currentPage <= 1; }
  if(nextBtn){ nextBtn.disabled = currentPage >= Math.max(1, Math.ceil(total/PAGE_SIZE)); }
}

function bindUI(){
  const tanggal = document.getElementById('tanggalHistory');
  if(tanggal){ tanggal.value = todayISO(); tanggal.addEventListener('input', ()=>{ currentPage=1; renderHistory(); }); }
  ;['filterQ','filterStatus','filterMode','filterSynced'].forEach(id=>{
    const el = document.getElementById(id);
    if(el){ el.addEventListener('input', ()=>{ currentPage=1; renderHistory(); }); }
    if(el && el.tagName==='SELECT'){ el.addEventListener('change', ()=>{ currentPage=1; renderHistory(); }); }
  });
  document.getElementById('btnPrevHist')?.addEventListener('click', ()=>{ if(currentPage>1){ currentPage--; renderHistory(); } });
  document.getElementById('btnNextHist')?.addEventListener('click', ()=>{ currentPage++; renderHistory(); });
  document.getElementById('pageSizeHist')?.addEventListener('change', ()=>{ currentPage=1; renderHistory(); });

  // Export CSV (per tanggal yang dipilih)
  document.getElementById('btnExportCSVHistory')?.addEventListener('click', async ()=>{
    const tgl = $('#tanggalHistory')?.value || todayISO();
    const rows = await listAbsenToday(tgl);
    const header = ['tanggal','mode','jamKe','mapel','kegiatan','siswaId','nama','status','waktu','penanggungJawab','lokasi','alasan','synced'];
    const csv = [header.join(','), ...rows.map(r=>header.map(h=>JSON.stringify(r[h]??'')).join(','))].join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `absensi-${tgl}.csv`;
    a.click();
  });

  // Sync + pull date
  document.getElementById('btnSyncHist')?.addEventListener('click', async ()=>{
    const r = await syncNow();
    if(r?.error){
      if(r.reason === 'missing_or_invalid_url'){
        if(confirm('URL Web App belum disetel atau tidak valid. Buka Pengaturan sekarang?')){ location.href='settings.html'; }
      }else if(r.reason === 'offline'){
        showToast('Perangkat offline. Coba lagi saat online.','error');
      }else{
        showToast('Gagal sinkron. Coba lagi saat online.','error');
      }
    }else{ showToast(`Terkirim: ${r.sent||0}`,'success'); }
    const tgl = $('#tanggalHistory')?.value || todayISO();
    try{ await pullAbsensiForDate(tgl); }catch(e){}
    await renderHistory();
    updateUnsyncedBadge();
  });

  // Disable sync button when offline
  const syncBtn = document.getElementById('btnSyncHist');
  if(syncBtn){
    const set = ()=>{ syncBtn.disabled = !navigator.onLine; };
    window.addEventListener('online', set);
    window.addEventListener('offline', set);
    set();
  }
}

window.addEventListener('DOMContentLoaded', async ()=>{
  watchNetwork();
  bindUI();
  renderHistory();
  updateUnsyncedBadge();
});
