import { adapterCommandRunner, probeVersion, buildChildEnv } from './chunk-GZNNMHER.js';
import './chunk-W5CCIQAE.js';
import './chunk-UG72A2JI.js';
import { classifyAdapterError } from './chunk-Z7JNYNWE.js';
import './chunk-OBMT332P.js';

// src/infrastructure/adapters/antigravity.ts
var AntigravityAdapter = class {
  constructor(processManager, runner) {
    this.processManager = processManager;
    this.runner = adapterCommandRunner(processManager, runner);
  }
  processManager;
  kind = "antigravity";
  runner;
  async test() {
    try {
      return { ok: true, version: await probeVersion(this.runner, "agy", buildChildEnv()) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: "Antigravity CLI not found. Install Google Antigravity CLI and ensure `agy` is on PATH.",
        errorKind: classifyAdapterError(msg)
      };
    }
  }
  execute(params) {
    throw new Error("Antigravity execution is disabled: supported stdin prompt transport is not proven and argv prompt transport is prohibited");
  }
  async stop(pid) {
    await this.processManager.killWithGrace(pid);
  }
};

export { AntigravityAdapter };
//# sourceMappingURL=antigravity-P7UECLLC.js.map
//# sourceMappingURL=antigravity-P7UECLLC.js.map