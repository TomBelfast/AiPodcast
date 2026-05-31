import { NextResponse } from "next/server";
import { readProviders, writeProviders, type Provider } from "../_lib/provider";

// Zwraca providerów z zamaskowanym kluczem (bezpieczne do UI).
export function GET() {
  const s = readProviders();
  const providers: Record<string, Omit<Provider, "apiKey"> & { hasKey: boolean }> = {};
  for (const [id, p] of Object.entries(s.providers)) {
    providers[id] = { label: p.label, baseUrl: p.baseUrl, model: p.model, hasKey: !!p.apiKey };
  }
  return NextResponse.json({ active: s.active, providers });
}

// Akcje: setActive | save (dodaj/edytuj) | delete
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action: "setActive" | "save" | "delete";
      id?: string;
      label?: string;
      baseUrl?: string;
      apiKey?: string;
      model?: string;
    };
    const s = readProviders();

    if (body.action === "setActive") {
      if (!body.id || !s.providers[body.id]) {
        return NextResponse.json({ error: "Nieznany provider" }, { status: 400 });
      }
      s.active = body.id;
    } else if (body.action === "save") {
      const id = (body.id ?? "").trim();
      if (!id) return NextResponse.json({ error: "Podaj id" }, { status: 400 });
      const existing = s.providers[id];
      s.providers[id] = {
        label: (body.label ?? existing?.label ?? id).trim(),
        baseUrl: (body.baseUrl ?? existing?.baseUrl ?? "").trim(),
        // pusty apiKey przy edycji = zostaw stary
        apiKey: body.apiKey && body.apiKey.trim() ? body.apiKey.trim() : (existing?.apiKey ?? ""),
        model: (body.model ?? existing?.model ?? "").trim(),
      };
    } else if (body.action === "delete") {
      if (!body.id || !s.providers[body.id]) {
        return NextResponse.json({ error: "Nieznany provider" }, { status: 400 });
      }
      if (Object.keys(s.providers).length <= 1) {
        return NextResponse.json({ error: "Musi zostać co najmniej jeden provider" }, { status: 400 });
      }
      delete s.providers[body.id];
      if (s.active === body.id) s.active = Object.keys(s.providers)[0]!;
    } else {
      return NextResponse.json({ error: "Nieznana akcja" }, { status: 400 });
    }

    writeProviders(s);
    return GET();
  } catch {
    return NextResponse.json({ error: "Błędne dane" }, { status: 400 });
  }
}
