import fs from "fs";
import path from "path";

const PODCASTS_DIR = "/app/podcasts";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  // tylko pliki .wav żeby nie serwować innych rzeczy
  if (!filename.endsWith(".wav") || filename.includes("..")) {
    return new Response("not found", { status: 404 });
  }
  const filepath = path.join(PODCASTS_DIR, filename);
  try {
    const audio = fs.readFileSync(filepath);
    return new Response(audio, {
      headers: { "Content-Type": "audio/wav" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
