import fs from "fs";
import path from "path";

const PODCASTS_DIR = "/app/podcasts";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  if (!filename.endsWith(".wav") || filename.includes("..")) {
    return new Response("not found", { status: 404 });
  }

  const filepath = path.join(PODCASTS_DIR, filename);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filepath);
  } catch {
    return new Response("not found", { status: 404 });
  }

  const total = stat.size;
  const rangeHeader = req.headers.get("range");

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) return new Response("invalid range", { status: 416 });

    const start = parseInt(match[1]!, 10);
    const end = match[2] ? parseInt(match[2], 10) : total - 1;
    const chunkSize = end - start + 1;

    const fd = fs.openSync(filepath, "r");
    const buf = Buffer.alloc(chunkSize);
    fs.readSync(fd, buf, 0, chunkSize, start);
    fs.closeSync(fd);

    return new Response(buf, {
      status: 206,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunkSize),
      },
    });
  }

  // całość
  const audio = fs.readFileSync(filepath);
  return new Response(audio, {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Accept-Ranges": "bytes",
      "Content-Length": String(total),
    },
  });
}
