#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const ag = require('../vendor/anime25d/lib/ag-psd.min.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'live2d/source/v6_layers');
const OUTPUT = path.join(ROOT, 'live2d/assets/abc_succubus_rig_v6.psd');
const WIDTH = 887;
const HEIGHT = 1774;

const layerSpecs = [
  ['wing_1', 'wing_l.png'],
  ['wing_2', 'wing_r.png'],
  ['face underlay', 'head_underlay.png'],
  ['back hair', 'hair_back.png'],
  ['body_base', 'body_base.png'],
  ['cloak_1', 'cloak_l.png'],
  ['cloak_2', 'cloak_r.png'],
  ['tail', 'tail.png'],
  ['bust_1', 'bust_l.png'],
  ['bust_2', 'bust_r.png'],
  ['arm_1', 'arm_l.png'],
  ['arm_2', 'arm_r.png'],
  ['face', 'face_visible.png'],
  ['headwear_1', 'horn_l.png'],
  ['headwear_2', 'horn_r.png'],
  ['earwear_1', 'earring_l.png'],
  ['earwear_2', 'earring_r.png'],
  ['eyewhite', 'eyewhite.png'],
  ['irides', 'irides.png'],
  ['eyelash', 'eyelash.png'],
  ['eye_close', 'eye_close.png'],
  ['mouth_close', 'mouth_close.png'],
  ['mouth_open', 'mouth_open.png'],
  ['front hair_1', 'hair_side_l.png'],
  ['front hair_2', 'hair_side_r.png'],
  ['front hair_3', 'hair_crown.png'],
];

function pngToImageData(file) {
  const bytes = cp.execFileSync(
    'magick',
    [file, '-depth', '8', 'rgba:-'],
    { maxBuffer: WIDTH * HEIGHT * 4 + 1024 }
  );
  if (bytes.length !== WIDTH * HEIGHT * 4) {
    throw new Error(`Unexpected RGBA size for ${file}: ${bytes.length}`);
  }
  return {
    width: WIDTH,
    height: HEIGHT,
    data: new Uint8ClampedArray(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    ),
  };
}

ag.initializeCanvas(
  () => { throw new Error('Canvas creation is not needed for imageData PSD output'); },
  (width, height) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  })
);

const children = layerSpecs.map(([name, file]) => ({
  name,
  left: 0,
  top: 0,
  right: WIDTH,
  bottom: HEIGHT,
  imageData: pngToImageData(path.join(SOURCE, file)),
}));

const psd = {
  width: WIDTH,
  height: HEIGHT,
  imageData: pngToImageData(path.join(SOURCE, 'reconstructed.png')),
  children,
};

const bytes = ag.writePsdUint8Array(psd, {
  generateThumbnail: false,
  trimImageData: false,
});
fs.writeFileSync(OUTPUT, bytes);

const readback = ag.readPsd(bytes, {
  useImageData: true,
  skipThumbnail: true,
});
const report = {
  output: OUTPUT,
  bytes: bytes.length,
  width: readback.width,
  height: readback.height,
  layers: (readback.children || []).map((layer) => layer.name),
};
fs.writeFileSync(
  path.join(SOURCE, 'psd_readback.json'),
  `${JSON.stringify(report, null, 2)}\n`
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
