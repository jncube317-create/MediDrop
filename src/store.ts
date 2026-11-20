// Saves the bot's state to Supabase so nothing is lost on a redeploy.
// The server is the only client and uses the service role key (Railway variable only).
// No Supabase variables = memory only (local demo and the simulator).
import { env } from "./env";

export interface Row {
  id: string;
  data: unknown;
}

export interface CreditRow {
  key: string;
  phone: string;
  delta: number;
  kind: string;
  at: string;
}

export const dbEnabled = (): boolean => Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra };
}

async function check(res: Response, what: string): Promise<void> {
  if (!res.ok) throw new Error(`${what} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
}

/** Reads a whole table, 1,000 rows at a time. */
export async function loadTable<T>(table: string, select = "*"): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=${select}&order=${table === "credit_entries" ? "at" : table === "meta" ? "key" : "id"}.asc`, {
      headers: headers({ Range: `${from}-${from + 999}`, "Range-Unit": "items" }),
    });
    await check(res, `load ${table}`);
    const page = (await res.json()) as T[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/** Insert or update rows by primary key. */
export async function upsert(table: string, rows: object[], ignoreDuplicates = false): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: headers({ Prefer: `resolution=${ignoreDuplicates ? "ignore" : "merge"}-duplicates,return=minimal` }),
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
    await check(res, `save ${table}`);
  }
}

/** Uploads a photo to the public bucket and returns its public link. */
export async function uploadPhoto(name: string, bytes: Buffer, mime: string): Promise<string> {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${env.SUPABASE_BUCKET}/${name}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": mime },
    body: new Uint8Array(bytes),
  });
  await check(res, "photo upload");
  return `${env.SUPABASE_URL}/storage/v1/object/public/${env.SUPABASE_BUCKET}/${name}`;
}
