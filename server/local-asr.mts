import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function spawnWorker() {
  return spawn(
    join(homedir(), 'Library', 'Application Support', 'Ankimo', 'asr', '.venv', 'bin', 'python'),
    ['-u', fileURLToPath(new URL('./local-asr.py', import.meta.url))],
    { stdio: 'pipe', env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' } }
  );
}

// ponytail: the Capture worker is serial; add request IDs only if it becomes concurrent.
export function createLocalTranscriber(launch: () => ChildProcessWithoutNullStreams = spawnWorker, timeoutMs = 70_000) {
  let worker: ChildProcessWithoutNullStreams | null = null;
  let complete: ((error: Error | null, text?: string) => void) | null = null;
  let buffer = '';

  function close() {
    const previous = worker;
    worker = null;
    previous?.kill('SIGKILL');
    // Keep legacy wire error codes so already-installed iPhones can still retry.
    complete?.(new Error('TYPELESS_FAILED'));
    buffer = '';
  }

  function start() {
    const child = launch();
    worker = child;
    child.stderr.resume(); // Never persist library diagnostics or transcript content.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (child !== worker) return;
      buffer += chunk;
      if (buffer.length > 256 * 1024) { close(); return; }
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const result = JSON.parse(line) as { text?: unknown };
        if (buffer || typeof result.text !== 'string' || !result.text.trim() || result.text.length > 50_000) {
          close();
          return;
        }
        complete?.(null, result.text.trim());
      } catch { close(); }
    });
    child.once('error', () => { if (child === worker) close(); });
    child.once('exit', () => { if (child === worker) close(); });
    child.stdin.on('error', () => { if (child === worker) close(); });
    return child;
  }

  return {
    transcribe(path: string): Promise<string> {
      if (complete) return Promise.reject(new Error('TYPELESS_FAILED'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(close, timeoutMs);
        complete = (error, text) => {
          clearTimeout(timer);
          complete = null;
          if (error) reject(error);
          else resolve(text!);
        };
        try {
          (worker || start()).stdin.write(JSON.stringify({ path }) + '\n');
        } catch { close(); }
      });
    },
    close
  };
}
