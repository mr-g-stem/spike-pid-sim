// speak.js: "Read to me" buttons, using the device's own voice (speechSynthesis).
// Works on iPad Safari, Chromebooks and Windows. Buttons hide themselves if a
// browser has no voice support.

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

let currentBtn = null;
let session = 0; // each Read press gets a number; old callbacks from a stopped reading are ignored

function pickVoice() {
  const voices = window.speechSynthesis.getVoices() || [];
  const en = voices.filter((v) => /^en(-|_)?(US|GB)?/i.test(v.lang));
  const liked = ['Samantha', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Karen', 'Moira', 'Daniel'];
  for (const name of liked) { const v = en.find((x) => x.name.includes(name)); if (v) return v; }
  return en.find((v) => v.localService) || en[0] || null;
}
if (canSpeak && window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener('voiceschanged', () => {});

// Turn what is on screen into what should be heard.
export function spoken(text) {
  return text
    .replace(/★★★/g, ' three stars ').replace(/★★/g, ' two stars ').replace(/★/g, ' one star ')
    .replace(/✓/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
    .replace(/(\d)\s*°/g, '$1 degrees').replace(/°/g, ' degrees')
    .replace(/×/g, ' times ').replace(/=/g, ' equals ').replace(/[−–]\s?(\d)/g, ' minus $1')
    .replace(/\+(\d)/g, 'plus $1')
    .replace(/\bcm\b/g, 'centimeters').replace(/\bms\b/g, 'milliseconds')
    .replace(/\bPIDF\b/g, 'P, I, D, F').replace(/\s*→\s*/g, ', ').replace(/[←↑↓↺↻]/g, ' ')
    .replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
}

function setBtn(btn, on) {
  if (!btn) return;
  btn.classList.toggle('speaking', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? '■ Stop' : '🔊 Read to me';
}

export function stopSpeaking() {
  if (!canSpeak) return;
  session++;
  window.speechSynthesis.cancel();
  setBtn(currentBtn, false);
  currentBtn = null;
}

// Read text aloud. Pressing the same button again stops it.
export function speak(text, btn) {
  if (!canSpeak) return;
  const synth = window.speechSynthesis;
  if (currentBtn && currentBtn === btn) { stopSpeaking(); return; }
  stopSpeaking();
  const mine = session;
  // short pieces: some Chromebook voices stop by themselves after about 15 seconds
  const pieces = (spoken(text).match(/[^.!?]+[.!?]*/g) || []).map((p) => p.trim()).filter(Boolean);
  const v = pickVoice();
  currentBtn = btn;
  setBtn(btn, true);
  pieces.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = 'en-US';
    u.rate = 0.9;
    u.pitch = 1.05;
    if (v) u.voice = v;
    if (i === pieces.length - 1) {
      u.onend = u.onerror = () => { if (session === mine && currentBtn === btn) { setBtn(btn, false); currentBtn = null; } };
    }
    synth.speak(u);
  });
}

// A small "Read to me" button. getText runs when it is pressed.
export function readButton(getText, extraClass = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `read-btn ${extraClass}`.trim();
  b.setAttribute('aria-pressed', 'false');
  b.textContent = '🔊 Read to me';
  b.addEventListener('click', (e) => { e.stopPropagation(); speak(getText(), b); });
  if (!canSpeak) b.hidden = true;
  return b;
}

// Readable text of an element, skipping buttons, sliders and other controls.
// Reads headings, paragraphs and list items in order, with a pause after each.
export function readableText(el) {
  const copy = el.cloneNode(true);
  copy.querySelectorAll('button, input, select, output, label, .read-btn, .seg, .tip, .ex-slider, .row-btns, canvas').forEach((n) => n.remove());
  const num = copy.querySelector('.num');
  const parts = num ? [`Step ${num.textContent.trim()}.`] : [];
  copy.querySelectorAll('h3, p, li, .step-card b, .step-card p').forEach((n) => {
    if (n.closest('li') && n.tagName !== 'LI') return; // list items are read whole
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) parts.push(/[.!?:”"]$/.test(t) ? t : t + '.');
  });
  return parts.join(' ');
}
