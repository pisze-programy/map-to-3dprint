#!/usr/bin/env node
// Builds standalone offline vendor IIFE bundles in src/vendor/ from node_modules
// Zero GPL-3.0 dependencies, zero external runtime fetches.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(ROOT, 'src', 'vendor');
fs.mkdirSync(VENDOR_DIR, { recursive: true });

async function buildVendorBundle() {
  const entryCode = `
    import osmtogeojson from 'osmtogeojson';
    import Delatin from 'delatin';
    import earcut, { flatten as earcutFlatten, deviation as earcutDeviation } from 'earcut';
    import * as fflate from 'fflate/browser';
    import * as clipper2 from 'clipper2-ts';
    import * as straightSkeleton from 'straight-skeleton';

    earcut.flatten = earcutFlatten;
    earcut.deviation = earcutDeviation;

    const g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global);
    g.__OSMTOGEOJSON__ = osmtogeojson;
    g.__DELATIN__ = Delatin;
    g.__EARCUT__ = earcut;
    g.__FFLATE__ = fflate;
    g.__CLIPPER2__ = clipper2;
    g.__STRAIGHT_SKELETON__ = straightSkeleton;

    export {
      osmtogeojson,
      Delatin,
      earcut,
      fflate,
      clipper2,
      straightSkeleton
    };
  `;

  const outPath = path.join(VENDOR_DIR, 'vendor_bundle.js');
  await esbuild.build({
    stdin: {
      contents: entryCode,
      resolveDir: ROOT,
      sourcefile: 'vendor_entry.js',
      loader: 'js',
    },
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: '__MAP3D_VENDOR__',
    platform: 'browser',
    target: ['es2020'],
    outfile: outPath,
    banner: {
      js: '/* Bundled permissive vendor deps (osmtogeojson MIT, delatin ISC, earcut ISC, fflate MIT, clipper2-ts BSL-1.0, straight-skeleton 1.1.0 MIT) */',
    },
    footer: {
      js: 'if (typeof module !== "undefined" && module.exports) { module.exports = __MAP3D_VENDOR__; }',
    },
  });

  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`Built ${path.relative(ROOT, outPath)} (${kb} KB)`);
}

