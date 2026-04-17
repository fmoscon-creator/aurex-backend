const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const LOGO_PATH = path.join(__dirname, 'assets', 'logo.png');

// Cargar fuentes como base64 para embeber en SVG
const FONT_BOLD = fs.readFileSync(path.join(__dirname, 'assets', 'fonts', 'Inter-Bold.ttf')).toString('base64');
const FONT_REGULAR = fs.readFileSync(path.join(__dirname, 'assets', 'fonts', 'Inter-Regular.ttf')).toString('base64');
const FONT_MEDIUM = fs.readFileSync(path.join(__dirname, 'assets', 'fonts', 'Inter-Medium.ttf')).toString('base64');

// SVG @font-face declarations
const FONT_STYLES = `
  <style>
    @font-face { font-family: 'Inter'; font-weight: 400; src: url('data:font/ttf;base64,${FONT_REGULAR}') format('truetype'); }
    @font-face { font-family: 'Inter'; font-weight: 500; src: url('data:font/ttf;base64,${FONT_MEDIUM}') format('truetype'); }
    @font-face { font-family: 'Inter'; font-weight: 700; src: url('data:font/ttf;base64,${FONT_BOLD}') format('truetype'); }
  </style>`;

// Colores AUREX
const COLORS = {
  bg: '#0D1117',
  card: '#161B22',
  gold: '#D4A017',
  green: '#3FB950',
  red: '#F85149',
  text: '#E6EDF3',
  textSec: '#8B949E',
  border: '#21262D',
};

// Escapar XML para SVG
function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Formatear precio
function fmtPrice(p) {
  if (p == null || isNaN(p)) return '---';
  return p >= 1000 ? p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : p >= 1 ? p.toFixed(2) : p.toFixed(4);
}

/**
 * Genera imagen de alerta AUREX
 * @param {object} data
 * @param {string} data.type - 'ia' | 'precio' | 'pulse' | 'admin'
 * @param {string} data.symbol - Ej: 'BTC'
 * @param {string} data.direction - 'ALCISTA' | 'BAJISTA' | 'ALTA CONV-IA'
 * @param {number} data.probability - Ej: 82
 * @param {number} data.price - Precio actual
 * @param {number} data.target - Precio objetivo
 * @param {number} data.stop - Stop loss
 * @param {string} data.message - Texto libre (para admin/pulse)
 * @param {number} data.pulseScore - Score Pulse (0-100)
 * @param {string} data.pulseZone - Nombre de zona
 * @returns {Promise<Buffer>} PNG buffer
 */
