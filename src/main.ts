import './styles.css';
import { createApp } from './app';
import type { WorkerFactory } from './inference/inference-client';

declare global {
  interface Window {
    /**
     * End-to-end tests inject a fake worker here so the UI can be driven without
     * downloading ~500 MB of model weights. Never set in normal browser use.
     */
    __WEBGPT_WORKER_FACTORY__?: WorkerFactory;
  }
}

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('WebGPT could not find its mount point (#app).');

void createApp({ root, workerFactory: window.__WEBGPT_WORKER_FACTORY__ });
