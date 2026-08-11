import { useEffect, useRef } from "react";

// Tashqi kutubxonasiz canvas grafiklari. Sabab: sahifa yengil qolsin va
// CSP `script-src 'self'` bilan cheklanganda hech narsa buzilmasin.

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
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
  ctx.font = "11px ui-monospace, Consolas, monospace";
  ctx.fillStyle = cssVar("--ink-3", "#7C8798");
  ctx.strokeStyle = cssVar("--line", "#D9E0EA");
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
  ctx.fillStyle = cssVar("--ink-3", "#7C8798");
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  labels.forEach((label, i) => {
    if (i % 5 !== 0 && i !== labels.length - 1) return;
    const [, month, dayPart] = label.split("-");
    ctx.fillText(`${dayPart}.${month}`, xOf(i), padT + h + 7);
  });
}

/** Guruhlangan ustunlar: bir nechta seriya yonma-yon. */
export function BarChart({ labels, series, height = 200 }) {
  const ref = useRef(null);

  useEffect(() => {
    function draw() {
      const canvas = ref.current;
      if (!canvas || !labels?.length) return;
      const { ctx, width } = prepare(canvas, height);

      const box = { padL: 38, padT: 12, padB: 26, padR: 12 };
      box.w = width - box.padL - box.padR;
      box.h = height - box.padT - box.padB;

      let max = 0;
      series.forEach((s) => s.data.forEach((v) => (max = Math.max(max, v))));
      max = niceMax(max);

      drawAxis(ctx, box, labels, (t) => String(Math.round(max * t)));

      const slot = box.w / labels.length;
      const bw = Math.max(1.5, Math.min(9, slot / (series.length + 1)));
      series.forEach((s, si) => {
        ctx.fillStyle = s.color;
        s.data.forEach((v, i) => {
          const bh = (v / max) * box.h;
          const x =
            box.padL + slot * i + (slot - bw * series.length) / 2 + si * bw;
          ctx.fillRect(x, box.padT + box.h - bh, bw, bh);
        });
      });

      drawDates(ctx, box, labels, (i) => box.padL + slot * i + slot / 2);
    }

    draw();
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    const theme = window.matchMedia?.("(prefers-color-scheme: dark)");
    theme?.addEventListener("change", draw);
    return () => {
      window.removeEventListener("resize", onResize);
      theme?.removeEventListener("change", draw);
    };
  }, [labels, series, height]);

  return <canvas className="chart" ref={ref} height={height} />;
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
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.beginPath();
      data.forEach((v, i) =>
        i ? ctx.lineTo(xOf(i), yOf(v)) : ctx.moveTo(xOf(i), yOf(v))
      );
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(xOf(data.length - 1), yOf(data.at(-1)), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      drawDates(ctx, box, labels, xOf);
    }

    draw();
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    const theme = window.matchMedia?.("(prefers-color-scheme: dark)");
    theme?.addEventListener("change", draw);
    return () => {
      window.removeEventListener("resize", onResize);
      theme?.removeEventListener("change", draw);
    };
  }, [labels, data, color, height, format]);

  return <canvas className="chart" ref={ref} height={height} />;
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          <i style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
