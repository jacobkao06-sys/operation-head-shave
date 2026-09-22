/**
 * Upload handling. SPEC.md §6 and §13.
 *
 *   - validate by magic bytes, never by extension or the client's Content-Type
 *   - cap at 10 MB before anything touches memory harder than a Buffer
 *   - strip ALL metadata, including GPS, by re-encoding through sharp
 *   - store privately under a random key; the photo is only ever served through
 *     the admin route, and it is never committed to git
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import sharp, { type OutputInfo } from "sharp";
import { blobConfigured, env_ } from "./config";
import { mintToken } from "./tokens";

export const MAX_BYTES = 10 * 1024 * 1024;

export type DetectedType = "image/jpeg" | "image/png" | "image/webp" | "image/heic";

/** Magic-byte sniffing. The extension and the multipart Content-Type are both client-controlled. */
export function sniff(buf: Buffer): DetectedType | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  // ISOBMFF: ....ftyp<brand>. HEIC/HEIF brands only.
  if (buf.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"].includes(brand)) {
      return "image/heic";
    }
  }
  return null;
}

export interface NormalizedPhoto {
  /** Metadata-free JPEG. This is what gets stored and what the model sees. */
  data: Buffer;
  mediaType: "image/jpeg";
  originalType: DetectedType;
  width: number;
  height: number;
}

/**
 * Re-encodes to JPEG. sharp drops every metadata chunk unless explicitly asked
 * to keep it, so EXIF (and therefore GPS) cannot survive this. Also bounds the
 * dimensions: a 100-megapixel upload is a denial-of-service, not a photograph.
 */
export async function normalize(buf: Buffer): Promise<NormalizedPhoto> {
  const originalType = sniff(buf);
  if (!originalType) {
    throw new UploadError("UNSUPPORTED_TYPE", "That file is not a JPEG, PNG, WebP, or HEIC image.");
  }

  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(buf, { failOn: "error" })
      .rotate() // bake in the EXIF orientation before the tag is discarded
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch (err) {
    if (originalType === "image/heic") {
      // sharp is usually built without libheif, so HEIC decoding fails here.
      // iOS converts HEIC to JPEG for ordinary web uploads, so this is rare.
      throw new UploadError(
        "HEIC_UNSUPPORTED",
        "HEIC could not be decoded on the server. Retake the photo or send a JPEG.",
      );
    }
    throw new UploadError("DECODE_FAILED", `That image could not be decoded: ${String(err)}`);
  }

  return {
    data: out.data,
    mediaType: "image/jpeg",
    originalType,
    width: out.info.width,
    height: out.info.height,
  };
}

export class UploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

// --- Storage --------------------------------------------------------------

const LOCAL_DIR = path.join(process.cwd(), ".ohs-uploads");

export interface StoredPhoto {
  key: string;
  url: string;
}

/** Vercel Blob with `access: "private"`; a local directory when there is no token. */
export async function storePhoto(photo: NormalizedPhoto): Promise<StoredPhoto> {
  const key = `proof/${mintToken()}.jpg`;

  if (blobConfigured()) {
    const { put } = await import("@vercel/blob");
    const res = await put(key, photo.data, {
      access: "private",
      contentType: photo.mediaType,
      addRandomSuffix: false,
      // Only pass an explicit token when there is one. With the OIDC-style
      // store the SDK reads VERCEL_OIDC_TOKEN + BLOB_STORE_ID itself, and
      // passing `token: undefined` would defeat that.
      ...(env_.blobToken() ? { token: env_.blobToken() } : {}),
    });
    return { key, url: res.url };
  }

  if (process.env.NODE_ENV === "production") {
    throw new UploadError("NO_BLOB_STORE", "BLOB_READ_WRITE_TOKEN is not set.");
  }
  const file = path.join(LOCAL_DIR, key.replace("/", "_"));
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  await fs.writeFile(file, photo.data);
  return { key, url: `file://${file}` };
}

export async function readPhoto(key: string): Promise<Buffer | null> {
  if (blobConfigured()) {
    const { get } = await import("@vercel/blob");
    try {
      const res = await get(key, {
        access: "private",
        ...(env_.blobToken() ? { token: env_.blobToken() } : {}),
      });
      const chunks: Buffer[] = [];
      // @ts-expect-error — the SDK returns a web ReadableStream, which is async-iterable at runtime
      for await (const chunk of res.stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }
  try {
    return await fs.readFile(path.join(LOCAL_DIR, key.replace("/", "_")));
  } catch {
    return null;
  }
}
