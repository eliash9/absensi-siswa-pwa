import db, { listAbsenToday, listAbsenRange, countUnsynced, listSiswa, listGuru, listMapel } from './db.js';
import { exportReport } from './sync.js';
import { showToast } from './ui.js';

const $ = (s)=>document.querySelector(s);
const todayISO = ()=> new Date().toISOString().slice(0,10);
function pad(n){ return n.toString().padStart(2,'0'); }
function formatTanggalID(iso){
  if(!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m){ return `${m[3]}/${m[2]}/${m[1]}`; }
  try{ const d = new Date(iso); if(!isNaN(d)) return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`; }catch{}
  return String(iso);
}

function getRange(){
  const mode = document.getElementById('rangeSelect').value;
  const base = new Date(document.getElementById('tanggal').value || todayISO());
  let s,e;
  if(mode==='today'){
    const iso = todayISO(); s=iso; e=iso;
  }else if(mode==='week'){
    const d = new Date(base); const day = d.getDay(); // 0 Sun ... 6 Sat
    const diff = (day+6)%7; // make Monday start
    const start = new Date(d); start.setDate(d.getDate()-diff);
    const end = new Date(start); end.setDate(start.getDate()+6);
    s = start.toISOString().slice(0,10); e = end.toISOString().slice(0,10);
  }else if(mode==='month'){
    const d = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth()+1, 0);
    s = d.toISOString().slice(0,10); e = end.toISOString().slice(0,10);
  }else{
    s = document.getElementById('startDate').value || todayISO();
    e = document.getElementById('endDate').value || todayISO();
  }
  return {start:s, end:e};
}

async function refreshCards(){
  const tgl = $('#tanggal').value || todayISO();
  const rows = await listAbsenToday(tgl);
  const unsynced = await countUnsynced();
  const [siswa, guru, mapel] = await Promise.all([listSiswa(), listGuru(), listMapel()]);
  $('#cardTotal').textContent = rows.length;
  $('#cardUnsynced').textContent = unsynced;
  $('#cardSiswa').textContent = siswa.length;
  $('#cardGuru').textContent = guru.length;
  $('#cardMapel').textContent = mapel.length;
  const {start,end} = getRange();
  $('#dateInfo').textContent = `Rekap: ${formatTanggalID(start)} – ${formatTanggalID(end)}`;
}

let chart;
let barChart;
let stackedChart;
function buildChartConfig(data){
  const labels = ['Hadir','Izin','Sakit','Alpa'];
  const colors = ['#22c55e','#f59e0b','#06b6d4','#ef4444'];
  return {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors }] },
    options: { plugins: { legend: { position: 'bottom' } } }
  };
}

async function refreshChart(){
  const {start,end} = getRange();
  const rows = await listAbsenRange(start,end);
  const counts = { Hadir:0, Izin:0, Sakit:0, Alpa:0 };
  rows.forEach(r=>{ counts[r.status] = (counts[r.status]||0)+1; });
  const data = [counts.Hadir||0, counts.Izin||0, counts.Sakit||0, counts.Alpa||0];
  const ctx = document.getElementById('statusChart');
  if(!window.Chart){
    $('#chartInfo').textContent = 'Chart belum dimuat';
    return;
  }
  if(chart){ chart.destroy(); }
  chart = new Chart(ctx, buildChartConfig(data));
  $('#chartInfo').textContent = `${rows.length} entri`;
}

function buildBarConfig(labels, data){
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Jumlah',
        data,
        backgroundColor: '#60a5fa'
      }]
    },
    options: {
      scales: { y: { beginAtZero: true, ticks: { precision:0 } } },
      plugins: { legend: { display: false } }
    }
  };
}

async function refreshBarChart(){
  const {start,end} = getRange();
  const rows = await listAbsenRange(start,end);
  const group = $('#barGroup').value || 'jam';
  let labels=[], data=[], info='';
  if(group === 'jam'){
    const map = new Map();
    rows.forEach(r=>{
      const k = Number(r.jamKe||1);
      map.set(k, (map.get(k)||0)+1);
    });
    labels = Array.from(map.keys()).sort((a,b)=>a-b).map(n=>`Jam ${n}`);
    data = Array.from(map.keys()).sort((a,b)=>a-b).map(k=>map.get(k));
    info = `Jumlah per Jam Ke`;
  }else{
    const map = new Map();
    rows.forEach(r=>{
      const k = r.mode||'-';
      map.set(k, (map.get(k)||0)+1);
    });
    const order = ['mapel','kegiatan'];
    labels = Array.from(map.keys()).sort((a,b)=> order.indexOf(a)-order.indexOf(b)).map(k=> k==='mapel'?'Mapel':'Kegiatan');
    data = Array.from(map.keys()).sort((a,b)=> order.indexOf(a)-order.indexOf(b)).map(k=>map.get(k));
    info = `Jumlah per Mode`;
  }
  const ctx = document.getElementById('barChart');
  if(!window.Chart){
    $('#barInfo').textContent = 'Chart belum dimuat';
    return;
  }
  if(barChart){ barChart.destroy(); }
  barChart = new Chart(ctx, buildBarConfig(labels, data));
  $('#barInfo').textContent = info;
}

async function refreshRecap(){
  const {start,end} = getRange();
  const rows = await listAbsenRange(start,end);
  const groupBy = document.getElementById('groupBy').value;
  document.getElementById('groupLabel').textContent = groupBy==='kelas'?'Kelas':'Guru';
  const siswa = await listSiswa();
  const siswaMap = new Map(siswa.map(s=>[s.siswaId, s.kelas||'-']));
  const rec = new Map();
  rows.forEach(r=>{
    const key = groupBy==='kelas' ? (siswaMap.get(r.siswaId)||'-') : (r.penanggungJawab||'-');
    const obj = rec.get(key) || { Hadir:0, Izin:0, Sakit:0, Alpa:0, Terlambat:0 };
    obj[r.status] = (obj[r.status]||0)+1;
    rec.set(key, obj);
  });
  const tbody = document.getElementById('tbodyRecap');
  tbody.innerHTML = '';
  Array.from(rec.entries()).sort((a,b)=>{
    const ta = (a[1].Hadir||0)+(a[1].Izin||0)+(a[1].Sakit||0)+(a[1].Alpa||0)+(a[1].Terlambat||0);
    const tb = (b[1].Hadir||0)+(b[1].Izin||0)+(b[1].Sakit||0)+(b[1].Alpa||0)+(b[1].Terlambat||0);
    return tb - ta;
  }).forEach(([key, v])=>{
    const tr = document.createElement('tr');
    const total = (v.Hadir||0)+(v.Izin||0)+(v.Sakit||0)+(v.Alpa||0)+(v.Terlambat||0);
    tr.innerHTML = `
      <td class="px-3 py-2 font-medium">${key}</td>
      <td class="px-3 py-2">${v.Hadir||0}</td>
      <td class="px-3 py-2">${v.Izin||0}</td>
      <td class="px-3 py-2">${v.Sakit||0}</td>
      <td class="px-3 py-2">${v.Alpa||0}</td>
      <td class="px-3 py-2">${v.Terlambat||0}</td>
      <td class="px-3 py-2">${total}</td>`;
    tbody.appendChild(tr);
  });
}

async function refreshTopAndHeatmap(){
  const {start,end} = getRange();
  const rows = await listAbsenRange(start,end);
  // Top hadir / terlambat per siswa
  const hadirMap = new Map();
  const lateMap = new Map();
  rows.forEach(r=>{
    if(r.status==='Hadir') hadirMap.set(r.nama, (hadirMap.get(r.nama)||0)+1);
    if(r.status==='Terlambat') lateMap.set(r.nama, (lateMap.get(r.nama)||0)+1);
  });
  const topHadir = Array.from(hadirMap.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const topLate  = Array.from(lateMap.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const ulH = document.getElementById('listTopHadir'); ulH.innerHTML='';
  topHadir.forEach(([nama,c])=>{ const li=document.createElement('li'); li.textContent = `${nama} — ${c}`; ulH.appendChild(li); });
  const ulL = document.getElementById('listTopLate'); ulL.innerHTML='';
  if(topLate.length){ topLate.forEach(([nama,c])=>{ const li=document.createElement('li'); li.textContent = `${nama} — ${c}`; ulL.appendChild(li); }); } else { ulL.innerHTML = '<li>Tidak ada data</li>'; }

  // Top Mapel/Kegiatan bar chart
  const map = new Map();
  rows.forEach(r=>{
    const k = r.mode==='mapel' ? `Mapel: ${r.mapel||''}` : `Kegiatan: ${r.kegiatan||''}`;
    map.set(k, (map.get(k)||0)+1);
  });
  const sorted = Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const labels = sorted.map(x=>x[0]);
  const data = sorted.map(x=>x[1]);
  const ctx = document.getElementById('topMKChart');
  if(window.Chart){
    if(window._topMKChart) window._topMKChart.destroy();
    window._topMKChart = new Chart(ctx, buildBarConfig(labels, data));
  }

  // Heatmap jamKe (1..12)
  const heat = new Map(); let max=0;
  rows.forEach(r=>{ const j=Number(r.jamKe||1); const v=(heat.get(j)||0)+1; heat.set(j,v); if(v>max) max=v; });
  const cont = document.getElementById('heatmap'); cont.innerHTML='';
  const maxJam = Math.max(1, ...Array.from(heat.keys()));
  for(let j=1;j<=Math.max(maxJam,12);j++){
    const v = heat.get(j)||0; const opacity = max? (0.15 + 0.85*(v/max)) : 0.15;
    const cell = document.createElement('div');
    cell.title = `Jam ${j}: ${v}`;
    cell.style.height='28px'; cell.style.borderRadius='4px'; cell.style.background=`rgba(59,130,246,${opacity})`;
    cont.appendChild(cell);
  }
}

async function refreshStacked(){
  const {start,end} = getRange();
  const rows = await listAbsenRange(start,end);
  const labels = Array.from(new Set(rows.map(r=>Number(r.jamKe||1)).sort((a,b)=>a-b)));
  const statuses = ['Hadir','Terlambat','Izin','Sakit','Alpa'];
  const datasets = statuses.map((st, idx)=>{
    const data = labels.map(j=> rows.filter(r=> Number(r.jamKe||1)===j && r.status===st).length );
    const colors = ['#22c55e','#f59e0b','#06b6d4','#a78bfa','#ef4444'];
    return { label: st, data, backgroundColor: colors[idx%colors.length], stack: 'status' };
  });
  const ctx = document.getElementById('stackedChart');
  if(!window.Chart) return;
  if(stackedChart) stackedChart.destroy();
  stackedChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels.map(j=>`Jam ${j}`), datasets },
    options: {
      plugins: { legend: { position: 'bottom' } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks:{ precision:0 } } }
    }
  });
}

window.addEventListener('DOMContentLoaded', async ()=>{
  $('#tanggal').value = todayISO();
  await refreshCards();
  await refreshChart();
  await refreshBarChart();
  await refreshStacked();
  await refreshRecap();
  await refreshTopAndHeatmap();
  $('#tanggal').addEventListener('change', async ()=>{ await refreshCards(); await refreshChart(); await refreshBarChart(); });
  document.getElementById('rangeSelect').addEventListener('change', async (e)=>{
    const useCustom = e.target.value==='custom';
    document.getElementById('rangeWrap').classList.toggle('hidden', !useCustom);
    await refreshCards(); await refreshChart(); await refreshBarChart(); await refreshStacked(); await refreshRecap(); await refreshTopAndHeatmap();
  });
  document.getElementById('startDate').addEventListener('change', async ()=>{ await refreshCards(); await refreshChart(); await refreshBarChart(); await refreshStacked(); await refreshRecap(); await refreshTopAndHeatmap(); });
  document.getElementById('endDate').addEventListener('change', async ()=>{ await refreshCards(); await refreshChart(); await refreshBarChart(); await refreshStacked(); await refreshRecap(); await refreshTopAndHeatmap(); });
  document.getElementById('groupBy').addEventListener('change', async ()=>{ await refreshRecap(); });
  $('#barGroup').addEventListener('change', async ()=>{ await refreshBarChart(); });

  document.getElementById('btnExportReport').addEventListener('click', async ()=>{
    const {start,end} = getRange();
    const r = await exportReport(start,end);
    if(r?.error){ showToast('Gagal export ke Sheet','error'); }
    else{ showToast(`Export ${r.count||0} baris ke Sheet`,'success'); }
  });
  document.getElementById('btnPrintList').addEventListener('click', async ()=>{
    const tgl = document.getElementById('tanggal').value || todayISO();
    const rows = await listAbsenToday(tgl);
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Daftar Hadir ${tgl}</title>
    <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827} table{width:100%;border-collapse:collapse} th,td{border:1px solid #e5e7eb;padding:6px;font-size:12px} h1{font-size:16px;margin:0 0 8px} .muted{color:#6b7280;font-size:12px}</style>
    </head><body><h1>Daftar Hadir ${tgl}</h1><div class="muted">Cetak dari Dashboard</div>
    <table><thead><tr><th>No</th><th>Siswa</th><th>ID</th><th>Status</th><th>Mode</th><th>Mapel/Kegiatan</th><th>Jam</th><th>Guru/PJ</th><th>Waktu</th></tr></thead><tbody>
    ${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${r.nama||''}</td><td>${r.siswaId||''}</td><td>${r.status||''}</td><td>${r.mode||''}</td><td>${r.mode==='mapel'?(r.mapel||''):(r.kegiatan||'')}</td><td>${r.jamKe||''}</td><td>${r.penanggungJawab||''}</td><td>${r.waktu||''}</td></tr>`).join('')}
    </tbody></table></body></html>`;
    const w = window.open('', '_blank'); w.document.write(html); w.document.close(); w.focus(); w.print();
  });
});
