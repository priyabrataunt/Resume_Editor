#!/usr/bin/env node
/**
 * Reads POST /api/suggest JSON from stdin. Exits 0 if shape is valid; 1 otherwise.
 */
const MAX = 10;

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const buf = Buffer.concat(chunks).toString('utf8');

  let j;
  try {
    j = JSON.parse(buf);
  } catch {
    console.error('validate-suggest-response: response is not JSON');
    process.exit(1);
  }

  if (j.error && typeof j.error === 'string') {
    console.error('validate-suggest-response: API error:', j.error);
    process.exit(1);
  }

  if (!Array.isArray(j.suggestions)) {
    console.error('validate-suggest-response: missing suggestions array');
    process.exit(1);
  }

  if (j.suggestions.length > MAX) {
    console.error(`validate-suggest-response: expected at most ${MAX} suggestions, got ${j.suggestions.length}`);
    process.exit(1);
  }

  for (const s of j.suggestions) {
    if (typeof s.line !== 'number' || typeof s.old !== 'string' || typeof s.new !== 'string') {
      console.error('validate-suggest-response: invalid suggestion entry', s);
      process.exit(1);
    }
  }

  if (typeof j.atsScore !== 'number' || !j.scoreBreakdown || typeof j.scoreBreakdown !== 'object') {
    console.error('validate-suggest-response: missing atsScore or scoreBreakdown');
    process.exit(1);
  }

  console.log(`validate-suggest-response: ok (${j.suggestions.length} suggestions)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
