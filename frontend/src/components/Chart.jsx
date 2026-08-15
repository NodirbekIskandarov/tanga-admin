import { useEffect, useRef, useState } from "react";

// Tashqi kutubxonasiz canvas grafiklari. Sabab: sahifa yengil qolsin va
// CSP `script-src 'self'` bilan cheklanganda hech narsa buzilmasin.

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

/**
 * Rang nomi `--brass` ko'rinishida berilsa — palitradan olinadi.
 * Canvas `var(...)` ni tushunmaydi, shuning uchun chizishdan oldin
 * qiymatga aylantiriladi. Buning foydasi: rejim almashganda grafik
 * ham to'g'ri rangga o'tadi.
 */
function resolve(color, fallback = "#8A97A4") {
  if (typeof color === "string" && color.startsWith("--")) {
    return cssVar(color, fallback);
  }
  return color || fallback;
}

function prepare(canvas, height) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 600;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function niceMax(value) {
  if (value <= 0) return 1;
  const step = Math.pow(10, Math.floor(Math.log10(value)));
  return Math.ceil(value / step) * step;
}

function drawAxis(ctx, { padL, padT, w, h }, labels, formatter) {
  ctx.font = "11px 'JetBrains Mono', ui-monospace, Consolas, monospace";
  ctx.fillStyle = cssVar("--text-3", "#8A97A4");
  ctx.strokeStyle = cssVar("--border", "#DDE3E9");
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const y = padT + h - (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(y) + 0.5);
    ctx.lineTo(padL + w, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillText(formatter(i / 4), padL - 7, y);
  }
}

function drawDates(ctx, { padL, padT, w, h }, labels, xOf) {
  ctx.fillStyle = cssVar("--text-3", "#8A97A4");
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  labels.forEach((label, i) => {
    if (i % 5 !== 0 && i !== labels.length - 1) return;
    const [, month, dayPart] = label.split("-");
    ctx.fillText(`${dayPart}.${month}`, xOf(i), padT + h + 7);
  });
}

/** Ustun uchi ozgina yumaloq — o'tkir burchaklar mayda ustunda qo'pol chiqadi. */
function bar(ctx, x, y, w, h) {
  const r = Math.min(2, w / 2, h);
  if (h <= 0.5 || !ctx.roundRect) {
    ctx.fillRect(x, y, w, Math.max(h, 0));
    return;
  }
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, [r, r, 0, 0]);
  ctx.fill();
}

/**
 * Guruhlangan ustunlar: bir nechta seriya yonma-yon.
 *
 * `format` — o'q qiymatlarini qisqartirish uchun (so'mda millionlar to'liq
 * yozilsa o'q o'qilmay qoladi). `tip` — sichqoncha ustiga kelganda
 * ko'rsatiladigan matn. Ikkalasi ham ixtiyoriy: berilmasa xom son chiqadi.
 */
