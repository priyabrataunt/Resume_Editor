import { exec } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function compileLatex(texSource: string): Promise<Buffer> {
  const id = `resume_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const dir = tmpdir();
  const texFile = join(dir, `${id}.tex`);
  const pdfFile = join(dir, `${id}.pdf`);

  await writeFile(texFile, texSource, 'utf-8');

  try {
    await execAsync(
      `pdflatex -interaction=nonstopmode -output-directory="${dir}" "${texFile}"`,
      { timeout: 30_000 }
    );
    const pdf = await readFile(pdfFile);
    return pdf;
  } catch (err: unknown) {
    // Try to get pdflatex log for better error messages
    const logFile = join(dir, `${id}.log`);
    let logContent = '';
    try {
      logContent = await readFile(logFile, 'utf-8');
    } catch {
      // log might not exist
    }
    const message = (err instanceof Error ? err.message : String(err));
    // Extract the actual LaTeX errors (lines starting with !) plus context
    const logLines = logContent.split('\n');
    const errorLines: string[] = [];
    for (let i = 0; i < logLines.length; i++) {
      if (logLines[i].startsWith('!')) {
        // Include the error line plus up to 4 lines of context
        errorLines.push(...logLines.slice(i, i + 5));
      }
    }
    const errorSummary = errorLines.length > 0
      ? errorLines.join('\n')
      : logContent.slice(-2000);
    throw new Error(`pdflatex failed:\n${errorSummary}`);
  } finally {
    for (const ext of ['.tex', '.pdf', '.log', '.aux', '.out']) {
      await unlink(join(dir, `${id}${ext}`)).catch(() => {});
    }
  }
}