function buildManifoldVendor() {
  const mfDir = path.join(ROOT, 'node_modules', 'manifold-3d');
  const mfRaw = fs.readFileSync(path.join(mfDir, 'manifold.js'), 'utf8');
  const wasmBuf = fs.readFileSync(path.join(mfDir, 'manifold.wasm'));
  const wasmB64 = wasmBuf.toString('base64');

  // Make array checks cross-realm safe (Node VM / iframes where x instanceof Array is false)
  const fixCrossRealmArrays = (code) =>
    code.replace(/([a-zA-Z0-9_\$\[\]]+)\s*instanceof\s+Array(?!Buffer)\b/g, 'Array.isArray($1)');

  // Async version for offline async Node init
  let mfAsyncBody = fixCrossRealmArrays(mfRaw)
    .replace('var _scriptName=import.meta.url;', 'var _scriptName="";')
    .replace('new URL("manifold.wasm",import.meta.url).href', '"manifold.wasm"')
    .replace(/if\(ENVIRONMENT_IS_NODE\)\{const\{createRequire\}=await import\("node:module"\);var require=createRequire\(import\.meta\.url\)\}/, '')
    .replace(/async function Module\(moduleArg=\{\}\)/, 'async function __createManifoldModuleAsync(moduleArg={})')
    .replace(/;return moduleRtn\}\s*export default Module;\s*$/, ';return moduleRtn}');

  // Sync version for synchronous Node CJS tests and synchronous VM runtime
  // Strips the 2 Node/async-only loader paths when wasmBinary is pre-decoded synchronously.
  const syncNeedleImport = 'if(ENVIRONMENT_IS_NODE){const{createRequire}=await import("node:module");var require=createRequire(import.meta.url)}';
  const syncNeedleCreate = 'var wasmExports;wasmExports=await (createWasm());run();';
  const syncNeedleFetch1 = 'async function getWasmBinary(binaryFile)';
  const syncNeedleFetch2 = 'async function instantiateArrayBuffer(binaryFile,imports)';
  const syncNeedleFetch3 = 'async function instantiateAsync(binary,binaryFile,imports)';
  const syncNeedleCreateWasm = 'async function createWasm()';

  if (!mfRaw.includes(syncNeedleCreate)) {
    throw new Error('Unexpected manifold.js structure: missing createWasm await needle');
  }

  let mfSyncBody = fixCrossRealmArrays(mfRaw)
    .replace('var _scriptName=import.meta.url;', 'var _scriptName="";')
    .replace('new URL("manifold.wasm",import.meta.url).href', '"manifold.wasm"')
    .replace(syncNeedleImport, '')
    .replace(/async function Module\(moduleArg=\{\}\)/, 'function __createManifoldModuleSync(moduleArg={})')
    .replace(syncNeedleFetch1, 'function getWasmBinary(binaryFile)')
    .replace(syncNeedleFetch2, 'function instantiateArrayBuffer(binaryFile,imports)')
    .replace(syncNeedleFetch3, 'function instantiateAsync(binary,binaryFile,imports)')
    .replace(syncNeedleCreateWasm, 'function createWasm()')
    .replace(/var response=await fetch\([^;]+\);/g, 'throw new Error("Async fetch disallowed in sync Manifold loader");')
    .replace(/var response=await readAsync\(binaryFile\);/g, 'return new Uint8Array(wasmBinary);')
    .replace(/var binary=await getWasmBinary\(binaryFile\);var instance=await WebAssembly\.instantiate\(binary,imports\);/g,
      'var mod=new WebAssembly.Module(wasmBinary);var instance=new WebAssembly.Instance(mod,imports);return {instance,module:mod};')
    .replace(/var instantiationResult=await WebAssembly\.instantiateStreaming\(response,imports\);/g,
      'var mod=new WebAssembly.Module(wasmBinary);var instantiationResult={instance:new WebAssembly.Instance(mod,imports),module:mod};')
    .replace('var result=await instantiateAsync(wasmBinary,wasmBinaryFile,info);',
      'var mod=new WebAssembly.Module(wasmBinary);var result={instance:new WebAssembly.Instance(mod,info),module:mod};')
    .replace(syncNeedleCreate, 'var wasmExports;wasmExports=createWasm();run();')
    .replace(/;return moduleRtn\}\s*export default Module;\s*$/, ';return moduleRtn}');

  if (/\bawait\b/.test(mfSyncBody)) {
    const rem = mfSyncBody.match(/.{0,35}\bawait\b.{0,35}/);
    throw new Error(`Unexpected remaining await in mfSyncBody: ${rem && rem[0]}`);
  }

  const outJs = `/* manifold-3d v3.5.5 (Apache-2.0) dual sync/async offline WASM bundle */
(function (root) {
  var MANIFOLD_WASM_B64 = "${wasmB64}";
  var _cachedBytes = null;
  var _initPromise = null;

  function _decodeWasmBytes() {
    if (_cachedBytes) return _cachedBytes;
    if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
      _cachedBytes = new Uint8Array(Buffer.from(MANIFOLD_WASM_B64, "base64"));
      return _cachedBytes;
    }
    if (typeof root.atob === "function" || typeof atob === "function") {
      var bin = root.atob ? root.atob(MANIFOLD_WASM_B64) : atob(MANIFOLD_WASM_B64);
      var len = bin.length;
      var out = new Uint8Array(len);
      for (var i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
      _cachedBytes = out;
      return out;
    }
    // Pure-JS Base64 fallback for restricted VM sandboxes without Buffer/atob
    var b64 = MANIFOLD_WASM_B64;
    var lookup = new Uint8Array(256);
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (var ci = 0; ci < 64; ci++) lookup[chars.charCodeAt(ci)] = ci;
    var n = b64.length;
    var pad = (n >= 2 && b64.charCodeAt(n - 2) === 61) ? 2 : ((n >= 1 && b64.charCodeAt(n - 1) === 61) ? 1 : 0);
    var outLen = ((n * 3) >> 2) - pad;
    var bytes = new Uint8Array(outLen);
    var p = 0;
    for (var i = 0; i < n; i += 4) {
      var e1 = lookup[b64.charCodeAt(i)];
      var e2 = lookup[b64.charCodeAt(i + 1)];
      var e3 = lookup[b64.charCodeAt(i + 2)];
      var e4 = lookup[b64.charCodeAt(i + 3)];
      var a = (e1 << 2) | (e2 >> 4);
      var b = ((e2 & 15) << 4) | (e3 >> 2);
      var c = ((e3 & 3) << 6) | e4;
      bytes[p++] = a;
      if (p < outLen) bytes[p++] = b;
      if (p < outLen) bytes[p++] = c;
    }
    _cachedBytes = bytes;
    return bytes;
  }

${mfAsyncBody}

${mfSyncBody}

  root.__ensureManifoldReady = async function __ensureManifoldReady() {
    if (root.__MANIFOLD_LIB__) return root.__MANIFOLD_LIB__;
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
      var bytes = _decodeWasmBytes();
      var mod = await __createManifoldModuleAsync({
        wasmBinary: bytes,
        locateFile: function (p) { return p; }
      });
      if (typeof mod.setup === "function") mod.setup();
      root.__MANIFOLD_LIB__ = mod;
      return mod;
    })();
    return _initPromise;
  };

  root.__getManifoldSync = function __getManifoldSync() {
    if (root.__MANIFOLD_LIB__) return root.__MANIFOLD_LIB__;
    var bytes = _decodeWasmBytes();
    var mod = __createManifoldModuleSync({
      wasmBinary: bytes,
      locateFile: function (p) { return p; }
    });
    if (typeof mod.setup === "function") mod.setup();
    root.__MANIFOLD_LIB__ = mod;
    return mod;
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      __ensureManifoldReady: root.__ensureManifoldReady,
      __getManifoldSync: root.__getManifoldSync
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : global));
`;

  const outPath = path.join(VENDOR_DIR, 'manifold_vendor.js');
  fs.writeFileSync(outPath, outJs);
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`Built ${path.relative(ROOT, outPath)} (${kb} KB)`);
}

(async () => {
  await buildVendorBundle();
  buildManifoldVendor();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
