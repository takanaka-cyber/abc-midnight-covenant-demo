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
