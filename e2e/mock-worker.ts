/**
 * Installed via `page.addInitScript` before the app boots. It replaces the real
 * Transformers.js worker with a scripted one so end-to-end tests exercise the whole
 * UI without downloading ~500 MB of model weights.
 */
export function installMockWorker(
  options: { backend?: 'webgpu' | 'wasm'; failLoad?: boolean; thinking?: boolean } = {},
): string {
  const config = JSON.stringify({
    backend: options.backend ?? 'webgpu',
    failLoad: options.failLoad ?? false,
    thinking: options.thinking ?? false,
  });
  return `
    (() => {
      const config = ${config};
      class MockWorker extends EventTarget {
        constructor() {
          super();
          this.commands = [];
          window.__WEBGPT_MOCK__ = this;
        }
        emit(event) {
          this.dispatchEvent(Object.assign(new Event('message'), { data: event }));
        }
        terminate() {}
        postMessage(command) {
          this.commands.push(command);
          if (command.type === 'initialize') {
            this.emit({ type: 'status', status: 'loading', phase: 'checking', detail: 'Checking device' });
            setTimeout(() => {
              this.emit({ type: 'status', status: 'loading', phase: 'downloading', detail: 'Downloading model' });
              this.emit({ type: 'progress', file: 'model.onnx', loaded: 60, total: 100 });
            }, 40);
            setTimeout(() => {
              if (config.failLoad) {
                this.emit({ type: 'error', code: 'load-failed', message: 'Mock download failed.' });
              } else {
                this.emit({ type: 'status', status: 'loading', phase: 'preparing', detail: 'Preparing model' });
                this.emit({
                  type: 'ready',
                  backend: config.backend,
                  model: command.model,
                  ...(config.backend === 'wasm'
                    ? { warning: 'WebGPU is unavailable, so WebGPT is running on the CPU (WASM). Replies will be noticeably slower.' }
                    : {}),
                });
              }
            }, 90);
          }
          if (command.type === 'generate') {
            const id = command.requestId;
            this.currentId = id;
            this.stopped = false;
            const answer = ['Sunlight', ' scatters', ' off', ' air', ' molecules,', ' and', ' blue', ' scatters', ' most.'];
            // Tag halves are emitted separately so the parser meets real chunk splits.
            const words = config.thinking
              ? ['<thi', 'nk>', 'Rayleigh scattering', ' favours short wavelengths.', '</thi', 'nk>', ...answer]
              : answer;
            let index = 0;
            let text = '';
            const tick = () => {
              if (this.stopped) return;
              if (index >= words.length) {
                this.emit({ type: 'complete', requestId: id, text });
                return;
              }
              text += words[index++];
              this.emit({ type: 'token', requestId: id, text: words[index - 1] });
              setTimeout(tick, 80);
            };
            setTimeout(tick, 60);
          }
          if (command.type === 'abort') {
            this.stopped = true;
            const partial = 'Sunlight scatters';
            this.emit({ type: 'aborted', requestId: command.requestId, text: partial });
          }
        }
      }
      window.__WEBGPT_WORKER_FACTORY__ = () => new MockWorker();
    })();
  `;
}
