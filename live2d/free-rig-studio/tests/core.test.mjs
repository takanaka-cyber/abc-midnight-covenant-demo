import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../core.js');

function fixture() {
  const mesh = Core.createRectMesh(20, 20, 1, 1);
  return {
    version: Core.VERSION,
    meta: { name: 'core fixture' },
    canvas: { width: 100, height: 100 },
    physicsFps: 60,
    parameters: [
      { id: 'Turn', name: 'Turn', min: -1, max: 1, default: 0 },
      { id: 'Open', name: 'Open', min: 0, max: 1, default: 1 }
    ],
    textures: [
      { id: 'tex_mask', src: 'data:image/png;base64,AA==' },
      { id: 'tex_face', src: 'data:image/png;base64,AA==' }
    ],
    nodes: [
      {
        id: 'root',
        name: 'Root',
        type: 'rotation',
        parentId: null,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        bindings: {}
      },
      {
        id: 'warp',
        name: 'Warp',
        type: 'warp',
        parentId: 'root',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        warp: { x: 0, y: 0, width: 100, height: 100, columns: 1, rows: 1 },
        bindings: {
          Turn: {
            interpolation: 'smooth',
            keyforms: [
              { value: -1, state: { warpOffsets: [-10, 0, -10, 0, -10, 0, -10, 0] } },
              { value: 0, state: { warpOffsets: [0, 0, 0, 0, 0, 0, 0, 0] } },
              { value: 1, state: { warpOffsets: [10, 0, 10, 0, 10, 0, 10, 0] } }
            ]
          }
        }
      },
      {
        id: 'mask',
        name: 'Mask',
        type: 'part',
        parentId: 'warp',
        textureId: 'tex_mask',
        visible: true,
        maskIds: [],
        transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, drawOrder: 0 },
        mesh,
        bindings: {}
      },
      {
        id: 'face',
        name: 'Face',
        type: 'part',
        parentId: 'warp',
        textureId: 'tex_face',
        visible: true,
        maskIds: ['mask'],
        transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, drawOrder: 10 },
        mesh,
        bindings: {
          Turn: {
            interpolation: 'smooth',
            keyforms: [
              { value: -1, state: { x: -5 } },
              { value: 0, state: { x: 0 } },
              { value: 1, state: { x: 5 } }
            ]
          },
          Open: {
            interpolation: 'smooth',
            keyforms: [
              { value: 0, state: { opacity: 0 } },
              { value: 1, state: { opacity: 1 } }
            ]
          }
        }
      }
    ]
  };
}

test('validates a complete hierarchy with masks and warp bindings', () => {
  const validation = Core.validateModel(fixture());
  assert.equal(validation.ok, true, validation.errors.join('\n'));
});

test('evaluates keyforms, warp offsets, opacity, masks, and draw order', () => {
  const evaluator = Core.createEvaluator(fixture());
  const neutral = evaluator.evaluate({ Turn: 0, Open: 1 });
  const turned = evaluator.evaluate({ Turn: 1, Open: 0 });
  const faceNeutral = neutral.parts.find((part) => part.id === 'face');
  const faceTurned = turned.parts.find((part) => part.id === 'face');

  assert.deepEqual(faceNeutral.positions[0], [10, 20]);
  assert.deepEqual(faceTurned.positions[0], [25, 20]);
  assert.equal(faceTurned.opacity, 0);
  assert.deepEqual(faceTurned.maskIds, ['mask']);
  assert.deepEqual(turned.parts.map((part) => part.id), ['mask', 'face']);
});

test('applies rotation parents after local part transforms', () => {
  const model = fixture();
  model.nodes[0].transform.rotation = 90;
  const face = Core.createEvaluator(model).evaluate({ Turn: 0, Open: 1 })
    .parts.find((part) => part.id === 'face');
  assert.ok(Math.abs(face.positions[0][0] + 20) < 1e-9);
  assert.ok(Math.abs(face.positions[0][1] - 10) < 1e-9);
});

test('round-trips the model schema without losing keyforms', () => {
  const model = fixture();
  model.nodes.splice(1, 0, {
    id: 'psd_group_face',
    name: 'Face group',
    type: 'group',
    parentId: 'root',
    source: { path: ['Character', 'Face'] },
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
    bindings: {}
  });
  model.nodes.find((node) => node.id === 'warp').parentId = 'psd_group_face';
  const json = Core.exportModel(model);
  const restored = Core.importModel(json);
  assert.deepEqual(restored, model);
});

