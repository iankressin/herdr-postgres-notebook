import { READ_BYTES, fileName } from "./reader.js";

export function createResultFiles({ fs, exec, directory, downloads }) {
  const forget = (file) => file ? fs.unlink(file).catch(() => {}) : Promise.resolve();

  async function create() {
    await fs.mkdir(directory, { recursive: true });
    return `${directory}/result-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.csv`;
  }

  // The file's size and its text: all of it, or its first READ_BYTES when it is bigger. Herdr's
  // readFile refuses files over 64 MiB, so the start of a big one is copied out with head first.
  async function readStart(file) {
    const size = await exec("wc", ["-c", file]).catch(() => null);
    const bytes = size?.code === 0 ? parseInt(size.stdout.trim(), 10) || 0 : 0;
    if (bytes === 0) return { bytes, text: "", cut: false };
    if (bytes <= READ_BYTES) return { bytes, text: await fs.readFile(file, "utf8"), cut: false };
    const start = `${file}.start`;
    try {
      const copy = await exec("sh", ["-c", 'head -c "$1" "$2" > "$3"', "sh", String(READ_BYTES), file, start]);
      if (copy.code !== 0) throw new Error(copy.stderr.trim() || "Could not read the result.");
      return { bytes, text: await fs.readFile(start, "utf8"), cut: true };
    } finally {
      await forget(start);
    }
  }

  async function save(file, title) {
    await exec("mkdir", ["-p", downloads]);
    const name = fileName(title);
    let target = `${downloads}/${name}.csv`;
    for (let n = 2; await fs.exists(target); n++) target = `${downloads}/${name} ${n}.csv`;
    const moved = await exec("mv", ["-n", file, target]);
    if (moved.code !== 0 || !(await fs.exists(target))) throw new Error(moved.stderr.trim() || `Could not move it to ${target}.`);
    return target;
  }

  const cleanup = () => exec("find", [directory, "-name", "result-*", "-mmin", "+1440", "-delete"]).catch(() => {});
  return { create, forget, readStart, save, cleanup };
}
