/**
 * Where photographs live — beside the database, not inside it
 * Indian Railways WRS Raipur
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Every photograph was stored as base64 text in the database file: wagon
 * evidence in wagon_photos.image_data, spring evidence in spring_images. The
 * readiness panel measured what that did to the weekly backup — WARN at
 * 2 GB, FAIL at 8 GB — and its only advice was to stop photographing
 * springs. At seven hundred springs a shift with the sorting camera on, the
 * warning arrives within weeks. The evidence the shop is asked to collect was
 * the thing making its backup impossible.
 *
 * WHAT CHANGES, AND WHAT DOES NOT
 * -------------------------------
 * A new photograph is written to WRS_PHOTO_DIR (default: photos/ beside the
 * database) as its own file, under year/month, named by the row id. The row
 * keeps a reference in the same column — `file:2026/09/photo_....jpg` — and a
 * SHA-256 of the bytes in a new column. Readers resolve the reference back to
 * a data URL, and check the hash on the way: a photograph that has been
 * altered or replaced on disk is reported as such, not served as evidence.
 *
 * Rows written before this change keep their inline base64 and are read
 * exactly as before. spring_images is append-only by trigger, so they could
 * not be moved even if it were wise to rewrite evidence rows, and it is not.
 *
 * The integrity promise is unchanged. The hash chain never covered the image
 * bytes themselves — it covered the row, and the row now carries the hash of
 * the bytes. The backup script carries the photo directory too, encrypted
 * the same way, keyed by that hash.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config/index.ts';

export const FILE_REF_PREFIX = 'file:';

export interface StoredPhoto {
  /** What goes in the image_data column. */
  ref: string;
  /** Hex SHA-256 of the raw image bytes. */
  sha256: string;
  /** Raw image bytes on disk. */
  bytes: number;
  mimeType: string;
}

export interface ResolvedPhoto {
  /** A data URL, as every reader has always received. Null if the file is gone. */
  dataUrl: string | null;
  /** True when the bytes matched the stored hash; false when they did not; null for a legacy inline row. */
  verified: boolean | null;
  /** Where the bytes came from. */
  source: 'FILE' | 'INLINE' | 'MISSING' | 'ALTERED';
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

/** Split a data URL, or take bare base64 as JPEG. */
function decode(input: string, declaredMime?: string | null): { buf: Buffer; mimeType: string } {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(input);
  if (m) return { buf: Buffer.from(m[2], 'base64'), mimeType: m[1].toLowerCase() };
  return { buf: Buffer.from(input, 'base64'), mimeType: (declaredMime || 'image/jpeg').toLowerCase() };
}

export class PhotoStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  static isFileRef(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(FILE_REF_PREFIX);
  }

  /**
   * Write the bytes and return what the row should record.
   *
   * Written to a temporary name and renamed, so a crash mid-write leaves no
   * half-file under the real name for a reader to mistake for the photograph.
   */
  put(id: string, image: string, declaredMime?: string | null, when = new Date()): StoredPhoto {
    const { buf, mimeType } = decode(image, declaredMime);
    if (buf.length === 0) throw new Error('The photograph is empty.');
    const ext = EXT[mimeType] || 'bin';
    const yyyy = String(when.getUTCFullYear());
    const mm = String(when.getUTCMonth() + 1).padStart(2, '0');
    const rel = path.posix.join(yyyy, mm, `${id.replace(/[^A-Za-z0-9_\-]/g, '_')}.${ext}`);
    const abs = path.join(this.dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, abs);
    return {
      ref: `${FILE_REF_PREFIX}${rel}`,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      bytes: buf.length,
      mimeType
    };
  }

  /** The absolute path a reference points at, inside the store only. */
  pathOf(ref: string): string {
    const rel = ref.slice(FILE_REF_PREFIX.length);
    const abs = path.resolve(this.dir, rel);
    if (!abs.startsWith(path.resolve(this.dir) + path.sep)) {
      throw new Error('A photograph reference may not point outside the photo directory.');
    }
    return abs;
  }

  /**
   * Turn what the column holds back into what readers expect.
   *
   * A legacy inline value is returned as-is. A file reference is read and
   * hashed; if the hash does not match what the row recorded, the bytes are
   * NOT returned — an altered photograph is not evidence, and a reader that
   * quietly showed it would be presenting a picture the record does not
   * vouch for.
   */
  resolve(column: string | null | undefined, sha256: string | null | undefined, mimeType?: string | null): ResolvedPhoto {
    if (!column) return { dataUrl: null, verified: null, source: 'MISSING' };
    if (!PhotoStore.isFileRef(column)) {
      return { dataUrl: column, verified: null, source: 'INLINE' };
    }
    let buf: Buffer;
    try {
      buf = fs.readFileSync(this.pathOf(column));
    } catch {
      return { dataUrl: null, verified: false, source: 'MISSING' };
    }
    const actual = crypto.createHash('sha256').update(buf).digest('hex');
    if (sha256 && actual !== sha256) {
      return { dataUrl: null, verified: false, source: 'ALTERED' };
    }
    const mime = mimeType || (column.endsWith('.png') ? 'image/png' : column.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, verified: sha256 ? true : null, source: 'FILE' };
  }

  /** Bytes on disk under the store, for the readiness panel. */
  sizeOnDisk(): { bytes: number; files: number } {
    let bytes = 0;
    let files = 0;
    const walk = (d: string) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && !e.name.endsWith('.tmp')) {
          files++;
          try { bytes += fs.statSync(p).size; } catch { /* raced with a write */ }
        }
      }
    };
    walk(this.dir);
    return { bytes, files };
  }

  /** Every file under the store, relative, for the backup script. */
  list(): string[] {
    const out: string[] = [];
    const walk = (d: string, rel: string) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const r = rel ? path.posix.join(rel, e.name) : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), r);
        else if (e.isFile() && !e.name.endsWith('.tmp')) out.push(r);
      }
    };
    walk(this.dir, '');
    return out.sort();
  }
}

/** One store, at the configured directory. Read at call time so tests may point it elsewhere. */
export const photoStore = () => new PhotoStore(config.photoDir);