test('adds warp base offsets before parameter keyform deltas', () => {
  const model = fixture();
  model.nodes.find((node) => node.id === 'warp').warp.baseOffsets =
    [2, 3, 2, 3, 2, 3, 2, 3];
  const face = Core.createEvaluator(model).evaluate({ Turn: 1, Open: 1 })
    .parts.find((part) => part.id === 'face');
  assert.deepEqual(face.positions[0], [27, 23]);
});

test('inherits PSD group visibility through the node hierarchy', () => {
  const model = fixture();
  model.nodes.push({
    id: 'hidden_group',
    name: 'Hidden PSD group',
    type: 'group',
    parentId: 'warp',
    visible: false,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
    bindings: {}
  });
  model.nodes.find((node) => node.id === 'face').parentId = 'hidden_group';
  const face = Core.createEvaluator(model).evaluate({ Turn: 0, Open: 1 })
    .parts.find((part) => part.id === 'face');
  assert.equal(face.visible, false);
});

test('steps generic physics from an arbitrary input parameter to an output parameter', () => {
  const model = fixture();
  model.parameters.push({ id: 'Swing', name: 'Swing', min: -1, max: 1, default: 0 });
  model.physics = [{
    id: 'physics_swing',
    name: 'Swing spring',
    enabled: true,
    inputs: [{ parameterId: 'Turn', weight: 1, center: 0 }],
    outputs: [{ parameterId: 'Swing', scale: 1, offset: 0 }],
    settings: { stiffness: 20, damping: 4, mass: 1 }
  }];
  const runtime = Core.createPhysicsRuntime(model);
  let output = {};
  for (let index = 0; index < 20; index++) output = runtime.step({ Turn: 1 }, 1 / 60);
  assert.ok(output.Swing > 0);
  assert.ok(output.Swing <= 1);
  runtime.reset();
  assert.deepEqual(runtime.getStates().physics_swing, { value: 0, velocity: 0 });
});

test('rejects hierarchy cycles and missing mask references', () => {
  const model = fixture();
  model.nodes[0].parentId = 'warp';
  model.nodes[3].maskIds = ['missing'];
  const validation = Core.validateModel(model);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes('cycle')));
  assert.ok(validation.errors.some((error) => error.includes('invalid mask')));
});

test('rejects malformed warp keys and physics feedback loops', () => {
  const model = fixture();
  model.nodes.find((node) => node.id === 'warp')
    .bindings.Turn.keyforms[0].state.warpOffsets = [0, 0];
  model.physics = [{
    id: 'loop',
    inputs: [{ parameterId: 'Turn', weight: 1 }],
    outputs: [{ parameterId: 'Turn', scale: 1 }],
    settings: { stiffness: 20, damping: 4, mass: 1 }
  }];
  const validation = Core.validateModel(model);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes('warp key offset count mismatch')));
  assert.ok(validation.errors.some((error) => error.includes('feedback')));
});

test('merges a PSD reimport by stable ids while preserving authored rig data', () => {
  const current = fixture();
  const imported = fixture();
  const currentFace = current.nodes.find((node) => node.id === 'face');
  const importedFace = imported.nodes.find((node) => node.id === 'face');
  currentFace.source = {
    kind: 'psd-layer',
    size: { width: 20, height: 20 },
    baseTransform: { x: 10, y: 20, scaleX: 1, scaleY: 1, opacity: 1 }
  };
  importedFace.source = {
    kind: 'psd-layer',
    size: { width: 40, height: 40 },
    baseTransform: { x: 20, y: 30, scaleX: 1, scaleY: 1, opacity: 1 }
  };
  currentFace.transform.x = 13;
  currentFace.mesh.vertices[0] = [2, 3];
  importedFace.transform.x = 20;
  importedFace.transform.y = 30;
  importedFace.mesh = Core.createRectMesh(40, 40, 1, 1);
  importedFace.parentId = 'root';
  imported.textures.find((texture) => texture.id === 'tex_face').src = 'fresh-texture';

  const { model, report } = Core.mergeReimportedModel(current, imported);
  const mergedFace = model.nodes.find((node) => node.id === 'face');
  assert.equal(report.matched, 4);
  assert.equal(mergedFace.transform.x, 23);
  assert.equal(mergedFace.parentId, 'root');
  assert.deepEqual(mergedFace.mesh.vertices[0], [4, 6]);
  assert.deepEqual(mergedFace.bindings, currentFace.bindings);
  assert.equal(model.textures.find((texture) => texture.id === 'tex_face').src, 'fresh-texture');
  assert.equal(Core.validateModel(model).ok, true);
});

