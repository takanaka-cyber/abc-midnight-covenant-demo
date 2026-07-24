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
  ['wing underlay_1', 'underlay_wing_l.png'],
  ['wing underlay_2', 'underlay_wing_r.png'],
  ['tail underlay', 'underlay_tail.png'],
  ['leg underlay_1', 'underlay_leg_l.png'],
  ['leg underlay_2', 'underlay_leg_r.png'],
  ['cloak underlay_1', 'underlay_cloak_l.png'],
  ['cloak underlay_2', 'underlay_cloak_r.png'],
  ['bust underlay', 'underlay_bust.png'],
  ['arm underlay_1', 'underlay_arm_l.png'],
  ['arm underlay_2', 'underlay_arm_r.png'],
  ['front hair underlay', 'underlay_front_hair.png'],
  ['wing_1', 'wing_l.png'],
  ['wing_2', 'wing_r.png'],
  ['tail', 'tail.png'],
  ['leg_1', 'leg_l.png'],
  ['leg_2', 'leg_r.png'],
  ['face underlay', 'head_underlay.png'],
  ['body_base', 'body_base.png'],
  ['cloak_1', 'cloak_l.png'],
  ['cloak_2', 'cloak_r.png'],
  ['bust', 'bust.png'],
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
  ['front hair', 'front_hair.png'],
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
