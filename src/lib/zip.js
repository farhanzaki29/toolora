/**
 * A small ZIP writer (store-only, no compression), so "Download all" needs no library.
 * Images are already compressed, so deflating them again would cost time and save almost nothing.
 *
 * Limits (checked): at most 65,535 files and under 4 GB in total (no ZIP64). File names are UTF-8.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const y = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const asBlob = (data) => (data instanceof Blob ? data : new Blob([data]));

/**
 * @param {{ name: string, data: Blob | Uint8Array | ArrayBuffer }[]} entries
 * @returns {Promise<Blob>} a ZIP archive (type application/zip)
 */
export async function createZip(entries, { now = new Date() } = {}) {
  if (!entries.length) throw new Error('Nothing to add to the ZIP file.');
  if (entries.length > 0xffff) throw new Error('Too many files for one ZIP file.');
  const enc = new TextEncoder();
  const stamp = dosDateTime(now);
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = String(entry.name);
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error(`Invalid file name in ZIP: ${name}`);
    const blob = asBlob(entry.data);
    const bytes = new Uint8Array(await blob.arrayBuffer()); // one file at a time, only to compute its CRC
    const crc = crc32(bytes);
    const nameBytes = enc.encode(name);
    const size = blob.size;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 file names
    local.setUint16(8, 0, true); // method: stored
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, nameBytes, blob);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); // version made by
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, stamp.time, true);
    cd.setUint16(14, stamp.date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true); // local header offset
    central.push(cd.buffer, nameBytes);

    offset += 30 + nameBytes.length + size;
    if (offset >= 0xffffffff) throw new Error('The files are too large for one ZIP file (4 GB limit).');
  }

  const cdSize = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/** Reads a stored ZIP back (used by tests and checks). Returns [{ name, bytes, crcOk }]. */
export async function readZip(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a ZIP file (no end record).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Bad central directory.');
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error('Only stored entries are supported by this reader.');
    const dataStart = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const bytes = buf.slice(dataStart, dataStart + size);
    out.push({ name, bytes, crcOk: crc32(bytes) === crc });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