test('redistributes preserved skin weights when a reimport changes mesh density', () => {
  const current = fixture();
  const imported = fixture();
  const currentFace = current.nodes.find((node) => node.id === 'face');
  const importedFace = imported.nodes.find((node) => node.id === 'face');
  currentFace.source = {
    kind: 'psd-layer',
    size: { width: 20, height: 20 },
    baseTransform: currentFace.transform
  };
  importedFace.source = {
    kind: 'psd-layer',
    size: { width: 20, height: 20 },
    baseTransform: importedFace.transform
  };
  importedFace.mesh = Core.createRectMesh(20, 20, 2, 3);
  current.skins = [{
    id: 'skin',
    name: 'Skin',
    partId: 'face',
    bones: [
      { id: 'root_bone', pivotX: 10, pivotY: 5, parameterId: 'Turn', angleScale: 5 },
      {
        id: 'tip_bone',
        parentId: 'root_bone',
        pivotX: 10,
        pivotY: 15,
        parameterId: 'Turn',
        angleScale: 10
      }
    ],
    weights: currentFace.mesh.vertices.map(() => [{ boneId: 'root_bone', weight: 1 }])
  }];
  const merged = Core.mergeReimportedModel(current, imported);
  assert.equal(merged.report.remappedSkins, 1);
  assert.equal(
    merged.model.skins[0].weights.length,
    importedFace.mesh.vertices.length
  );
  assert.ok(merged.model.skins[0].weights.some((weights) => weights.length === 2));
  assert.equal(Core.validateModel(merged.model).ok, true);
});

test('combines multiple physics inputs and emits multiple outputs', () => {
  const model = fixture();
  model.parameters.push(
    { id: 'Swing', name: 'Swing', min: -2, max: 2, default: 0 },
    { id: 'Bounce', name: 'Bounce', min: -2, max: 2, default: 0 }
  );
  model.physics = [{
    id: 'multi',
    inputs: [
      { parameterId: 'Turn', center: 0, weight: 1 },
      { parameterId: 'Open', center: 1, weight: -0.5 }
    ],
    outputs: [
      { parameterId: 'Swing', scale: 1, offset: 0 },
      { parameterId: 'Bounce', scale: -0.5, offset: 0.1 }
    ],
    settings: { stiffness: 30, damping: 5, mass: 1 }
  }];
  const runtime = Core.createPhysicsRuntime(model);
  let output;
  for (let index = 0; index < 40; index++) {
    output = runtime.step({ Turn: 1, Open: 0 }, 1 / 60);
  }
  assert.ok(output.Swing > 0);
  assert.ok(output.Bounce < 0.1);
  assert.equal(Object.keys(output).length, 2);
});

test('evaluates physics at a fixed 60 Hz independent of render frame rate', () => {
  const outputs = [25, 30, 60, 120].map((fps) => {
    const model = fixture();
    model.physicsFps = 60;
    model.parameters.push({ id: 'Swing', name: 'Swing', min: -2, max: 2, default: 0 });
    model.physics = [{
      id: 'fixed',
      inputs: [{ parameterId: 'Turn', center: 0, weight: 1 }],
      outputs: [{ parameterId: 'Swing', scale: 1, offset: 0 }],
      settings: { stiffness: 20, damping: 4, mass: 1 }
    }];
    const runtime = Core.createPhysicsRuntime(model);
    let output;
    for (let index = 0; index < fps * 2; index++) {
      output = runtime.step({ Turn: 1 }, 1 / fps);
    }
    assert.equal(runtime.getDiagnostics().totalSteps, 120);
    assert.equal(runtime.getDiagnostics().fixedFps, 60);
    return output.Swing;
  });
  assert.ok(Math.max(...outputs) - Math.min(...outputs) < 1e-12);
});

