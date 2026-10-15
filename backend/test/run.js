// Test runner: seeds a throwaway database, starts the server with a fixed clock
// (7:00 AM IST on a Tuesday), runs every test file, then restarts at 9:00 AM for the
// after-cutoff checks. Your real data.json is never touched.
//
//   npm test

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'test-data.json');
const PORT = '3999';
const DAY = '2026-10-20'; // a Tuesday
const env = (now) => ({ ...process.env, DB_FILE: DB, PORT, AUTH_RATE_LIMIT: '10000', RASOI_NOW: `${DAY}T${now}:00+05:30`, BASE: `http://localhost:${PORT}` });

function cleanup() {
  [DB, DB + '.tmp'].forEach(f => { try { fs.unlinkSync(f); } catch (e) { /* not there */ } });
}

function startServer(now) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: env(now) });
    let out = '';
    const onData = chunk => {
      out += chunk;
      if (out.includes('RasoiSe running')) resolve(proc);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', chunk => { out += chunk; });
    proc.on('exit', code => reject(new Error(`Server exited (${code}):\n${out}`)));
    setTimeout(() => reject(new Error('Server did not start:\n' + out)), 15000);
  });
}

function runTest(file, now) {
  console.log(`\n=== ${file} ===`);
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], { cwd: ROOT, env: env(now), stdio: 'inherit' });
  return res.status === 0;
}

(async () => {
  cleanup();
  const seeded = spawnSync(process.execPath, ['seed.js'], { cwd: ROOT, env: env('07:00'), encoding: 'utf8' });
  if (seeded.status !== 0) { console.error(seeded.stderr); process.exit(1); }
  console.log(seeded.stdout.trim());

  let ok = true;
  let server = await startServer('07:00');
  for (const f of ['phase1.js', 'phase2.js', 'phase6.js']) ok = runTest(f, '07:00') && ok;
  server.kill();
  await new Promise(r => setTimeout(r, 500));

  server = await startServer('09:00');
  ok = runTest('cutoff.js', '09:00') && ok;
  server.kill();
  await new Promise(r => setTimeout(r, 300));
  cleanup();

  console.log(ok ? '\nAll test files passed.' : '\nSome tests failed.');
  process.exitCode = ok ? 0 : 1;
})().catch(err => {
  console.error(err.message);
  cleanup();
  process.exit(1);
});
