// Reading a query's result into the page, within what Herdr's script engine can carry.
//
// Every mod in Herdr shares one script heap of about 200 MB, and the engine silently stops a run
// that goes on past about half a second. So a result is read a slice at a time, and only as much
// of it as fits. The rest stays in psql's file, which can be saved whole.
import { NULL_MARK, readCsv } from "./logic.js";
import { CELL_CHARS } from "./shape.js";

const MB = 1024 * 1024;

// The most one result holds. Rows and values bound the passes a chart or the summary makes over
// all of them: about 200 ms each at this size on an M-series Mac, well under the half second.
// Characters bound the memory.
export const ONE = { rows: 50000, values: 250000, chars: 16 * MB };
// The most every result in every pg tab holds together.
export const ALL = { values: 400000, chars: 24 * MB };
// The most of psql's file read: enough to fill ONE unless its rows are long.
export const READ_BYTES = 16 * MB;
// Values parsed in one go: about 35 ms.
const SLICE = 50000;

export const NOTHING = { values: 0, chars: 0 };

// The room a new result has, given what the other results hold.
export const roomLeft = (held) => ({
  rows: ONE.rows,
  values: Math.min(ONE.values, ALL.values - held.values),
  chars: Math.min(ONE.chars, ALL.chars - held.chars),
});

// `cut`: the text is only the start of psql's file, so its last line may stop partway.
export const startReading = (text, cut) => ({ text, cut, at: 0, header: null, rows: [], values: 0, chars: 0, whole: true, done: false });

const charsOf = (line) => line.reduce((n, v) => n + (v === null ? 0 : v.length), 0);

// Reads one slice into `r`, keeping within `room`. Done once the text is read or the room is full.
export function readSlice(r, room) {
  const { lines, next } = readCsv(r.text, r.at, SLICE);
  r.at = next;
  let k = 0;
  if (!r.header) {
    r.header = lines[0] ?? [];
    k = 1;
  }
  for (; k < lines.length; k++) {
    const line = lines[k];
    for (let c = 0; c < line.length; c++) {
      const v = line[c];
      if (v === NULL_MARK) line[c] = null;
      else if (v.length > CELL_CHARS) line[c] = v.slice(0, CELL_CHARS);
    }
    const chars = charsOf(line);
    if (r.rows.length >= room.rows || r.values + line.length > room.values || r.chars + chars > room.chars) {
      r.whole = false;
      r.done = true;
      break;
    }
    r.rows.push(line);
    r.values += line.length;
    r.chars += chars;
  }
  if (!r.done && r.at >= r.text.length) {
    r.done = true;
    if (r.cut && r.rows.length > 0) {
      const last = r.rows.pop();
      r.values -= last.length;
      r.chars -= charsOf(last);
    }
    if (r.cut) r.whole = false;
  }
  if (r.done) r.text = null;
  return r;
}

// A query title as a file name: characters macOS, Linux or Windows refuse, and a leading dot, become "_".
export const fileName = (title) => String(title).replace(/[\u0000-\u001f/\\:*?"<>|]/g, "_").replace(/^\.+/, "_").trim().slice(0, 120) || "result";
