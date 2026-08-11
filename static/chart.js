/* Oddiy canvas grafiklari — tashqi kutubxonasiz.
   Ikkita seriya: guruhlangan ustunlar. Qorong'i mavzuda ham o'qiladi. */

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function drawBars(canvas, data, series) {
  if (!canvas || !data || !data.labels) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
  const cssH = canvas.height;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 38, padR = 12, padT = 12, padB = 26;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;

  const ink3 = cssVar('--ink-3', '#7C8798');
  const line = cssVar('--line', '#D9E0EA');

  let max = 0;
  series.forEach(([key]) => (data[key] || []).forEach(v => { if (v > max) max = v; }));
  if (max <= 0) max = 1;
  // Yaxlitlangan yuqori chegara — o'qishga qulay bo'lsin.
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  max = Math.ceil(max / step) * step;

  // To'r va o'q belgilari
  ctx.font = '11px ui-monospace, Consolas, monospace';
  ctx.fillStyle = ink3;
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = padT + h - (h * i / 4);
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(y) + 0.5);
    ctx.lineTo(padL + w, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillText(String(Math.round(max * i / 4)), padL - 7, y);
  }

  const n = data.labels.length;
  const slot = w / n;
  const bw = Math.max(1.5, Math.min(9, slot / (series.length + 1)));

  series.forEach(([key, color], si) => {
    ctx.fillStyle = color;
    (data[key] || []).forEach((v, i) => {
      const bh = (v / max) * h;
      const x = padL + slot * i + (slot - bw * series.length) / 2 + si * bw;
      ctx.fillRect(x, padT + h - bh, bw, bh);
    });
  });

  // Sana belgilari — har 5-kun
  ctx.fillStyle = ink3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  data.labels.forEach((lab, i) => {
    if (i % 5 !== 0 && i !== n - 1) return;
    const parts = lab.split('-');
    ctx.fillText(parts[2] + '.' + parts[1], padL + slot * i + slot / 2, padT + h + 7);
  });
}

/* Bitta seriyali chiziqli grafik — xarajat dinamikasi uchun. */
function drawLine(canvas, data, key, color) {
  if (!canvas || !data || !data.labels) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
  const cssH = canvas.height;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 52, padR = 12, padT = 12, padB = 26;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;
  const vals = data[key] || [];

  const ink3 = cssVar('--ink-3', '#7C8798');
  const line = cssVar('--line', '#D9E0EA');

  let max = Math.max(...vals, 0);
  if (max <= 0) max = 1;

  ctx.font = '11px ui-monospace, Consolas, monospace';
  ctx.strokeStyle = line;
  ctx.fillStyle = ink3;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = padT + h - (h * i / 4);
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(y) + 0.5);
    ctx.lineTo(padL + w, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillText('$' + (max * i / 4).toFixed(2), padL - 7, y);
  }

  if (vals.length < 2) return;
  const px = i => padL + (w * i) / (vals.length - 1);
  const py = v => padT + h - (v / max) * h;

  // Chiziq ostidagi yumshoq to'ldirish
  ctx.beginPath();
  ctx.moveTo(px(0), padT + h);
  vals.forEach((v, i) => ctx.lineTo(px(i), py(v)));
  ctx.lineTo(px(vals.length - 1), padT + h);
  ctx.closePath();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  vals.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Oxirgi nuqta ajratilib turadi
  ctx.beginPath();
  ctx.arc(px(vals.length - 1), py(vals[vals.length - 1]), 3.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.fillStyle = ink3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  data.labels.forEach((lab, i) => {
    if (i % 5 !== 0 && i !== vals.length - 1) return;
    const p = lab.split('-');
    ctx.fillText(p[2] + '.' + p[1], px(i), padT + h + 7);
  });
}

/* O'lcham o'zgarganda va mavzu almashganda qayta chizish — sahifa
   yangilanmaydi, faqat grafik qayta chiziladi. */
const __charts = [];
const __rawBars = drawBars, __rawLine = drawLine;

drawBars = function (c, d, s) { __charts.push(() => __rawBars(c, d, s)); __rawBars(c, d, s); };
drawLine = function (c, d, k, col) { __charts.push(() => __rawLine(c, d, k, col)); __rawLine(c, d, k, col); };

function redrawCharts() { __charts.forEach(fn => fn()); }

window.addEventListener('resize', () => {
  clearTimeout(window.__chartTimer);
  window.__chartTimer = setTimeout(redrawCharts, 150);
});

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', redrawCharts);
}
