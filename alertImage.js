const PImage = require('pureimage');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');

const LOGO_LIGHT = path.join(__dirname, 'assets', 'logo.png');       // transparente, para dark mode
const LOGO_DARK = path.join(__dirname, 'assets', 'logo-dark.png');   // fondo oscuro, para light mode

// Registrar fuentes Inter
const fontBold = PImage.registerFont(path.join(__dirname, 'assets', 'fonts', 'Inter-Bold.ttf'), 'Inter', 700, 'normal', 'normal');
const fontMedium = PImage.registerFont(path.join(__dirname, 'assets', 'fonts', 'Inter-Medium.ttf'), 'Inter', 500, 'normal', 'normal');
const fontRegular = PImage.registerFont(path.join(__dirname, 'assets', 'fonts', 'Inter-Regular.ttf'), 'Inter', 400, 'normal', 'normal');

// Esperar a que las fuentes carguen
const fontsReady = Promise.all([fontBold.load(), fontMedium.load(), fontRegular.load()]);

// Colores AUREX
const DARK = {
  bg: '#0D1117',
  card: '#161B22',
  cardAlt: 'rgba(30,37,46,1)',
  gold: '#D4A017',
  green: '#3FB950',
  red: '#F85149',
  text: '#E6EDF3',
  textBright: 'rgba(201,209,217,1)',
  textSec: '#8B949E',
  border: '#21262D',
  barBg: 'rgba(48,54,61,1)',
};

