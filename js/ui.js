export function showToast(message, type='info', timeout=2500){
  let container = document.getElementById('toast-container');
  if(!container){
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.position = 'fixed';
    container.style.right = '12px';
    container.style.bottom = '12px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column-reverse';
    container.style.gap = '8px';
    container.style.zIndex = '9999';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.textContent = message;
  el.style.padding = '10px 12px';
  el.style.borderRadius = '8px';
  el.style.color = '#111827';
  el.style.boxShadow = '0 4px 10px rgba(0,0,0,0.08)';
  el.style.background = type==='success' ? '#dcfce7' : type==='error' ? '#fee2e2' : '#e5e7eb';
  el.style.border = '1px solid ' + (type==='success' ? '#86efac' : type==='error' ? '#fecaca' : '#e5e7eb');
  container.appendChild(el);
  setTimeout(()=>{
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s ease';
    setTimeout(()=> el.remove(), 250);
  }, timeout);
}

