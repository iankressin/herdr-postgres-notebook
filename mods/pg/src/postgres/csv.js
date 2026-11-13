export const NULL_MARK = "<<NULL>>";

// Finds commas, newlines and quotes with indexOf: Herdr's script engine is slow at going
// character by character, and a result can be many megabytes. psql quotes any field that holds
// a quote, so a quote only ever opens a field.
export const parseCsv = (text) => readCsv(text).lines;

// Reads lines from `from` on, and stops after the line that brings the fields read to `fields`.
// `next` is where the following line starts, or the text's length once it is all read.
export function readCsv(text, from = 0, fields = Infinity) {
  const lines = [];
  const n = text.length;
  let line = [];
  let i = from;
  let count = 0;
  let comma = -1;
  let newline = -1;
  while (i < n) {
    let field;
    if (text.charCodeAt(i) === 34) {
      let from = i + 1;
      field = "";
      for (;;) {
        const q = text.indexOf('"', from);
        if (q < 0) { field += text.slice(from); i = n; break; }
        if (text.charCodeAt(q + 1) === 34) { field += text.slice(from, q + 1); from = q + 2; continue; }
        field += text.slice(from, q);
        i = q + 1;
        break;
      }
      const tail = i < n ? text.indexOf(",", i) : -1;
      const end = i < n ? text.indexOf("\n", i) : -1;
      const stop = Math.min(tail < 0 ? n : tail, end < 0 ? n : end);
      if (stop > i) { field += text.slice(i, stop); i = stop; }
    } else {
      if (comma < i) comma = text.indexOf(",", i);
      if (newline < i) newline = text.indexOf("\n", i);
      if (comma < 0) comma = n;
      if (newline < 0) newline = n;
      const stop = Math.min(comma, newline);
      field = text.slice(i, stop);
      i = stop;
    }
    line.push(field);
    if (i >= n) { lines.push(line); break; }
    if (text.charCodeAt(i) === 10) {
      lines.push(line);
      count += line.length;
      line = [];
      if (count >= fields) return { lines, next: i + 1 };
    }
    i++;
    if (i === n && text.charCodeAt(n - 1) === 44) { line.push(""); lines.push(line); }
  }
  return { lines, next: n };
}

export function parseRows(text) {
  const [header = [], ...rows] = parseCsv(text);
  return { header, rows: rows.map((row) => row.map((value) => (value === NULL_MARK ? null : value))) };
}
