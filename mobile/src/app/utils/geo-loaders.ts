export interface Placemark {
  name: string;
  address: string;
  comuna: string;
}

/* ========= CSV con comillas y delimitador configurable ========= */

// Parser genérico que soporta comillas y delimitador (, o ;)
function parseCSVLineDelim(line: string, delim: ',' | ';'): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Doble comilla "" -> comilla literal dentro de campo
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === delim && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

// Wrapper opcional: auto-detecta el delimitador en esa línea
function parseCSVLine(line: string): string[] {
  const delim: ',' | ';' =
    (line.split(';').length > line.split(',').length) ? ';' : ',';
  return parseCSVLineDelim(line, delim);
}

function cleanField(s?: string): string {
  if (!s) return '';
  // quita comillas envolventes y normaliza espacios
  s = s.replace(/^\s*"+|"+\s*$/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** CSV con header: name,address,comuna */
export async function loadCsv(path: string): Promise<Placemark[]> {
  const resp = await fetch(path);
  const buf  = await resp.arrayBuffer();

  // Decodifica: intenta UTF-8; si hay mojibake, prueba Windows-1252
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�') || /Ã.|Â./.test(text)) {
    try { text = new TextDecoder('windows-1252').decode(buf); } catch {}
  }

  const lines = text.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return [];

  // Detecta delimitador por el header
  const headerRawLine = lines.shift()!;
  const delim: ',' | ';' =
    (headerRawLine.split(';').length > headerRawLine.split(',').length) ? ';' : ',';
  const header = parseCSVLineDelim(headerRawLine, delim).map(h => h.toLowerCase());

  const idxName   = header.findIndex(h => h === 'name');
  const idxAddr   = header.findIndex(h => h === 'address');
  const idxComuna = header.findIndex(h => h === 'comuna');
  if (idxName < 0 || idxAddr < 0 || idxComuna < 0) {
    throw new Error(`CSV inválido: falta alguna columna (name,address,comuna) en ${path}`);
  }

  const out: Placemark[] = [];
  for (const raw of lines) {
    // quita columnas vacías tipo ;;;;; del final
    const cleaned = raw.replace(/;+\s*$/, '');
    const cols = parseCSVLineDelim(cleaned, delim);
    const item: Placemark = {
      name: cleanField(cols[idxName]) ?? '',
      address: cleanField(cols[idxAddr]) ?? '',
      comuna: cleanField(cols[idxComuna]) ?? '',
    };
    if (item.name && item.address) out.push(item);
  }
  return out;
}

/* ========= METRO: X/Y (Web Mercator) -> lat/lng ========= */
const WEB_MERCATOR_R = 6378137;

export function webMercatorToLatLng(x: number, y: number): { lat: number; lng: number } {
  const lng = (x / WEB_MERCATOR_R) * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(y / WEB_MERCATOR_R)) - Math.PI / 2) * 180 / Math.PI;
  return { lat, lng };
}

/** Normaliza encabezados: quita BOM, acentos y pasa a minúsculas */
function norm(h: string) {
  return h
    .replace(/^\uFEFF/, '') // BOM
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // acentos
    .trim().toLowerCase();
}

/** CSV Metro: columnas esperadas (tolerantes): X, Y, estacion/nombre, (opcional) linea */
export async function loadMetroCsv(
  path: string
): Promise<{ name: string; address: string; lat: number; lng: number }[]> {
  const resp = await fetch(path);
  const buf  = await resp.arrayBuffer();

  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�') || /Ã.|Â./.test(text)) {
    try { text = new TextDecoder('windows-1252').decode(buf); } catch {}
  }

  const lines = text.trim().split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return [];

  const headerLine = lines.shift()!;
  const delim: ',' | ';' =
    (headerLine.split(';').length > headerLine.split(',').length) ? ';' : ',';
  const rawHeader = parseCSVLineDelim(headerLine, delim);
  const header = rawHeader.map(norm);

  const iX     = header.findIndex(h => h === 'x');
  const iY     = header.findIndex(h => h === 'y');
  const iEst   = header.findIndex(h => h.includes('estacion') || h === 'nombre' || h === 'station');
  const iLinea = header.findIndex(h => h.includes('linea') || h === 'line');

  if (iX < 0 || iY < 0 || iEst < 0) {
    console.error('Encabezados CSV Metro:', rawHeader);
    throw new Error(`CSV Metro inválido: faltan X,Y o columna 'estacion' en ${path}`);
  }

  const out: { name: string; address: string; lat: number; lng: number }[] = [];
  for (const line of lines) {
    // limpia delimitadores sobrantes al final
    const row = parseCSVLineDelim(line.replace(/[;,]+\s*$/, ''), delim);

    const x = Number(row[iX]), y = Number(row[iY]);
    if (!isFinite(x) || !isFinite(y)) continue;

    const { lat, lng } = webMercatorToLatLng(x, y);
    const est   = (row[iEst] ?? '').toString().trim();
    const linea = (iLinea >= 0 ? row[iLinea] : '').toString().trim();
    const name  = linea ? `${est} (${linea})` : est;

    out.push({ name, address: 'Metro de Santiago', lat, lng });
  }
  return out;
}

/** Geocodifica usando Google Maps JS Geocoder (requiere API cargada) */
export async function geocodeAll(
  places: Placemark[]
): Promise<{ name: string; address: string; lat: number; lng: number }[]> {
  const geocoder = new google.maps.Geocoder();
  const results: { name: string; address: string; lat: number; lng: number }[] = [];

  for (const p of places) {
    const full = `${p.address}, ${p.comuna}, Región Metropolitana, Chile`;
    const { results: r } = await geocoder.geocode({ address: full });
    if (r?.[0]) {
      const loc = r[0].geometry.location;
      results.push({ name: p.name, address: full, lat: loc.lat(), lng: loc.lng() });
    }
    // pausa corta para no exceder cuota
    await new Promise(res => setTimeout(res, 120));
  }
  return results;
}