test('glues two evaluated mesh vertices with compatibility and directional weight', () => {
  const model = fixture();
  model.nodes.find((node) => node.id === 'face').transform.x = 30;
  model.glues = [{
    id: 'seam',
    name: 'Seam',
    partAId: 'mask',
    partBId: 'face',
    compatibility: 1,
    bindings: [{ vertexA: 0, vertexB: 0, weight: 0.5 }]
  }];
  const result = Core.createEvaluator(model).evaluate({ Turn: 0, Open: 1 });
  const maskPoint = result.parts.find((part) => part.id === 'mask').positions[0];
  const facePoint = result.parts.find((part) => part.id === 'face').positions[0];
  assert.deepEqual(maskPoint, [20, 20]);
  assert.deepEqual(facePoint, [20, 20]);
});

test('skins a mesh vertex through a parameter-driven rotation bone', () => {
  const model = fixture();
  model.parameters.push({ id: 'SkinAngle', name: 'Skin angle', min: -1, max: 1, default: 0 });
  const face = model.nodes.find((node) => node.id === 'face');
  model.skins = [{
    id: 'face_skin',
    name: 'Face skin',
    partId: 'face',
    bones: [{
      id: 'root_bone',
      name: 'Root bone',
      parentId: null,
      pivotX: 0,
      pivotY: 0,
      parameterId: 'SkinAngle',
      angleScale: 90,
      angleOffset: 0
    }],
    weights: face.mesh.vertices.map((_, index) =>
      index === 2 ? [{ boneId: 'root_bone', weight: 1 }] : []
    )
  }];
  const neutral = Core.createEvaluator(model).evaluate({ Turn: 0, Open: 1, SkinAngle: 0 })
    .parts.find((part) => part.id === 'face');
  const turned = Core.createEvaluator(model).evaluate({ Turn: 0, Open: 1, SkinAngle: 1 })
    .parts.find((part) => part.id === 'face');
  assert.deepEqual(neutral.positions[2], [10, 40]);
  assert.ok(Math.abs(turned.positions[2][0] + 10) < 1e-9);
  assert.ok(Math.abs(turned.positions[2][1] - 20) < 1e-9);
});

test('generates continuous two-bone blends along a skinning chain', () => {
  const vertices = [[0, 0], [0, 25], [0, 35], [0, 50], [0, 65], [0, 100]];
  const bones = [
    { id: 'root', pivotY: 20 },
    { id: 'mid', pivotY: 50 },
    { id: 'tip', pivotY: 80 }
  ];
  const weights = Core.generateSmoothChainWeights(vertices, bones, { fadeStartY: 5 });
  assert.deepEqual(weights[0], []);
  assert.equal(weights[2].length, 2);
  assert.equal(weights[2][0].boneId, 'root');
  assert.equal(weights[2][1].boneId, 'mid');
  assert.ok(Math.abs(weights[2].reduce((sum, entry) => sum + entry.weight, 0) - 1) < 1e-12);
  assert.equal(weights[5][0].boneId, 'tip');
});

test('idle motion produces smooth bounded automatic blinks and phased motion', () => {
  const runtime = Core.createIdleMotionRuntime(0xabc2d);
  let minimumEye = 1;
  let maximumEyeDelta = 0;
  let previousEye = 1;
  let sample;
  const tracked = [
    'AngleX',
    'AngleY',
    'AngleZ',
    'BodyAngleX',
    'BodyAngleY',
    'BodyAngleZ',
    'ShoulderMotion',
    'HipShift',
    'Breath'
  ];
  const ranges = Object.fromEntries(tracked.map((id) => [id, [Infinity, -Infinity]]));
  for (let index = 0; index < 600; index++) {
    sample = runtime.step(1 / 60, 1);
    minimumEye = Math.min(minimumEye, sample.EyeOpenL, sample.EyeOpenR);
    maximumEyeDelta = Math.max(maximumEyeDelta, Math.abs(sample.EyeOpenL - previousEye));
    previousEye = sample.EyeOpenL;
    tracked.forEach((id) => {
      ranges[id][0] = Math.min(ranges[id][0], sample[id]);
      ranges[id][1] = Math.max(ranges[id][1], sample[id]);
    });
    assert.ok(sample.EyeOpenL >= 0 && sample.EyeOpenL <= 1);
    assert.ok(sample.EyeOpenR >= 0 && sample.EyeOpenR <= 1);
    assert.ok(sample.Breath >= 0 && sample.Breath <= 1);
  }
  assert.ok(runtime.getDiagnostics().blinkCount >= 1);
  assert.ok(minimumEye < 0.02);
  assert.ok(maximumEyeDelta < 0.4);
  assert.notEqual(sample.AngleX, sample.AngleZ);
  assert.ok(ranges.BodyAngleX[1] - ranges.BodyAngleX[0] > 0.2);
  assert.ok(ranges.BodyAngleY[1] - ranges.BodyAngleY[0] > 0.08);
  assert.ok(ranges.BodyAngleZ[1] - ranges.BodyAngleZ[0] > 0.15);
  assert.ok(ranges.ShoulderMotion[1] - ranges.ShoulderMotion[0] > 0.45);
  assert.ok(ranges.HipShift[1] - ranges.HipShift[0] > 0.1);
  assert.ok(ranges.Breath[1] - ranges.Breath[0] > 0.9);
});

