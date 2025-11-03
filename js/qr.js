let html5Qrcode, isRunning=false;
let lastText=null, lastAt=0; let deDupeMs=3000;
let beepEnabled = true;
let audioCtx = null;

async function beep(){
  if(!beepEnabled) return;
  try{
    audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state === 'suspended'){ try{ await audioCtx.resume(); }catch(_){} }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, audioCtx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.13);
    if(navigator.vibrate){ navigator.vibrate(40); }
  }catch(err){ /* ignore audio errors */ }
}

export function setDedupeWindow(ms){
  const n = Number(ms);
  if(!Number.isNaN(n) && n >= 0) deDupeMs = n;
}

export function setBeepEnabled(flag){
  beepEnabled = !!flag;
}

export async function startQR(onDecoded){
  const regionId = 'reader';
  html5Qrcode = new Html5Qrcode(regionId);
  const config = { fps: 10, qrbox: { width: 250, height: 250 } };
  isRunning = true;
  lastText = null; lastAt = 0;
  const handler = (decodedText)=>{
    const txt = String(decodedText||'').trim();
    const now = Date.now();
    if(txt === lastText && (now - lastAt) < deDupeMs){
      return; // ignore duplicate scan in short window
    }
    lastText = txt; lastAt = now;
    beep();
    try{ onDecoded(decodedText); }catch(err){ console.error('onDecoded error', err); }
  };
  await html5Qrcode.start({ facingMode: 'environment' }, config, handler);
}
export async function stopQR(){
  if(isRunning && html5Qrcode){
    await html5Qrcode.stop();
    await html5Qrcode.clear();
    isRunning=false;
    lastText=null; lastAt=0;
  }
}