async function generateAlertImage(data) {
  const W = 800, H = 450;
  const type = data.type || 'ia';

  // Color principal según dirección o tipo
  let accentColor = COLORS.gold;
  if (type === 'admin') accentColor = COLORS.red;
  else if (data.direction === 'ALCISTA') accentColor = COLORS.green;
  else if (data.direction === 'BAJISTA') accentColor = COLORS.red;
  else if (data.direction === 'ALTA CONV-IA') accentColor = COLORS.gold;

  // Emoji según dirección
  const dirEmoji = data.direction === 'ALCISTA' ? '📈' : data.direction === 'BAJISTA' ? '📉' : '⚡';

  // Fondo según tipo
  const bgColor = type === 'admin' ? '#1A0808' : COLORS.bg;

  // Construir SVG
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  ${FONT_STYLES}
  <rect width="${W}" height="${H}" fill="${bgColor}" rx="20"/>
  <!-- Borde dorado superior -->
  <rect x="0" y="0" width="${W}" height="4" fill="${accentColor}" rx="2"/>

  <!-- Header: AUREX + tipo -->
  <text x="90" y="52" font-family="Inter" font-size="28" font-weight="700" fill="${COLORS.gold}">AUREX</text>
  <text x="210" y="52" font-family="Inter" font-size="16" font-weight="400" fill="${COLORS.textSec}">`;

  // Subtítulo según tipo
  if (type === 'ia') svg += 'Alerta IA';
  else if (type === 'precio') svg += 'Alerta de Precio';
  else if (type === 'pulse') svg += 'AUREX Pulse';
  else if (type === 'admin') svg += 'Alerta Sistema';
  svg += `</text>`;

  // Línea separadora
  svg += `<line x1="30" y1="72" x2="${W - 30}" y2="72" stroke="${COLORS.border}" stroke-width="1"/>`;

  if (type === 'ia') {
    // === TEMPLATE IA ===
    // Activo + dirección
    svg += `
  <text x="40" y="115" font-family="Inter" font-size="36" font-weight="700" fill="${COLORS.text}">${esc(data.symbol)}</text>
  <text x="${40 + (data.symbol || '').length * 24}" y="115" font-family="Inter" font-size="24" fill="${accentColor}">  ${esc(data.direction)} ${data.probability || ''}%</text>

  <!-- Card precio -->
  <rect x="40" y="140" width="220" height="80" rx="12" fill="${COLORS.card}" stroke="${COLORS.border}" stroke-width="1"/>
  <text x="60" y="168" font-family="Inter" font-size="14" fill="${COLORS.textSec}">💰 Precio</text>
  <text x="60" y="202" font-family="Inter" font-size="26" font-weight="700" fill="${COLORS.text}">$${esc(fmtPrice(data.price))}</text>

  <!-- Card objetivo -->
  <rect x="280" y="140" width="220" height="80" rx="12" fill="${COLORS.card}" stroke="${COLORS.border}" stroke-width="1"/>
  <text x="300" y="168" font-family="Inter" font-size="14" fill="${COLORS.textSec}">🎯 Objetivo</text>
  <text x="300" y="202" font-family="Inter" font-size="26" font-weight="700" fill="${COLORS.green}">$${esc(fmtPrice(data.target))}</text>

  <!-- Card stop -->
  <rect x="520" y="140" width="220" height="80" rx="12" fill="${COLORS.card}" stroke="${COLORS.border}" stroke-width="1"/>
  <text x="540" y="168" font-family="Inter" font-size="14" fill="${COLORS.textSec}">🛑 Stop</text>
  <text x="540" y="202" font-family="Inter" font-size="26" font-weight="700" fill="${COLORS.red}">$${esc(fmtPrice(data.stop))}</text>

  <!-- Barra de probabilidad -->
  <rect x="40" y="245" width="700" height="8" rx="4" fill="${COLORS.card}"/>
  <rect x="40" y="245" width="${Math.round(700 * (data.probability || 50) / 100)}" height="8" rx="4" fill="${accentColor}"/>
  <text x="40" y="278" font-family="Inter" font-size="14" fill="${COLORS.textSec}">Motor IA v7 — 10 variables</text>
  <text x="${W - 40}" y="278" font-family="Inter" font-size="14" fill="${accentColor}" text-anchor="end">${data.probability || 50}% confianza</text>`;

  } else if (type === 'precio') {
    // === TEMPLATE PRECIO ===
    svg += `
  <text x="40" y="115" font-family="Inter" font-size="36" font-weight="700" fill="${COLORS.text}">${esc(data.symbol)}</text>
  <text x="40" y="155" font-family="Inter" font-size="18" fill="${COLORS.textSec}">Precio objetivo alcanzado</text>

  <rect x="40" y="180" width="340" height="90" rx="12" fill="${COLORS.card}" stroke="${COLORS.border}" stroke-width="1"/>
  <text x="60" y="210" font-family="Inter" font-size="14" fill="${COLORS.textSec}">💰 Precio actual</text>
  <text x="60" y="248" font-family="Inter" font-size="32" font-weight="700" fill="${COLORS.text}">$${esc(fmtPrice(data.price))}</text>

  <rect x="420" y="180" width="340" height="90" rx="12" fill="${COLORS.card}" stroke="${accentColor}" stroke-width="2"/>
  <text x="440" y="210" font-family="Inter" font-size="14" fill="${COLORS.textSec}">🎯 Objetivo</text>
  <text x="440" y="248" font-family="Inter" font-size="32" font-weight="700" fill="${accentColor}">$${esc(fmtPrice(data.target))}</text>`;

  } else if (type === 'pulse') {
    // === TEMPLATE PULSE ===
    const pScore = data.pulseScore || 50;
    const pColor = pScore <= 20 ? COLORS.red : pScore <= 40 ? '#FF6B6B' : pScore <= 60 ? COLORS.gold : pScore <= 80 ? COLORS.green : '#00E676';
    svg += `
  <text x="40" y="120" font-family="Inter" font-size="64" font-weight="700" fill="${pColor}">${pScore}</text>
  <text x="40" y="155" font-family="Inter" font-size="22" fill="${pColor}">${esc(data.pulseZone || 'Neutral')}</text>

  <!-- Barra Pulse -->
  <rect x="40" y="180" width="700" height="12" rx="6" fill="${COLORS.card}"/>
  <rect x="40" y="180" width="${Math.round(700 * pScore / 100)}" height="12" rx="6" fill="${pColor}"/>

  <!-- Escala -->
  <text x="40" y="215" font-family="Inter" font-size="12" fill="${COLORS.red}">0 Miedo</text>
  <text x="${W / 2}" y="215" font-family="Inter" font-size="12" fill="${COLORS.gold}" text-anchor="middle">50 Neutral</text>
  <text x="${W - 40}" y="215" font-family="Inter" font-size="12" fill="${COLORS.green}" text-anchor="end">100 Codicia</text>`;

    if (data.message) {
      svg += `<text x="40" y="260" font-family="Inter" font-size="16" fill="${COLORS.textSec}">${esc(data.message)}</text>`;
    }

  } else if (type === 'admin') {
    // === TEMPLATE ADMIN (fondo rojo oscuro) ===
    svg += `
  <text x="40" y="115" font-family="Inter" font-size="28" font-weight="700" fill="${COLORS.red}">🚨 ALERTA SISTEMA</text>
  <rect x="40" y="140" width="720" height="200" rx="12" fill="#1A0000" stroke="${COLORS.red}" stroke-width="1"/>
  <text x="60" y="175" font-family="Inter" font-size="18" fill="${COLORS.text}">${esc((data.message || '').substring(0, 60))}</text>
  <text x="60" y="210" font-family="Inter" font-size="16" fill="${COLORS.textSec}">${esc((data.message || '').substring(60, 140))}</text>
  <text x="60" y="245" font-family="Inter" font-size="16" fill="${COLORS.textSec}">${esc((data.message || '').substring(140, 220))}</text>`;
  }

  // Footer
  const ts = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  svg += `
  <!-- Footer -->
  <line x1="30" y1="${H - 55}" x2="${W - 30}" y2="${H - 55}" stroke="${COLORS.border}" stroke-width="1"/>
  <text x="40" y="${H - 25}" font-family="Inter" font-size="13" fill="${COLORS.textSec}">aurex.live</text>
  <text x="${W - 40}" y="${H - 25}" font-family="Inter" font-size="13" fill="${COLORS.textSec}" text-anchor="end">${esc(ts)}</text>
</svg>`;

  // Generar imagen: SVG → PNG, con logo superpuesto
  const logoBuffer = await sharp(LOGO_PATH).resize(55, 55).toBuffer();

  const svgBuffer = Buffer.from(svg);
  const image = await sharp(svgBuffer)
    .png()
    .composite([{
      input: logoBuffer,
      top: 18,
      left: 30,
    }])
    .toBuffer();

  return image;
}

module.exports = { generateAlertImage };
