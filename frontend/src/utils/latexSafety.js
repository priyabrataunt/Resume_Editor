// Client-side mirror of backend/src/suggestPipeline.ts sanitiser.
//
// We sanitise on both sides because:
//   - The backend already escapes specials before returning suggestions.
//   - But user-pasted content (e.g. resume opened via "Open .tex") and
//     manual edits can still introduce unescaped #, %, &, _ that would
//     break compile when an AI suggestion runs through them.
// Cheap, idempotent, and identical to the server-side rules.

function escapeChar(text, char, escaped, allowLineStart = false) {
  const safe = char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  const re = new RegExp(`(?<!\\\\)${safe}`, 'g');
  if (!allowLineStart) return text.replace(re, escaped);
  return text.replace(re, (match, offset, full) => {
    const lineStart = full.lastIndexOf('\n', offset - 1) + 1;
    const beforeOnLine = full.slice(lineStart, offset);
    if (beforeOnLine.trim() === '') return match;
    return escaped;
  });
}

export function sanitizeLatexText(text) {
  if (!text) return text;
  let out = text;
  out = escapeChar(out, '#', '\\#');
  out = escapeChar(out, '&', '\\&');
  out = escapeChar(out, '_', '\\_');
  out = escapeChar(out, '%', '\\%', /* allowLineStart */ true);
  return out;
}

export function isItemizeBalanced(tex) {
  const opens = (tex.match(/\\begin\{itemize\}|\\resumeSubHeadingListStart|\\resumeItemListStart/g) || []).length;
  const closes = (tex.match(/\\end\{itemize\}|\\resumeSubHeadingListEnd|\\resumeItemListEnd/g) || []).length;
  return opens === closes;
}

export function isBraceBalanced(str) {
  if (!str) return true;
  let depth = 0;
  for (const ch of str) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}
