import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PondRow = {
  id: number;
  pond_code: string | null;
  name: string;
  location: string | null;
  capacity: number | null;
  area: number | null;
  company_name: string | null;
};

const POND_COLUMNS = `p.id, p.pond_code, p.name, p.location, p.capacity, p.area, p.company_name`;

// PND-001 style. Anything else must be an explicit code the operator typed.
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,31}$/;

function shape(r: PondRow) {
  return {
    id: String(r.id),
    pond_code: r.pond_code,
    name: r.name,
    location: r.location ?? "",
    capacity: r.capacity ?? 0,
    area: r.area ?? 0,
    company_name: r.company_name,
  };
}

export async function GET() {
  const { rows } = await pool.query<PondRow>(
    `SELECT ${POND_COLUMNS} FROM ponds p ORDER BY p.id`
  );
  return NextResponse.json(rows.map(shape));
}

type CreateBody = {
  name?: unknown;
  pond_code?: unknown;
  location?: unknown;
  capacity?: unknown;
  area?: unknown;
};

function optionalNumber(v: unknown, field: string): number | null | { error: string } {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { error: `invalid_${field}` };
  return n;
}

/**
 * Create a pond. `pond_code` is the identity the gateway posts under
 * (`pnd: 11` -> `PND-011`) and the key cloud sync matches on, so it must be
 * unique on this appliance — the unique index enforces it. Left blank, the
 * next free PND-### number is taken.
 */
export async function POST(req: NextRequest) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (name.length > 120) {
    return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  }

  let code: string | null = null;
  if (body.pond_code !== undefined && body.pond_code !== null && String(body.pond_code).trim() !== "") {
    code = String(body.pond_code).trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      return NextResponse.json({ error: "invalid_pond_code" }, { status: 400 });
    }
  }

  const location =
    typeof body.location === "string" && body.location.trim() ? body.location.trim().slice(0, 200) : null;
  const capacity = optionalNumber(body.capacity, "capacity");
  if (capacity !== null && typeof capacity === "object") {
    return NextResponse.json(capacity, { status: 400 });
  }
  const area = optionalNumber(body.area, "area");
  if (area !== null && typeof area === "object") {
    return NextResponse.json(area, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (code === null) {
      // Next free number after the highest PND-### in use. Serialised by the
      // row lock so two operators clicking at once cannot draw the same code.
      await client.query(`LOCK TABLE ponds IN SHARE ROW EXCLUSIVE MODE`);
      const { rows } = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX((regexp_match(pond_code, '^PND-(\\d+)$'))[1]::int), 0) + 1 AS next
           FROM ponds
          WHERE pond_code ~ '^PND-\\d+$'`
      );
      code = `PND-${String(rows[0]?.next ?? 1).padStart(3, "0")}`;
    } else {
      const { rows } = await client.query(`SELECT 1 FROM ponds WHERE pond_code = $1`, [code]);
      if (rows.length > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "pond_code_taken", pond_code: code }, { status: 409 });
      }
    }

    const { rows } = await client.query<PondRow>(
      `INSERT INTO ponds (owner_id, name, pond_code, location, capacity, area)
       VALUES (NULL, $1, $2, $3, $4, $5)
       RETURNING id, pond_code, name, location, capacity, area, company_name`,
      [name, code, location, capacity, area]
    );
    await client.query("COMMIT");
    console.log("pond_created", { id: rows[0].id, pond_code: code });
    return NextResponse.json(shape(rows[0]), { status: 201 });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // Unique violation on pond_code: the explicit code was taken between our
    // check and the insert. Say so rather than 500.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "pond_code_taken", pond_code: code }, { status: 409 });
    }
    console.error("pond_create_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  } finally {
    client.release();
  }
}
