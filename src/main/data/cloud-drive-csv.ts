/** Strict Csv parsing preserves strings, quoted newlines and leading zeroes. */
export function parseCloudCsv(csv: string): string[][] {
  const text = csv.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell);
      cell = '';
      closed = false;
      if (char !== ',') {
        rows.push(row);
        row = [];
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else if (char === '"' && cell === '' && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error('Invalid cloud Csv quoting');
      cell += char;
    }
  }
  if (quoted) throw new Error('Unterminated cloud Csv field');
  if (row.length || cell || closed) rows.push([...row, cell]);
  if (!rows.length || rows[0].some((name) => !name) || new Set(rows[0]).size !== rows[0].length)
    throw new Error('Cloud Csv requires unique, non-empty column names');
  if (rows.some((cells) => cells.length !== rows[0].length))
    throw new Error('Cloud Csv has inconsistent column counts');
  return rows;
}

export function appendCloudCsv(existing: string, incoming: string): string {
  const [header, ...rows] = parseCloudCsv(existing);
  const [nextHeader, ...nextRows] = parseCloudCsv(incoming);
  if (header.length !== nextHeader.length || header.some((name) => !nextHeader.includes(name)))
    throw new Error('Cannot append: cloud file and output table columns do not match');
  const indices = header.map((name) => nextHeader.indexOf(name));
  return (
    [header, ...rows, ...nextRows.map((row) => indices.map((index) => row[index]))]
      .map((row) =>
        row
          .map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
          .join(',')
      )
      .join('\r\n') + '\r\n'
  );
}
