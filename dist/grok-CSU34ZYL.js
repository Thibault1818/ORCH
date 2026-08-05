import { buildChildEnv } from './chunk-RFV7B6JD.js';
import './chunk-UG72A2JI.js';
import { classifyAdapterError } from './chunk-Z7JNYNWE.js';
import './chunk-UGPJGAIN.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

var execFileAsync = promisify(execFile);
var GrokAdapter = class {
  constructor(processManager) {
    this.processManager = processManager;
  }
  processManager;
  kind = "grok";
  async test() {
    try {
      const { stdout } = await execFileAsync("grok", ["--version"], { env: buildChildEnv() });
      return { ok: true, version: stdout.trim() };
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
//# sourceMappingURL=grok-CSU34ZYL.js.map
//# sourceMappingURL=grok-CSU34ZYL.js.map