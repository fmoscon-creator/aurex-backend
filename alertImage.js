const PImage = require('pureimage');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');

const LOGO_PATH = path.join(__dirname, 'assets', 'logo.png');

// Registrar fuentes Inter
const fontBold = PImage.registerFont(path.join(__dirname, 'assets', 'fonts', 'Inter-Bold.ttf'), 'Inter', 700, 'normal', 'normal');
const fontMedium = PImage.registerFont(path.join(__dirname, 'assets', 'fonts', 'Inter-Medium.ttf'), 'Inter', 500, 'normal', 'normal');
const fontRegular = PImage.registerFont(path.join(__dirname, 'assets', 'fonts', 'Inter-Regular.ttf'), 'Inter', 400, 'normal', 'normal');

// Esperar a que las fuentes carguen
const fontsReady = Promise.all([fontBold.load(), fontMedium.load(), fontRegular.load()]);

// Colores AUREX
const C = {
  bg: '#0D1117',
  card: '#161B22',
  gold: '#D4A017',
  green: '#3FB950',
  red: '#F85149',
  text: '#E6EDF3',
  textSec: '#8B949E',
  border: '#21262D',
};

function hexToRgba(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},1)`;
}

function fmtPrice(p) {
  if (p == null || isNaN(p)) return '---';
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

// Helper: dibujar rectángulo con bordes redondeados
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Helper: dibujar card
function drawCard(ctx, x, y, w, h, borderColor) {
  ctx.fillStyle = hexToRgba(C.card);
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  if (borderColor) {
    ctx.strokeStyle = hexToRgba(borderColor);
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 12);
    ctx.stroke();
  }
}

// Convertir canvas a PNG buffer
async function canvasToBuffer(canvas) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = new PassThrough();
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    PImage.encodePNGToStream(canvas, stream).catch(reject);
  });
}

/**
 * Genera imagen de alerta AUREX — 800x450
 */
async function generateAlertImage(data) {
  await fontsReady;

  const W = 800, H = 450;
  const canvas = PImage.make(W, H);
  const ctx = canvas.getContext('2d');
  const type = data.type || 'ia';

  // Color acento
  let accent = C.gold;
  if (type === 'admin') accent = C.red;
  else if (data.direction === 'ALCISTA') accent = C.green;
  else if (data.direction === 'BAJISTA') accent = C.red;

  // Fondo
  const bgColor = type === 'admin' ? '#1A0808' : C.bg;
  ctx.fillStyle = hexToRgba(bgColor);
  ctx.fillRect(0, 0, W, H);

  // Borde superior dorado
  ctx.fillStyle = hexToRgba(accent);
  ctx.fillRect(0, 0, W, 4);

  // Logo (superpuesto después con sharp, por ahora espacio reservado)
  // Logo va en 30,18 tamaño 55x55

  // Header: AUREX
  ctx.fillStyle = hexToRgba(C.gold);
  ctx.font = '28pt Inter';
  ctx.fillText('AUREX', 90, 50);

  // Subtítulo tipo
  ctx.fillStyle = hexToRgba(C.textSec);
  ctx.font = '16pt Inter';
  const subTitle = type === 'ia' ? 'Alerta IA' : type === 'precio' ? 'Alerta de Precio' : type === 'pulse' ? 'AUREX Pulse' : 'Alerta Sistema';
  ctx.fillText(subTitle, 210, 50);

  // Línea separadora
  ctx.fillStyle = hexToRgba(C.border);
  ctx.fillRect(30, 68, W - 60, 1);

  if (type === 'ia') {
    // Activo + dirección
    ctx.fillStyle = hexToRgba(C.text);
    ctx.font = '36pt Inter';
    ctx.fillText(data.symbol || 'BTC', 40, 112);

    const symWidth = (data.symbol || 'BTC').length * 22 + 50;
    ctx.fillStyle = hexToRgba(accent);
    ctx.font = '24pt Inter';
    ctx.fillText((data.direction || 'ALCISTA') + ' ' + (data.probability || '') + '%', symWidth, 112);

    // Card Precio
    drawCard(ctx, 40, 135, 220, 80, C.border);
    ctx.fillStyle = hexToRgba(C.textSec);
    ctx.font = '14pt Inter';
    ctx.fillText('Precio', 60, 163);
    ctx.fillStyle = hexToRgba(C.text);
    ctx.font = '24pt Inter';
    ctx.fillText('$' + fmtPrice(data.price), 60, 197);

    // Card Objetivo
    drawCard(ctx, 280, 135, 220, 80, C.border);
    ctx.fillStyle = hexToRgba(C.textSec);
    ctx.font = '14pt Inter';
    ctx.fillText('Objetivo', 300, 163);
    ctx.fillStyle = hexToRgba(C.green);
    ctx.font = '24pt Inter';
    ctx.fillText('$' + fmtPrice(data.target), 300, 197);

    // Card Stop
    drawCard(ctx, 520, 135, 220, 80, C.border);
    ctx.fillStyle = hexToRgba(C.textSec);
    ctx.font = '14pt Inter';
    ctx.fillText('Stop', 540, 163);
    ctx.fillStyle = hexToRgba(C.red);
    ctx.font = '24pt Inter';
    ctx.fillText('$' + fmtPrice(data.stop), 540, 197);

    // Barra probabilidad
    ctx.fillStyle = hexToRgba(C.card);
    roundRect(ctx, 40, 240, 700, 8, 4);
    ctx.fill();
    ctx.fillStyle = hexToRgba(accent);
    const barW = Math.round(700 * (data.probability || 50) / 100);
    roundRect(ctx, 40, 240, barW, 8, 4);
    ctx.fill();

    // Labels barra
    ctx.fillStyle = hexToRgba(C.textSec);
    ctx.font = '14pt Inter';
    ctx.fillText('Motor IA v7 — 10 variables', 40, 275);
    ctx.fillStyle = hexToRgba(accent);
    ctx.font = '14pt Inter';
    ctx.fillText((data.probability || 50) + '% confianza', 600, 275);

  } else if (type === 'precio') {
    ctx.fillStyle = hexToRgba(C.text);
    ctx.font = '36pt Inter';
    ctx.fillText(data.symbol || '', 40, 112);

    ctx.fillStyle = hexToRgba(C.textSec);
    ctx.font = '18pt Inter';
    ctx.fillText('Precio objetivo alcanzado', 40, 148);

    // Card precio actual
    drawCard(ctx, 40, 175, 340, 90, C.border);
    ctx.fillStyle = hexToRgba(C.textSec);
    ctx.font = '14pt Inter';
    ctx.fillText('Precio actual', 60, 205);
    ctx.fillStyle = hexToRgba(C.text);
    ctx.font = '30pt Inter';
    ctx.fillText('$' + fmtPrice(data.price), 60, 245);

    // Card objetivo
    drawCard(ctx, 420, 175, 340, 90, accent);
    ctx.fillStyle = hexToRgba(C.textSec);
    ctx.font = '14pt Inter';
    ctx.fillText('Objetivo', 440, 205);
    ctx.fillStyle = hexToRgba(accent);
    ctx.font = '30pt Inter';
    ctx.fillText('$' + fmtPrice(data.target), 440, 245);

  } else if (type === 'pulse') {
    const pScore = data.pulseScore || 50;
    const pColor = pScore <= 20 ? C.red : pScore <= 40 ? '#FF6B6B' : pScore <= 60 ? C.gold : pScore <= 80 ? C.green : '#00E676';

    ctx.fillStyle = hexToRgba(pColor);
    ctx.font = '64pt Inter';
    ctx.fillText(String(pScore), 40, 125);

    ctx.font = '22pt Inter';
    ctx.fillText(data.pulseZone || 'Neutral', 40, 158);

    // Barra Pulse
    ctx.fillStyle = hexToRgba(C.card);
    roundRect(ctx, 40, 178, 700, 12, 6);
    ctx.fill();
    ctx.fillStyle = hexToRgba(pColor);
    roundRect(ctx, 40, 178, Math.round(700 * pScore / 100), 12, 6);
    ctx.fill();

    // Escala
    ctx.font = '12pt Inter';
    ctx.fillStyle = hexToRgba(C.red);
    ctx.fillText('0 Miedo', 40, 212);
    ctx.fillStyle = hexToRgba(C.gold);
    ctx.fillText('50 Neutral', 360, 212);
    ctx.fillStyle = hexToRgba(C.green);
    ctx.fillText('100 Codicia', 680, 212);

    if (data.message) {
      ctx.fillStyle = hexToRgba(C.textSec);
      ctx.font = '16pt Inter';
      ctx.fillText(data.message, 40, 255);
    }

  } else if (type === 'admin') {
    ctx.fillStyle = hexToRgba(C.red);
    ctx.font = '28pt Inter';
    ctx.fillText('ALERTA SISTEMA', 40, 112);

    drawCard(ctx, 40, 135, 720, 200, C.red);
    ctx.fillStyle = hexToRgba(C.text);
    ctx.font = '18pt Inter';
    const msg = data.message || '';
    // Wrap text manual (máx ~55 chars por línea)
    const lines = [];
    for (let i = 0; i < msg.length; i += 55) {
      lines.push(msg.substring(i, i + 55));
    }
    lines.slice(0, 5).forEach((line, i) => {
      ctx.fillText(line, 60, 175 + i * 30);
    });
  }

  // Footer
  ctx.fillStyle = hexToRgba(C.border);
  ctx.fillRect(30, H - 55, W - 60, 1);

  ctx.fillStyle = hexToRgba(C.textSec);
  ctx.font = '13pt Inter';
  ctx.fillText('aurex.live', 40, H - 28);

  const ts = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  ctx.fillText(ts, 620, H - 28);

  // Exportar PNG
  const pngBuffer = await canvasToBuffer(canvas);

  // Superponer logo con sharp
  const logoBuffer = await sharp(LOGO_PATH).resize(55, 55).toBuffer();
  const finalImage = await sharp(pngBuffer)
    .composite([{ input: logoBuffer, top: 18, left: 30 }])
    .png()
    .toBuffer();

  return finalImage;
}

module.exports = { generateAlertImage };
