// Photos people send the bot: download from WhatsApp, keep on disk, serve at /media/<file>.
// Demo storage: files live on the server's disk and are lost on redeploy. v1 moves them to Supabase Storage.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "./env";

const graph = () => `${env.GRAPH_BASE_URL}/${env.GRAPH_API_VERSION}`;
const auth = () => ({ Authorization: `Bearer ${env.WA_TOKEN}` });

export const MEDIA_DIR = env.MEDIA_DIR;
export const SAFE_FILE = /^[a-f0-9-]{36}\.jpg$/;

/** Returns a public link to the saved photo, or null if anything failed. */
export async function savePhoto(mediaId: string): Promise<string | null> {
  try {
    const meta = await fetch(`${graph()}/${encodeURIComponent(mediaId)}`, { headers: auth() });
    if (!meta.ok) throw new Error(`media lookup HTTP ${meta.status}`);
    const { url, mime_type: mime } = (await meta.json()) as { url?: string; mime_type?: string };
    if (!url) throw new Error("no media url");
    if (mime && !/^image\/(jpeg|png|webp)$/.test(mime)) throw new Error(`not a photo (${mime})`);
    const file = await fetch(url, { headers: auth() });
    if (!file.ok) throw new Error(`media download HTTP ${file.status}`);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) throw new Error("photo over 5 MB");
    await mkdir(MEDIA_DIR, { recursive: true });
    const name = `${randomUUID()}.jpg`;
    await writeFile(join(MEDIA_DIR, name), bytes);
    return `${env.PUBLIC_URL}/media/${name}`;
  } catch (err) {
    console.error("[MEDIA] could not save photo:", err instanceof Error ? err.message : err);
    return null;
  }
}

export function demoPhoto(file: string): string {
  return `${env.PUBLIC_URL}/img/${file}`;
}
