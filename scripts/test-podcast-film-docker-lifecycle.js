/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadLifecycleModule() {
  const modulePath = path.join(
    process.cwd(),
    'src/lib/podcast-video/docker-lifecycle.ts'
  );
  const source = fs.readFileSync(modulePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const mod = { exports: {} };
  const fn = new Function('exports', 'module', 'require', compiled);
  fn(mod.exports, mod, require);
  return mod.exports;
}

async function main() {
  const lifecycle = loadLifecycleModule();

  assert.equal(
    lifecycle.isRetryablePodcastFilmInfrastructureError(
      new Error('SoulX /generate failed: 503 model crashed')
    ),
    true
  );
  assert.equal(
    lifecycle.isRetryablePodcastFilmInfrastructureError(
      new Error('Gemini API key is not configured for podcast-film.')
    ),
    false
  );
  assert.equal(
    lifecycle.isRetryablePodcastFilmInfrastructureError(
      new Error('fetch http://192.168.0.13:8766/images/Men/a.jpg failed: 502')
    ),
    true
  );

  let attempts = 0;
  let restarts = 0;
  let readiness = 0;
  const result = await lifecycle.runWithPodcastFilmInfrastructureRetries({
    maxRetries: 3,
    operation: async ({ attempt }) => {
      attempts += 1;
      if (attempt < 3) {
        throw new Error('SoulX /generate failed: 500 warmup error');
      }
      return 'render-ok';
    },
    restartInfrastructure: async () => {
      restarts += 1;
    },
    ensureReady: async () => {
      readiness += 1;
    },
  });
  assert.equal(result, 'render-ok');
  assert.equal(attempts, 4);
  assert.equal(restarts, 3);
  assert.equal(readiness, 3);

  let nonRetryAttempts = 0;
  await assert.rejects(
    () =>
      lifecycle.runWithPodcastFilmInfrastructureRetries({
        maxRetries: 3,
        operation: async () => {
          nonRetryAttempts += 1;
          throw new Error('Pinned image "x.jpg" not in folder Men for voice Charon');
        },
        restartInfrastructure: async () => {
          throw new Error('should not restart for input errors');
        },
        ensureReady: async () => {},
      }),
    /Pinned image/
  );
  assert.equal(nonRetryAttempts, 1);

  const stopCalls = [];
  const timer = lifecycle.createPodcastFilmDockerIdleStopController({
    idleStopMs: 25,
    stopContainers: async () => {
      stopCalls.push(Date.now());
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle),
  });
  const firstLease = timer.acquire();
  const secondLease = timer.acquire();
  firstLease.release();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(stopCalls.length, 0);
  secondLease.release();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(stopCalls.length, 1);

  console.log('podcast-film docker lifecycle tests passed');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
