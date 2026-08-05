import { buildChildEnv } from './chunk-RFV7B6JD.js';
import './chunk-UG72A2JI.js';
import { classifyAdapterError } from './chunk-Z7JNYNWE.js';
import './chunk-UGPJGAIN.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

var execFileAsync = promisify(execFile);
var AntigravityAdapter = class {
  constructor(processManager) {
    this.processManager = processManager;
  }
  processManager;
  kind = "antigravity";
  async test() {
    try {
      const { stdout } = await execFileAsync("agy", ["--version"], { env: buildChildEnv() });
      return { ok: true, version: stdout.trim() };
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
//# sourceMappingURL=antigravity-R57MABEO.js.map
//# sourceMappingURL=antigravity-R57MABEO.js.map