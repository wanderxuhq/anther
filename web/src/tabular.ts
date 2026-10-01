export type Delimiter = ',' | '\t';

/** Parse delimited text for preview only. This function never evaluates cell contents. */
export function parseDelimited(
  text: string,
  delimiter: Delimiter,
  maxRows = 1000,
): { rows: string[][]; truncated: boolean } {
  // A UTF-8 BOM is sometimes included when text is decoded by the caller.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.length === 0) return { rows: [], truncated: false };

  const limit = Number.isFinite(maxRows) ? Math.max(0, Math.floor(maxRows)) : 1000;
  if (limit === 0) return { rows: [], truncated: true };

  const rows: string[][] = [];
  let i = 0;

  while (i < text.length) {
    const row: string[] = [];
    let field = '';
    let inQuotes = false;
    let atFieldStart = true;
    let hasRecordContent = false;
    let endedByNewline = false;

    while (i < text.length) {
      const char = text[i];

      if (inQuotes) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            inQuotes = false;
            i++;
          }
        } else {
          // Preserve line breaks inside quoted fields exactly as supplied.
          field += char;
          i++;
        }
        continue;
      }

      if (char === delimiter) {
        row.push(field);
        field = '';
        atFieldStart = true;
        hasRecordContent = true;
        i++;
        continue;
      }

      if (char === '\r' || char === '\n') {
        row.push(field);
        i++;
        if (char === '\r' && text[i] === '\n') i++;
        endedByNewline = true;
        break;
      }

      if (char === '"' && atFieldStart) {
        inQuotes = true;
        atFieldStart = false;
        hasRecordContent = true;
        i++;
        continue;
      }

      field += char;
      atFieldStart = false;
      hasRecordContent = true;
      i++;
    }

    // At EOF, do not turn an ordinary final line break into an extra row.
    if (!endedByNewline && (hasRecordContent || field.length > 0 || row.length > 0)) {
      row.push(field);
    }

    if (endedByNewline || hasRecordContent || field.length > 0 || row.length > 0) {
      rows.push(row);
      if (rows.length === limit) {
        // The remaining input starts another record; leave it unparsed.
        return { rows, truncated: i < text.length };
      }
    }
  }

  return { rows, truncated: false };
}
