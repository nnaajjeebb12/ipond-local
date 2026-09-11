import { NextResponse } from "next/server";
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

export async function GET() {
  const { rows } = await pool.query<PondRow>(
    `SELECT p.id, p.pond_code, p.name, p.location, p.capacity, p.area, p.company_name
       FROM ponds p
      ORDER BY p.id`
  );

  const ponds = rows.map((r) => ({
    id: String(r.id),
    pond_code: r.pond_code,
    name: r.name,
    location: r.location ?? "",
    capacity: r.capacity ?? 0,
    area: r.area ?? 0,
    company_name: r.company_name,
  }));

  return NextResponse.json(ponds);
}