test('packs a deterministic non-overlapping texture atlas within bounds', () => {
  const textures = [
    { id: 'a', width: 80, height: 40 },
    { id: 'b', width: 50, height: 90 },
    { id: 'c', width: 30, height: 30 }
  ];
  const first = Core.packTextureRects(textures, { width: 256, height: 256, padding: 4 });
  const second = Core.packTextureRects(textures.slice().reverse(), {
    width: 256,
    height: 256,
    padding: 4
  });
  assert.equal(first.ok, true);
  assert.deepEqual(first, second);
  first.entries.forEach((entry, index) => {
    assert.ok(entry.x >= 0 && entry.y >= 0);
    assert.ok(entry.x + entry.width <= first.width);
    assert.ok(entry.y + entry.height <= first.height);
    first.entries.slice(index + 1).forEach((other) => {
      const overlaps = entry.x < other.x + other.width &&
        entry.x + entry.width > other.x &&
        entry.y < other.y + other.height &&
        entry.y + entry.height > other.y;
      assert.equal(overlaps, false);
    });
  });
});

test('round-trips glue, skinning, and texture atlas authoring data', () => {
  const model = fixture();
  const face = model.nodes.find((node) => node.id === 'face');
  model.glues = [{
    id: 'seam',
    name: 'Seam',
    partAId: 'mask',
    partBId: 'face',
    compatibility: 0.8,
    bindings: [{ vertexA: 0, vertexB: 0, weight: 0.4 }]
  }];
  model.skins = [{
    id: 'skin',
    name: 'Skin',
    partId: 'face',
    bones: [{
      id: 'bone',
      name: 'Bone',
      parentId: null,
      pivotX: 10,
      pivotY: 10,
      parameterId: 'Turn',
      angleScale: 12,
      angleOffset: 0
    }],
    weights: face.mesh.vertices.map(() => [{ boneId: 'bone', weight: 0.75 }])
  }];
  model.textures.push({
    id: 'tex_atlas',
    src: 'data:image/png;base64,AA==',
    width: 128,
    height: 128
  });
  model.textureAtlases = [{
    id: 'atlas',
    textureId: 'tex_atlas',
    width: 128,
    height: 128,
    padding: 2,
    entries: [
      { sourceTextureId: 'tex_mask', x: 2, y: 2, width: 20, height: 20 },
      { sourceTextureId: 'tex_face', x: 24, y: 2, width: 20, height: 20 }
    ]
  }];
  model.atlasSettings = { size: 128, padding: 2 };
  assert.deepEqual(Core.importModel(Core.exportModel(model)), model);
});

test('rejects invalid glue, skin, and atlas references', () => {
  const model = fixture();
  model.glues = [{
    id: 'bad_glue',
    partAId: 'face',
    partBId: 'missing',
    compatibility: 2,
    bindings: [{ vertexA: 999, vertexB: 0, weight: -1 }]
  }];
  model.skins = [{
    id: 'bad_skin',
    partId: 'missing',
    bones: [{ id: 'bone', parentId: 'missing_bone', parameterId: 'missing' }],
    weights: []
  }];
  model.textureAtlases = [{
    id: 'bad_atlas',
    textureId: 'missing',
    width: 10,
    height: 10,
    entries: [{ sourceTextureId: 'x', x: 9, y: 9, width: 5, height: 5 }]
  }];
  const validation = Core.validateModel(model);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes('invalid glue part B')));
  assert.ok(validation.errors.some((error) => error.includes('invalid skin part')));
  assert.ok(validation.errors.some((error) => error.includes('missing atlas texture')));
});