export function BarChart({ labels, series, height = 200, format, tip }) {
  const ref = useRef(null);
  const boxRef = useRef(null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    function draw() {
      const canvas = ref.current;
      if (!canvas || !labels?.length) return;
      const { ctx, width } = prepare(canvas, height);

      const box = { padL: format ? 58 : 38, padT: 12, padB: 26, padR: 12 };
      box.w = width - box.padL - box.padR;
      box.h = height - box.padT - box.padB;
      boxRef.current = box;

      let max = 0;
      series.forEach((s) => s.data.forEach((v) => (max = Math.max(max, v))));
      max = niceMax(max);

      drawAxis(ctx, box, labels, (t) =>
        format ? format(max * t) : String(Math.round(max * t))
      );

      const slot = box.w / labels.length;
      // Seriyalar orasida 2px bo'shliq: rang bilan bir qatorda O'RIN ham
      // ajratib tursin. Rang ko'rmaydigan odam uchun yagona ishonchli
      // farq shu — chap ustun doim daromad, o'ng ustun doim sarf.
      const gap = series.length > 1 ? 2 : 0;
      const span = slot * 0.66;
      const bw = Math.max(
        1.5,
        Math.min(10, (span - gap * (series.length - 1)) / series.length)
      );
      const groupW = bw * series.length + gap * (series.length - 1);

      series.forEach((s, si) => {
        ctx.fillStyle = resolve(s.color);
        s.data.forEach((v, i) => {
          const bh = (Math.max(0, v) / max) * box.h;
          const x = box.padL + slot * i + (slot - groupW) / 2 + si * (bw + gap);
          bar(ctx, x, box.padT + box.h - bh, bw, bh);
        });
      });

      // Ustiga kelingan kun ustunini yoritamiz.
      if (hover != null && hover >= 0 && hover < labels.length) {
        ctx.fillStyle = cssVar("--border", "#DDE3E9");
        ctx.globalAlpha = 0.35;
        ctx.fillRect(box.padL + slot * hover, box.padT, slot, box.h);
        ctx.globalAlpha = 1;
      }

      drawDates(ctx, box, labels, (i) => box.padL + slot * i + slot / 2);
    }

    draw();
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    // Ranglar CSS o'zgaruvchilaridan olinadi — rejim almashsa qayta
    // chizilmasa, grafik eski palitrada qolib ketadi.
    const watch = new MutationObserver(draw);
    watch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      window.removeEventListener("resize", onResize);
      watch.disconnect();
    };
  }, [labels, series, height, format, hover]);

  // Nishon butun kun ustuni — mayda ustunning o'ziga tegish shart emas.
  function onMove(event) {
    const box = boxRef.current;
    const canvas = ref.current;
    if (!box || !canvas || !labels?.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left - box.padL;
    const i = Math.floor((x / box.w) * labels.length);
    setHover(i >= 0 && i < labels.length ? i : null);
  }

  const text = hover != null && tip ? tip(hover) : null;

  return (
    <div className="chart-wrap">
      <canvas
        className="chart"
        ref={ref}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      />
      {text && <div className="chart-tip">{text}</div>}
    </div>
  );
}

/** Bitta seriyali chiziq — xarajat dinamikasi uchun. */
export function LineChart({ labels, data, color, height = 200, format }) {
  const ref = useRef(null);

  useEffect(() => {
    function draw() {
      const canvas = ref.current;
      if (!canvas || !labels?.length || data.length < 2) return;
      const { ctx, width } = prepare(canvas, height);

      const box = { padL: 52, padT: 12, padB: 26, padR: 12 };
      box.w = width - box.padL - box.padR;
      box.h = height - box.padT - box.padB;

      const max = Math.max(...data, 0) || 1;
      drawAxis(ctx, box, labels, (t) =>
        format ? format(max * t) : (max * t).toFixed(2)
      );

      const xOf = (i) => box.padL + (box.w * i) / (data.length - 1);
      const yOf = (v) => box.padT + box.h - (v / max) * box.h;

      ctx.beginPath();
      ctx.moveTo(xOf(0), box.padT + box.h);
      data.forEach((v, i) => ctx.lineTo(xOf(i), yOf(v)));
      ctx.lineTo(xOf(data.length - 1), box.padT + box.h);
      ctx.closePath();
      const stroke = resolve(color);
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = stroke;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.beginPath();
      data.forEach((v, i) =>
        i ? ctx.lineTo(xOf(i), yOf(v)) : ctx.moveTo(xOf(i), yOf(v))
      );
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(xOf(data.length - 1), yOf(data.at(-1)), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = stroke;
      ctx.fill();

      drawDates(ctx, box, labels, xOf);
    }

    draw();
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    // Ranglar CSS o'zgaruvchilaridan olinadi — rejim almashsa qayta
    // chizilmasa, grafik eski palitrada qolib ketadi.
    const watch = new MutationObserver(draw);
    watch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      window.removeEventListener("resize", onResize);
      watch.disconnect();
    };
  }, [labels, data, color, height, format]);

  return <canvas className="chart" ref={ref} height={height} />;
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          <i
            style={{
              background: it.color?.startsWith("--") ? `var(${it.color})` : it.color,
            }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}
