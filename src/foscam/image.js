// -----------------------------------------------------------------------------
// Snapshot to Gladys image.
//
// Gladys takes a camera image as an `image/jpg;base64,...` string of 150 KB at
// most. A Foscam snapshot is a frame of the main stream: a 1080p JPEG weighs
// 150 to 400 KB, too much. It is decoded, scaled down and encoded again here,
// in pure JavaScript (jpeg-js): no ffmpeg, no native module in the image.
//
// The frames that already fit are sent untouched. The others try smaller
// widths and lower qualities until one fits; a 640 px frame at quality 70
// weighs 40 to 70 KB.
// -----------------------------------------------------------------------------

import jpeg from 'jpeg-js';
import { ERROR_CODES, FoscamError } from './errors.js';

/** The Gladys bound of a camera image, the whole string included (SDK constant). */
export const MAX_IMAGE_LENGTH = 150 * 1024;

const PREFIX = 'image/jpg;base64,';

/** Widths then qualities tried, best first. */
const ATTEMPTS = [
  { width: 1280, quality: 75 },
  { width: 960, quality: 75 },
  { width: 640, quality: 75 },
  { width: 640, quality: 60 },
  { width: 480, quality: 60 },
  { width: 320, quality: 50 },
];

function toImage(buffer) {
  return `${PREFIX}${buffer.toString('base64')}`;
}

/**
 * Scale an RGBA frame down by area averaging (each target pixel is the mean
 * of the source pixels it covers): sharp enough for a dashboard, and no
 * aliasing on fences and blinds like a plain pixel pick.
 */
export function downscale({ width, height, data }, targetWidth) {
  if (targetWidth >= width) {
    return { width, height, data };
  }
  const targetHeight = Math.max(1, Math.round((height * targetWidth) / width));
  const out = Buffer.alloc(targetWidth * targetHeight * 4);
  const xRatio = width / targetWidth;
  const yRatio = height / targetHeight;
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const y0 = Math.floor(ty * yRatio);
    const y1 = Math.max(y0 + 1, Math.floor((ty + 1) * yRatio));
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const x0 = Math.floor(tx * xRatio);
      const x1 = Math.max(x0 + 1, Math.floor((tx + 1) * xRatio));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = y0; y < y1; y += 1) {
        let offset = (y * width + x0) * 4;
        for (let x = x0; x < x1; x += 1) {
          r += data[offset];
          g += data[offset + 1];
          b += data[offset + 2];
          offset += 4;
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      const target = (ty * targetWidth + tx) * 4;
      out[target] = r / count;
      out[target + 1] = g / count;
      out[target + 2] = b / count;
      out[target + 3] = 255;
    }
  }
  return { width: targetWidth, height: targetHeight, data: out };
}

/**
 * Turn a JPEG snapshot into a Gladys camera image.
 *
 * @param {Buffer} buffer the JPEG sent by the camera
 * @param {number} [maxLength] bound of the resulting string
 * @returns {string} `image/jpg;base64,...`, at most `maxLength` characters
 */
export function toCameraImage(buffer, maxLength = MAX_IMAGE_LENGTH) {
  const untouched = toImage(buffer);
  if (untouched.length <= maxLength) {
    return untouched;
  }
  let frame;
  try {
    // The bounds keep a corrupted header from asking for gigabytes.
    frame = jpeg.decode(buffer, {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP: 50,
      maxMemoryUsageInMB: 256,
    });
  } catch (err) {
    throw new FoscamError(ERROR_CODES.BAD_IMAGE, `snapshot: ${err.message}`, { cause: err });
  }
  let scaled = frame;
  for (const { width, quality } of ATTEMPTS) {
    if (scaled.width !== Math.min(width, frame.width)) {
      scaled = downscale(frame, width);
    }
    const image = toImage(Buffer.from(jpeg.encode(scaled, quality).data));
    if (image.length <= maxLength) {
      return image;
    }
  }
  throw new FoscamError(ERROR_CODES.BAD_IMAGE, 'snapshot: cannot be made small enough');
}

/** The raw base64 of a Gladys camera image (what a widget image wants). */
export function imageBase64(image) {
  return image.startsWith(PREFIX) ? image.slice(PREFIX.length) : image;
}
