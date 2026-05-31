import { spawn } from "child_process";

/**
 * Konwertuje WAV (Buffer) → MP3 (Buffer) przez ffmpeg (stdin→stdout).
 * 128 kbps, mono — kilkukrotnie mniejszy plik niż WAV.
 */
export function wavToMp3(wav: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "wav", "-i", "pipe:0",
      "-codec:a", "libmp3lame", "-b:a", "128k", "-ac", "1",
      "-f", "mp3", "pipe:1",
    ]);

    const chunks: Buffer[] = [];
    let err = "";
    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.stderr.on("data", (c: Buffer) => { err += c.toString(); });
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(0, 200)}`));
    });

    ff.stdin.write(wav);
    ff.stdin.end();
  });
}