const LIGHT = {
  bg: '#F5F0E8',        // crema dorado suave (paleta AUREX claro)
  card: '#FFFFFF',
  cardAlt: 'rgba(255,255,255,1)',
  gold: '#996B00',       // dorado más oscuro para contraste
  green: '#3FB950',      // mismo verde AUREX nativa
  red: '#B31D28',        // rojo más oscuro
  text: '#0D1117',       // casi negro
  textBright: 'rgba(30,35,45,1)',  // más oscuro
  textSec: '#3D434D',    // gris oscuro (era #5A6070)
  border: '#D4A01750',
  barBg: 'rgba(180,160,120,0.35)',
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

// Helper: dibujar card con efecto glow dorado (como POPs de la app)
function drawCard(ctx, x, y, w, h, borderColor, glow) {
  // Sombra glow si se pide
  if (glow) {
    ctx.fillStyle = 'rgba(212,160,23,0.08)';
    roundRect(ctx, x - 2, y - 2, w + 4, h + 4, 14);
    ctx.fill();
  }
  // Card
  ctx.fillStyle = hexToRgba(C.card);
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  // Borde
  ctx.strokeStyle = hexToRgba(borderColor || C.gold);
  ctx.lineWidth = glow ? 1.5 : 1;
  roundRect(ctx, x, y, w, h, 12);
  ctx.stroke();
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

  const W = 800, H = 400;
  const canvas = PImage.make(W, H);
  const ctx = canvas.getContext('2d');
  const type = data.type || 'ia';
  const C = data.theme === 'light' ? LIGHT : DARK;

  // Color acento
  let accent = C.gold;
  if (type === 'admin') accent = C.red;
  else if (data.direction === 'ALCISTA') accent = C.green;
  else if (data.direction === 'BAJISTA') accent = C.red;

  // Fondo
  const bgColor = type === 'admin' ? (data.theme === 'light' ? '#FFF0F0' : '#1A0808') : C.bg;
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

  // Subtítulo tipo — mejor contraste (#C9D1D9 en vez de #8B949E)
  ctx.fillStyle = C.textBright;
  ctx.font = '16pt Inter';
  const subTitle = type === 'ia' ? 'Alerta IA' : type === 'precio' ? 'Alerta de Precio' : type === 'pulse' ? 'AUREX Pulse' : 'Alerta Sistema';
  ctx.fillText(subTitle, 210, 50);

  // Línea separadora
  ctx.fillStyle = hexToRgba(C.border);
  ctx.fillRect(30, 68, W - 60, 1);

  if (type === 'ia') {
    const sym = data.symbol || 'BTC';
    const prob = data.probability || 82;
    const dir = data.direction || 'ALCISTA';

    // Ticker grande
    ctx.fillStyle = hexToRgba(C.text);
    ctx.font = '34pt Inter';
    ctx.fillText(sym, 40, 108);

    // Dirección + probabilidad + al precio objetivo — MÁS GRANDE
    const symWidth = sym.length * 22 + 55;
    ctx.fillStyle = hexToRgba(accent);
    ctx.font = '24pt Inter';
    ctx.fillText(dir + ' ' + prob + '%', symWidth, 108);
    ctx.fillStyle = C.textBright;
    ctx.font = '16pt Inter';
    const dirTextW = (dir + ' ' + prob + '%').length * 14 + symWidth + 10;
    ctx.fillText('al precio objetivo', dirTextW, 108);

    // Card Precio — accent bar izquierdo dorado + borde
    ctx.fillStyle = hexToRgba(C.gold);
    ctx.fillRect(40, 130, 5, 82);          // accent bar izquierdo
    ctx.fillStyle = C.cardAlt;
    ctx.fillRect(45, 130, 215, 82);        // fondo card
    ctx.strokeStyle = hexToRgba(C.gold);
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 130, 220, 82);      // borde
    ctx.fillStyle = hexToRgba(C.text);
    ctx.font = '16pt Inter';
    ctx.fillText('Precio', 58, 158);
    ctx.fillStyle = hexToRgba(C.text);
    ctx.font = '24pt Inter';
    ctx.fillText('$' + fmtPrice(data.price), 58, 194);

    // Card Objetivo — accent bar izquierdo verde + borde
    ctx.fillStyle = hexToRgba(C.green);
    ctx.fillRect(280, 130, 5, 82);
    ctx.fillStyle = C.cardAlt;
    ctx.fillRect(285, 130, 215, 82);
    ctx.strokeStyle = hexToRgba(C.green);
    ctx.lineWidth = 2;
    ctx.strokeRect(280, 130, 220, 82);
    ctx.fillStyle = hexToRgba(C.text);
    ctx.font = '16pt Inter';
    ctx.fillText('Objetivo', 298, 158);
    ctx.fillStyle = hexToRgba(C.green);
    ctx.font = '24pt Inter';
    ctx.fillText('$' + fmtPrice(data.target), 298, 194);

    // Card Stop — accent bar izquierdo rojo + borde
    ctx.fillStyle = hexToRgba(C.red);
    ctx.fillRect(520, 130, 5, 82);
    ctx.fillStyle = C.cardAlt;
    ctx.fillRect(525, 130, 215, 82);
    ctx.strokeStyle = hexToRgba(C.red);
    ctx.lineWidth = 2;
    ctx.strokeRect(520, 130, 220, 82);
    ctx.fillStyle = hexToRgba(C.text);
    ctx.font = '16pt Inter';
    ctx.fillText('Stop', 538, 158);
    ctx.fillStyle = hexToRgba(C.red);
    ctx.font = '24pt Inter';
    ctx.fillText('$' + fmtPrice(data.stop), 538, 194);

    // Barra probabilidad — fondo gris más claro + relleno color
    ctx.fillStyle = C.barBg;
    ctx.fillRect(40, 232, 700, 14);
    ctx.fillStyle = hexToRgba(accent);
    const barW = Math.round(700 * prob / 100);
    ctx.fillRect(40, 232, barW, 14);

    // Escala 0% y 100% — más grande y claro
    ctx.fillStyle = C.textBright;
    ctx.font = '13pt Inter';
    ctx.fillText('0%', 40, 264);
    ctx.fillText('100%', 698, 264);

    // Label barra
    ctx.fillStyle = C.textBright;
    ctx.font = '13pt Inter';
    ctx.fillText('Motor IA v7 — 10 variables', 250, 264);
    ctx.fillStyle = hexToRgba(accent);
    ctx.font = '13pt Inter';
    ctx.fillText(prob + '%', 40 + barW - 15, 264);

  } else if (type === 'precio') {
    const sym = data.symbol || 'BTC';
    const alcanzado = data.price >= (data.target || 0);

    // Ticker
    ctx.fillStyle = hexToRgba(C.text);
    ctx.font = '34pt Inter';
    ctx.fillText(sym, 40, 108);

    // Subtítulo
    ctx.fillStyle = hexToRgba(accent);
    ctx.font = '20pt Inter';
    const symW = sym.length * 22 + 55;
    ctx.fillText(alcanzado ? 'OBJETIVO ALCANZADO' : 'ALERTA DE PRECIO', symW, 108);

    // Card Precio actual — accent bar dorado
    ctx.fillStyle = hexToRgba(C.gold);
    ctx.fillRect(40, 130, 5, 90);
    ctx.fillStyle = C.cardAlt;
    ctx.fillRect(45, 130, 335, 90);
    ctx.strokeStyle = hexToRgba(C.gold);
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 130, 340, 90);
    ctx.fillStyle = C.textBright;
    ctx.font = '16pt Inter';
    ctx.fillText('Precio actual', 60, 160);
    ctx.fillStyle = hexToRgba(C.text);
    ctx.font = '28pt Inter';
    ctx.fillText('$' + fmtPrice(data.price), 60, 200);

    // Card Objetivo — accent bar verde/rojo
    const objColor = alcanzado ? C.green : C.red;
    ctx.fillStyle = hexToRgba(objColor);
    ctx.fillRect(420, 130, 5, 90);
    ctx.fillStyle = C.cardAlt;
    ctx.fillRect(425, 130, 335, 90);
    ctx.strokeStyle = hexToRgba(objColor);
    ctx.lineWidth = 2;
    ctx.strokeRect(420, 130, 340, 90);
    ctx.fillStyle = C.textBright;
    ctx.font = '16pt Inter';
    ctx.fillText('Objetivo', 440, 160);
    ctx.fillStyle = hexToRgba(objColor);
    ctx.font = '28pt Inter';
    ctx.fillText('$' + fmtPrice(data.target), 440, 200);

    // Diferencia % — grande con emoji
    const diffPct = data.target && data.price ? ((data.price - data.target) / data.target * 100) : 0;
    const diffColor = diffPct >= 0 ? C.green : C.red;
    const diffEmoji = diffPct >= 0 ? '🟢' : '🔴';
    ctx.fillStyle = C.textBright;
    ctx.font = '16pt Inter';
    ctx.fillText('Diferencia:', 40, 250);
    ctx.fillStyle = hexToRgba(diffColor);
    ctx.font = '26pt Inter';
    ctx.fillText(diffEmoji + ' ' + (diffPct >= 0 ? '+' : '') + diffPct.toFixed(2) + '%', 170, 252);

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

    drawCard(ctx, 40, 135, 720, 160, C.red);
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

  ctx.fillStyle = C.textBright;
  ctx.font = '14pt Inter';
  ctx.fillText('aurex.live', 40, H - 26);

  const ts = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  ctx.fillText(ts, 580, H - 26);

  // Exportar PNG → escalar a 1600x800 (Retina) → superponer logo
  const pngBuffer = await canvasToBuffer(canvas);
  const logoPath = data.theme === 'light' ? LOGO_DARK : LOGO_LIGHT;
  let logoBuffer;
  if (data.theme === 'light') {
    // Recortar logo oscuro en círculo (quitar esquinas negras)
    const circleMask = Buffer.from(
      `<svg width="110" height="110"><circle cx="55" cy="55" r="55" fill="white"/></svg>`
    );
    logoBuffer = await sharp(logoPath).resize(80, 80)
      .composite([{ input: Buffer.from(`<svg width="80" height="80"><circle cx="40" cy="40" r="40" fill="white"/></svg>`), blend: 'dest-in' }])
      .png().toBuffer();
  } else {
    logoBuffer = await sharp(logoPath).resize(80, 80).toBuffer();
  }
  const finalImage = await sharp(pngBuffer)
    .resize(1600, 800, { kernel: 'lanczos3' })
    .composite([{ input: logoBuffer, top: 16, left: 60 }])
    .png()
    .toBuffer();

  return finalImage;
}

module.exports = { generateAlertImage };
