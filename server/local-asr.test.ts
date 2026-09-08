import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createLocalTranscriber } from './local-asr.mts';

it('reuses a serial local worker and preserves Unicode transcription', async () => {
  let starts = 0;
  const asr = createLocalTranscriber(() => {
    starts += 1;
    return spawn(process.execPath, ['-e', `
      require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
        const {path} = JSON.parse(line);
        process.stdout.write(JSON.stringify({text: 'Ankimo 中文 ' + path}) + '\\n');
      });
    `], { stdio: 'pipe' });
  });
  try {
    expect(await asr.transcribe('first.m4a')).toBe('Ankimo 中文 first.m4a');
    expect(await asr.transcribe('second.m4a')).toBe('Ankimo 中文 second.m4a');
    expect(starts).toBe(1);
  } finally { asr.close(); }
});

it('rejects a crashed worker and starts a fresh process for an explicit later attempt', async () => {
  let starts = 0;
  const asr = createLocalTranscriber(() => spawn(process.execPath, ['-e', ++starts === 1
    ? 'process.exit(1)'
    : `process.stdin.once('data', () => process.stdout.write('{"text":"recovered"}\\n'));`
  ], { stdio: 'pipe' }));
  try {
    await expect(asr.transcribe('first.m4a')).rejects.toThrow('TYPELESS_FAILED');
    expect(await asr.transcribe('second.m4a')).toBe('recovered');
    expect(starts).toBe(2);
  } finally { asr.close(); }
});

it('times out without replaying the recording automatically', async () => {
  let starts = 0;
  const asr = createLocalTranscriber(() => {
    starts += 1;
    return spawn(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: 'pipe' });
  }, 100);
  try {
    await expect(asr.transcribe('recording.m4a')).rejects.toThrow('TYPELESS_FAILED');
    expect(starts).toBe(1);
  } finally { asr.close(); }
});

it.each(['{}', '{"text":""}', '{"error":"TRANSCRIPTION_FAILED"}', 'not json'])('rejects invalid model output: %s', async output => {
  const asr = createLocalTranscriber(() => spawn(process.execPath, ['-e',
    `process.stdin.once('data', () => process.stdout.write(${JSON.stringify(output + '\n')}));`
  ], { stdio: 'pipe' }));
  try {
    await expect(asr.transcribe('recording.m4a')).rejects.toThrow('TYPELESS_FAILED');
  } finally { asr.close(); }
});
