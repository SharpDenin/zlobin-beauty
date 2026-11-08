/** Minimal uncompressed RGBA PNG writer for Playwright fixtures (no native deps). */

function crcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
}

const CRC_TABLE = crcTable()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const len = u32(data.length)
  const body = new Uint8Array(typeBytes.length + data.length)
  body.set(typeBytes, 0)
  body.set(data, typeBytes.length)
  const crc = u32(crc32(body))
  const out = new Uint8Array(4 + body.length + 4)
  out.set(len, 0)
  out.set(body, 4)
  out.set(crc, 4 + body.length)
  return out
}

/** Adler-32 for zlib. */
function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

/** Store-only zlib wrap (no compression). */
function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = []
  const max = 65535
  for (let i = 0; i < data.length; i += max) {
    const slice = data.subarray(i, Math.min(data.length, i + max))
    const last = i + max >= data.length
    const header = new Uint8Array(5)
    header[0] = last ? 1 : 0
    header[1] = slice.length & 0xff
    header[2] = (slice.length >> 8) & 0xff
    header[3] = ~slice.length & 0xff
    header[4] = (~slice.length >> 8) & 0xff
    const part = new Uint8Array(5 + slice.length)
    part.set(header, 0)
    part.set(slice, 5)
    blocks.push(part)
  }
  const rawLen = blocks.reduce((s, b) => s + b.length, 0)
  const out = new Uint8Array(2 + rawLen + 4)
  out[0] = 0x78
  out[1] = 0x01
  let off = 2
  for (const b of blocks) {
    out.set(b, off)
    off += b.length
  }
  out.set(u32(adler32(data)), off)
  return out
}

function solid(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const stride = 1 + width * 4
  const raw = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const row = y * stride
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 4
      raw[i] = rgba[0]
      raw[i + 1] = rgba[1]
      raw[i + 2] = rgba[2]
      raw[i + 3] = rgba[3]
    }
  }
  const ihdr = new Uint8Array(13)
  ihdr.set(u32(width), 0)
  ihdr.set(u32(height), 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', zlibStore(raw)), chunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = Buffer.alloc(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export const PNG = { solid }
