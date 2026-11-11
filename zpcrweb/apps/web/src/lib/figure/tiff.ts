/**
 * A baseline TIFF writer: enough of one to save a figure this app drew.
 *
 * 8-bit RGBA, one strip, PackBits. That is the smallest write a reader has to support to open the
 * file — Preview, Photoshop, Illustrator, ImageJ, Word and every journal's submission system read
 * it — and it is the one the request needed that a canvas cannot do by itself: `toBlob` writes
 * PNG, JPEG and WebP, and a TIFF had to be assembled by hand.
 *
 * PackBits rather than Deflate on purpose: it is the compression TIFF shipped with (1988, spec §9),
 * every decoder has it, and it is a byte loop — no `CompressionStream`, nothing to await, so the
 * export stays one synchronous step from canvas pixels to a Blob. A figure's flat background
 * (transparent, or one ink colour) is exactly what run-length encoding is good at.
 *
 * Alpha is *unassociated* (ExtraSamples = 2): the pixels come straight out of `getImageData`,
 * which is not premultiplied. A transparent background is therefore all-zero RGBA, and stays
 * transparent wherever the file is placed.
 */

/** The pixels to write: straight (un-premultiplied) RGBA, row-major, as `getImageData` returns. */
export interface TiffImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** The TIFF field types this writer uses (spec §4). */
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

const PHOTOMETRIC_RGB = 2;
const PACKBITS = 32773;
const RESOLUTION_UNIT_INCH = 2;
const EXTRA_SAMPLE_UNASSOCIATED_ALPHA = 2;

/** An ASCII field's value must be NUL-terminated and even in length (spec §4). */
function ascii(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length + 2);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 0xff;
  return bytes;
}

/**
 * PackBits the image row by row (spec §9).
 *
 * Each row is encoded on its own, which is what the scheme's -128..127 control byte is sized for
 * and what every encoder does: a literal packet copies `n+1` bytes, a run packet repeats the next
 * byte `1-n` times. A byte that starts a run of three or more ends the literal packet in front of
 * it, so a figure's long stretches of one colour cost two bytes apiece.
 */
function packBits(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const rowBytes = width * 4;
  // Worst case: every packet is a literal, so one control byte per 128 bytes — plus the row's
  // remainder. Runs only ever shrink the result below this.
  const bound = (rowBytes + Math.ceil(rowBytes / 128) + 1) * height;
  const out = new Uint8Array(bound);
  let o = 0;

  for (let y = 0; y < height; y++) {
    const start = y * rowBytes;
    const end = start + rowBytes;
    let i = start;
    while (i < end) {
      let run = 1;
      while (i + run < end && run < 128 && rgba[i + run] === rgba[i]) run++;

      if (run >= 2) {
        // `1 - run` as an unsigned byte: 255 for a pair, 129 for a full 128-byte run.
        out[o++] = 257 - run;
        out[o++] = rgba[i]!;
        i += run;
        continue;
      }

      let j = i + 1;
      while (j < end && j - i < 128) {
        if (j + 2 < end && rgba[j] === rgba[j + 1] && rgba[j] === rgba[j + 2]) break;
        j++;
      }
      out[o++] = j - i - 1;
      out.set(rgba.subarray(i, j), o);
      o += j - i;
      i = j;
    }
  }

  return out.subarray(0, o);
}

/** A TIFF's fixed pieces, in the order the writer lays them out: header, IFD, its overflow
 * values, then the pixels. */
export interface TiffOptions {
  /** Pixels per inch, written to both resolution tags. The figure's physical size follows from
   * it: 2400 px at 300 dpi is an 8-inch-wide figure. */
  dpi?: number;
  /** What wrote the file, as the Software tag — the place a reader looks when a file misbehaves. */
  software?: string;
}

/** Encode `image` as a baseline TIFF file. */
export function encodeTiff(image: TiffImage, options: TiffOptions = {}): Uint8Array {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`encodeTiff: bad image size ${width}×${height}`);
  }
  if (data.length !== width * height * 4) {
    throw new Error(
      `encodeTiff: ${data.length} bytes for a ${width}×${height} RGBA image (expected ${width * height * 4})`,
    );
  }

  const dpi = Math.max(1, Math.round(options.dpi ?? 300));
  const software = ascii(options.software ?? "zpcrweb");
  const strip = packBits(data, width, height);

  // 15 tags: the fields a baseline RGB reader needs, plus the fourth sample and its meaning.
  const tagCount = 15;
  const ifdOffset = 8;
  const ifdSize = 2 + tagCount * 12 + 4; // count, entries, next-IFD pointer
  const bitsOffset = ifdOffset + ifdSize;
  const xResOffset = bitsOffset + 8; // four SHORTs
  const yResOffset = xResOffset + 8; // two LONGs
  const softwareOffset = yResOffset + 8;
  const dataOffset = softwareOffset + software.length;
  const total = dataOffset + strip.length;

  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);

  // Header: "II" (little-endian), the magic 42, and the first IFD's offset.
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  let p = ifdOffset;
  view.setUint16(p, tagCount, true);
  p += 2;

  /** One IFD entry. A SHORT that fits in the 4-byte value field is stored in it directly
   * (`count === 1`), everything else points at its value elsewhere in the file. */
  const tag = (id: number, type: number, count: number, value: number): void => {
    view.setUint16(p, id, true);
    view.setUint16(p + 2, type, true);
    view.setUint32(p + 4, count, true);
    if (type === TYPE_SHORT && count === 1) view.setUint16(p + 8, value, true);
    else view.setUint32(p + 8, value, true);
    p += 12;
  };

  tag(256, TYPE_LONG, 1, width); // ImageWidth
  tag(257, TYPE_LONG, 1, height); // ImageLength
  tag(258, TYPE_SHORT, 4, bitsOffset); // BitsPerSample — 8, 8, 8, 8
  tag(259, TYPE_SHORT, 1, PACKBITS); // Compression
  tag(262, TYPE_SHORT, 1, PHOTOMETRIC_RGB); // PhotometricInterpretation
  tag(273, TYPE_LONG, 1, dataOffset); // StripOffsets
  tag(277, TYPE_SHORT, 1, 4); // SamplesPerPixel — RGB + alpha
  tag(278, TYPE_LONG, 1, height); // RowsPerStrip — one strip holds the lot
  tag(279, TYPE_LONG, 1, strip.length); // StripByteCounts
  tag(282, TYPE_RATIONAL, 1, xResOffset); // XResolution
  tag(283, TYPE_RATIONAL, 1, yResOffset); // YResolution
  tag(284, TYPE_SHORT, 1, 1); // PlanarConfiguration — chunky (RGBA interleaved)
  tag(296, TYPE_SHORT, 1, RESOLUTION_UNIT_INCH); // ResolutionUnit
  tag(305, TYPE_ASCII, software.length, softwareOffset); // Software
  tag(338, TYPE_SHORT, 1, EXTRA_SAMPLE_UNASSOCIATED_ALPHA); // ExtraSamples — alpha, unassociated

  view.setUint32(p, 0, true); // no second IFD

  // The values the entries above point at.
  for (let i = 0; i < 4; i++) view.setUint16(bitsOffset + i * 2, 8, true);
  view.setUint32(xResOffset, dpi, true);
  view.setUint32(xResOffset + 4, 1, true);
  view.setUint32(yResOffset, dpi, true);
  view.setUint32(yResOffset + 4, 1, true);
  bytes.set(software, softwareOffset);
  bytes.set(strip, dataOffset);

  return bytes;
}
