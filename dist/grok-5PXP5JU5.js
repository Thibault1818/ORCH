import { adapterCommandRunner, probeVersion, buildChildEnv } from './chunk-GZNNMHER.js';
import './chunk-W5CCIQAE.js';
import './chunk-UG72A2JI.js';
import { classifyAdapterError } from './chunk-Z7JNYNWE.js';
import './chunk-OBMT332P.js';

// src/infrastructure/adapters/grok.ts
var GrokAdapter = class {
  constructor(processManager, runner) {
    this.processManager = processManager;
    this.runner = adapterCommandRunner(processManager, runner);
  }
  processManager;
  kind = "grok";
  runner;
  async test() {
    try {
      return { ok: true, version: await probeVersion(this.runner, "grok", buildChildEnv()) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: "Grok CLI not found. Install and authenticate the grok CLI, then ensure `grok` is on PATH.",
        errorKind: classifyAdapterError(msg)
      };
    }
  }
  execute(params) {
    throw new Error("Grok execution is disabled: supported stdin prompt transport is not proven and argv prompt transport is prohibited");
  }
  async stop(pid) {
    await this.processManager.killWithGrace(pid);
  }
};

export { GrokAdapter };
//# sourceMappingURL=grok-5PXP5JU5.js.map
//# sourceMappingURL=grok-5PXP5JU5.js.map