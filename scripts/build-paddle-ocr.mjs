import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const output = 'smart-pid/generated/paddle';
const modelRoot = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/';
const models = {
  'PP-OCRv5_mobile_det': '781056046c9ed77a15c94681605db6a0f62317c2e9cce6931c71da2478d4bc30',
  'en_PP-OCRv5_mobile_rec': '4424e851309b291b00aab8191cd4314cefbd2d1b2381ff8994019d262fa95e28'
};
const hash = content => createHash('sha256').update(content).digest('hex');

async function prepareModel([name, sha]) {
  const destination = `${output}/models/${name}.tar`;
  const existing = await readFile(destination).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (existing && hash(existing) === sha) return;
  const temporary = destination + '.download';
  try {
    await promisify(execFile)('curl', ['--fail', '--silent', '--show-error', '--location',
      '--retry', '2', '--max-time', '180', '--output', temporary, `${modelRoot}${name}_onnx_infer.tar`]);
    if (hash(await readFile(temporary)) !== sha) throw new Error(`Unexpected checksum for ${name}`);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

await Promise.all(['ort', 'assets', 'models'].map(path => mkdir(`${output}/${path}`, { recursive: true })));
await Promise.all([
  build({
    stdin: { contents: "export { PaddleOCR } from '@paddleocr/paddleocr-js'", resolveDir: process.cwd() },
    outfile: `${output}/sdk.mjs`,
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    external: ['fs', 'path'],
    legalComments: 'linked'
  }),
  copyFile('node_modules/@paddleocr/paddleocr-js/dist/assets/worker-entry-C9UNuyOJ.js',
    `${output}/assets/worker-entry-C9UNuyOJ.js`),
  ...['mjs', 'wasm'].map(ext => copyFile(`node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.${ext}`,
    `${output}/ort/ort-wasm-simd-threaded.jsep.${ext}`)),
  ...Object.entries(models).map(prepareModel)
]);