test('fades expression values without replacing the active blink waveform', () => {
  const runtime = Core.createPerformanceRuntime({
    neutral: { eyeScaleL: 1, eyeScaleR: 1, mouthForm: 0 },
    smile: { eyeScaleL: 0.8, eyeScaleR: 0.8, mouthForm: 0.7 }
  }, 123);
  runtime.setExpression('smile', 0.5);
  let frame;
  for (let index = 0; index < 30; index += 1) frame = runtime.step(1 / 60, 1);
  assert.ok(Math.abs(frame.expression.eyeScaleL - 0.8) < 0.001);
  assert.ok(Math.abs(frame.expression.mouthForm - 0.7) < 0.001);
  assert.equal(Object.hasOwn(frame.expression, 'eyeOpenL'), false);
});

test('produces bounded syllabic mouth motion and settles after speech', () => {
  const runtime = Core.createPerformanceRuntime({
    neutral: { mouthOpen: 0.04 }
  }, 456);
  runtime.setTalk(true);
  let peak = 0;
  let formRange = [Infinity, -Infinity];
  let gazeRange = [Infinity, -Infinity];
  for (let index = 0; index < 120; index += 1) {
    const frame = runtime.step(1 / 60, 1);
    peak = Math.max(peak, frame.talkMouth);
    formRange = [
      Math.min(formRange[0], frame.talkMouthForm),
      Math.max(formRange[1], frame.talkMouthForm)
    ];
    gazeRange = [
      Math.min(gazeRange[0], frame.talkGazeX),
      Math.max(gazeRange[1], frame.talkGazeX)
    ];
  }
  assert.ok(peak > 0.6);
  assert.ok(peak <= 0.75);
  assert.ok(formRange[0] >= -1 && formRange[1] <= 1);
  assert.ok(formRange[1] - formRange[0] > 0.05);
  assert.ok(Math.max(Math.abs(formRange[0]), Math.abs(formRange[1])) <= 0.1);
  assert.ok(gazeRange[0] >= -1 && gazeRange[1] <= 1);
  assert.ok(gazeRange[1] - gazeRange[0] > 0.08);
  runtime.setTalk(false);
  let frame;
  for (let index = 0; index < 60; index += 1) frame = runtime.step(1 / 60, 1);
  assert.ok(frame.talkMouth < 0.001);
  assert.ok(Math.abs(frame.talkMouthForm) < 0.001);
  assert.ok(Math.abs(frame.talkGazeX) < 0.01);
});

test('plays a gesture once and returns to a neutral offset', () => {
  const runtime = Core.createPerformanceRuntime({
    neutral: { mouthOpen: 0 }
  }, 789);
  runtime.triggerGesture('nod');
  let peak = 0;
  let frame;
  for (let index = 0; index < 70; index += 1) {
    frame = runtime.step(1 / 60, 1);
    peak = Math.max(peak, Math.abs(frame.offsets.AngleY));
  }
  assert.ok(peak > 0.15);
  assert.equal(runtime.getDiagnostics().gesture, null);
  assert.ok(Math.abs(frame.offsets.AngleY) < 0.001);
});

test('drives a full-body invite gesture including post-physics appendages', () => {
  const runtime = Core.createPerformanceRuntime({
    neutral: { mouthOpen: 0 }
  }, 987);
  runtime.triggerGesture('invite');
  const peaks = {
    AngleZ: 0,
    BodyAngleZ: 0,
    HipShift: 0,
    WingSwing: 0,
    WingFlap: 0,
    TailSwing: 0,
    TailCurl: 0,
    CloakSwing: 0,
    ArmSwing: 0
  };
  for (let index = 0; index < 130; index += 1) {
    const frame = runtime.step(1 / 60, 1);
    Object.keys(peaks).forEach((key) => {
      peaks[key] = Math.max(peaks[key], Math.abs(frame.offsets[key]));
    });
  }
  assert.ok(peaks.AngleZ > 0.3);
  assert.ok(peaks.BodyAngleZ > 0.18);
  assert.ok(peaks.HipShift > 0.1);
  assert.ok(peaks.WingSwing > 0.2);
  assert.ok(peaks.WingFlap > 0.18);
  assert.ok(peaks.TailSwing > 0.18);
  assert.ok(peaks.TailCurl > 0.2);
  assert.ok(peaks.CloakSwing > 0.14);
  assert.ok(peaks.ArmSwing > 0.09);
  assert.equal(runtime.getDiagnostics().gesture, null);
});
