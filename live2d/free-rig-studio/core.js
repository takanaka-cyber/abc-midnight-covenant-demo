/*!
 * Free Rig Studio core
 * Data-driven 2D rig evaluation primitives inspired by the public Cubism model.
 * No Live2D proprietary file parsing or runtime code is included.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.FreeRigCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1;
  var TRANSFORM_KEYS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity', 'drawOrder'];

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function identityTransform(source) {
    source = source || {};
    return {
      x: Number(source.x || 0),
      y: Number(source.y || 0),
      pivotX: Number(source.pivotX || 0),
      pivotY: Number(source.pivotY || 0),
      rotation: Number(source.rotation || 0),
      scaleX: source.scaleX == null ? 1 : Number(source.scaleX),
      scaleY: source.scaleY == null ? 1 : Number(source.scaleY),
      opacity: source.opacity == null ? 1 : Number(source.opacity),
      drawOrder: Number(source.drawOrder || 0)
    };
  }

  function matrixFromTransform(transform) {
    var radians = transform.rotation * Math.PI / 180;
    var cosine = Math.cos(radians);
    var sine = Math.sin(radians);
    var a = cosine * transform.scaleX;
    var b = sine * transform.scaleX;
    var c = -sine * transform.scaleY;
    var d = cosine * transform.scaleY;
    return [
      a,
      b,
      c,
      d,
      transform.x + transform.pivotX - a * transform.pivotX - c * transform.pivotY,
      transform.y + transform.pivotY - b * transform.pivotX - d * transform.pivotY
    ];
  }

  function transformPoint(matrix, point) {
    return {
      x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
      y: matrix[1] * point.x + matrix[3] * point.y + matrix[5]
    };
  }

  function invertMatrix(matrix) {
    var determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
    if (Math.abs(determinant) < 1e-12) throw new Error('matrix is not invertible');
    var inverseDeterminant = 1 / determinant;
    var a = matrix[3] * inverseDeterminant;
    var b = -matrix[1] * inverseDeterminant;
    var c = -matrix[2] * inverseDeterminant;
    var d = matrix[0] * inverseDeterminant;
    return [
      a,
      b,
      c,
      d,
      -(a * matrix[4] + c * matrix[5]),
      -(b * matrix[4] + d * matrix[5])
    ];
  }

  function createRectMesh(width, height, columns, rows) {
    columns = Math.max(1, columns | 0);
    rows = Math.max(1, rows | 0);
    var vertices = [];
    var uvs = [];
    var triangles = [];
    var x;
    var y;
    for (y = 0; y <= rows; y++) {
      for (x = 0; x <= columns; x++) {
        vertices.push([width * x / columns, height * y / rows]);
        uvs.push([x / columns, y / rows]);
      }
    }
    for (y = 0; y < rows; y++) {
      for (x = 0; x < columns; x++) {
        var a = y * (columns + 1) + x;
        var b = a + 1;
        var c = a + columns + 1;
        var d = c + 1;
        triangles.push([a, b, c], [b, d, c]);
      }
    }
    return { vertices: vertices, uvs: uvs, triangles: triangles };
  }

  function createZeroOffsets(count) {
    var result = new Array(count * 2);
    for (var index = 0; index < result.length; index++) result[index] = 0;
    return result;
  }

  function normalizedOffsets(source, length) {
    var result = new Array(length);
    source = source || [];
    for (var index = 0; index < length; index++) result[index] = Number(source[index] || 0);
    return result;
  }

  function interpolateArray(a, b, t, length) {
    var result = new Array(length);
    for (var index = 0; index < length; index++) {
      result[index] = lerp(Number(a[index] || 0), Number(b[index] || 0), t);
    }
    return result;
  }

  function interpolateState(a, b, t) {
    a = a || {};
    b = b || {};
    var result = {};
    TRANSFORM_KEYS.forEach(function (key) {
      if (a[key] != null || b[key] != null) {
        var av = a[key] == null ? b[key] : a[key];
        var bv = b[key] == null ? a[key] : b[key];
        result[key] = lerp(Number(av), Number(bv), t);
      }
    });
    ['warpOffsets', 'meshOffsets'].forEach(function (key) {
      if (a[key] || b[key]) {
        var length = Math.max((a[key] || []).length, (b[key] || []).length);
        result[key] = interpolateArray(a[key] || [], b[key] || [], t, length);
      }
    });
    return result;
  }

  function sampleKeyforms(keyforms, value, interpolation) {
    if (!keyforms || !keyforms.length) return {};
    var sorted = keyforms.slice().sort(function (left, right) {
      return left.value - right.value;
    });
    if (value <= sorted[0].value) return deepClone(sorted[0].state || {});
    if (value >= sorted[sorted.length - 1].value) {
      return deepClone(sorted[sorted.length - 1].state || {});
    }
    for (var index = 0; index < sorted.length - 1; index++) {
      var left = sorted[index];
      var right = sorted[index + 1];
      if (value < left.value || value > right.value) continue;
      var span = right.value - left.value;
      var t = span === 0 ? 0 : (value - left.value) / span;
      if (interpolation === 'smooth') t = smoothstep(t);
      return interpolateState(left.state, right.state, t);
    }
    return {};
  }

  function addStateDelta(target, current, neutral, key, length) {
    var currentValues = current[key] || [];
    var neutralValues = neutral[key] || [];
    if (!target[key]) target[key] = createZeroOffsets(length / 2);
    for (var index = 0; index < length; index++) {
      target[key][index] += Number(currentValues[index] || 0) - Number(neutralValues[index] || 0);
    }
  }

  function evaluateNodeState(node, parametersById, values) {
    var state = identityTransform(node.transform);
    state.warpOffsets = node.type === 'warp'
      ? normalizedOffsets(
        node.warp.baseOffsets,
        (node.warp.columns + 1) * (node.warp.rows + 1) * 2
      )
      : [];
    state.meshOffsets = node.type === 'part'
      ? createZeroOffsets(node.mesh.vertices.length)
      : [];

    var bindings = node.bindings || {};
    Object.keys(bindings).forEach(function (parameterId) {
      var parameter = parametersById[parameterId];
      if (!parameter) return;
      var binding = bindings[parameterId];
      var value = values[parameterId] == null ? parameter.default : values[parameterId];
      value = clamp(Number(value), parameter.min, parameter.max);
      var current = sampleKeyforms(binding.keyforms, value, binding.interpolation);
      var neutral = sampleKeyforms(binding.keyforms, parameter.default, binding.interpolation);

      TRANSFORM_KEYS.forEach(function (key) {
        if (current[key] != null || neutral[key] != null) {
          state[key] += Number(current[key] || 0) - Number(neutral[key] || 0);
        }
      });
      if (node.type === 'warp') {
        addStateDelta(state, current, neutral, 'warpOffsets', state.warpOffsets.length);
      }
      if (node.type === 'part') {
        addStateDelta(state, current, neutral, 'meshOffsets', state.meshOffsets.length);
      }
    });

    state.opacity = clamp(state.opacity, 0, 1);
    return state;
  }

  function bilerp(a, b, c, d, tx, ty) {
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }

  function applyWarp(point, node, state) {
    var warp = node.warp;
    var columns = warp.columns;
    var rows = warp.rows;
    var unitX = warp.width / columns;
    var unitY = warp.height / rows;
    var localX = clamp((point.x - warp.x) / warp.width, 0, 1) * columns;
    var localY = clamp((point.y - warp.y) / warp.height, 0, 1) * rows;
    var cellX = Math.min(columns - 1, Math.floor(localX));
    var cellY = Math.min(rows - 1, Math.floor(localY));
    var tx = localX - cellX;
    var ty = localY - cellY;
    var stride = columns + 1;
    var i00 = (cellY * stride + cellX) * 2;
    var i10 = i00 + 2;
    var i01 = i00 + stride * 2;
    var i11 = i01 + 2;
    var offsets = state.warpOffsets;
    var dx = bilerp(offsets[i00], offsets[i10], offsets[i01], offsets[i11], tx, ty);
    var dy = bilerp(offsets[i00 + 1], offsets[i10 + 1], offsets[i01 + 1], offsets[i11 + 1], tx, ty);

    // Keep points outside the deformer stable instead of clamping them to an edge.
    var outsideX = point.x < warp.x ? point.x - warp.x
      : point.x > warp.x + warp.width ? point.x - (warp.x + warp.width) : 0;
    var outsideY = point.y < warp.y ? point.y - warp.y
      : point.y > warp.y + warp.height ? point.y - (warp.y + warp.height) : 0;
    return { x: point.x + dx + outsideX * 0, y: point.y + dy + outsideY * 0 };
  }

  function validateModel(model) {
    var errors = [];
    if (!model || typeof model !== 'object') return { ok: false, errors: ['model is required'] };
    if (model.version !== VERSION) errors.push('unsupported model version: ' + model.version);
    if (!model.canvas || !(model.canvas.width > 0) || !(model.canvas.height > 0)) {
      errors.push('canvas width and height must be positive');
    }

    var parametersById = {};
    (model.parameters || []).forEach(function (parameter) {
      if (!parameter.id) errors.push('parameter id is required');
      else if (parametersById[parameter.id]) errors.push('duplicate parameter id: ' + parameter.id);
      else parametersById[parameter.id] = parameter;
      if (!(parameter.min <= parameter.default && parameter.default <= parameter.max)) {
        errors.push('parameter default is outside range: ' + parameter.id);
      }
    });

    var texturesById = {};
    (model.textures || []).forEach(function (texture) {
      if (!texture.id) errors.push('texture id is required');
      else if (texturesById[texture.id]) errors.push('duplicate texture id: ' + texture.id);
      else texturesById[texture.id] = texture;
    });

    var nodesById = {};
    (model.nodes || []).forEach(function (node) {
      if (!node.id) errors.push('node id is required');
      else if (nodesById[node.id]) errors.push('duplicate node id: ' + node.id);
      else nodesById[node.id] = node;
      if (['group', 'rotation', 'warp', 'part'].indexOf(node.type) < 0) {
        errors.push('unsupported node type: ' + node.type);
      }
    });

    Object.keys(nodesById).forEach(function (id) {
      var node = nodesById[id];
      if (node.parentId && !nodesById[node.parentId]) errors.push('missing parent: ' + node.parentId);
      Object.keys(node.bindings || {}).forEach(function (parameterId) {
        if (!parametersById[parameterId]) errors.push('unknown binding parameter: ' + parameterId);
        var binding = node.bindings[parameterId];
        if (!binding || !Array.isArray(binding.keyforms)) {
          errors.push('binding keyforms are required: ' + id + ' / ' + parameterId);
          return;
        }
        binding.keyforms.forEach(function (keyform) {
          if (!Number.isFinite(Number(keyform.value))) {
            errors.push('keyform value must be finite: ' + id + ' / ' + parameterId);
          }
          var state = keyform.state || {};
          ['warpOffsets', 'meshOffsets'].forEach(function (key) {
            if (state[key] && state[key].some(function (value) {
              return !Number.isFinite(Number(value));
            })) {
              errors.push('keyform offsets must be finite: ' + id + ' / ' + parameterId);
            }
          });
        });
      });
      if (node.type === 'part') {
        if (!node.mesh || !node.mesh.vertices || !node.mesh.uvs || !node.mesh.triangles) {
          errors.push('part mesh is incomplete: ' + id);
        } else {
          if (node.mesh.vertices.length !== node.mesh.uvs.length) {
            errors.push('vertex/uv count mismatch: ' + id);
          }
          node.mesh.triangles.forEach(function (triangle) {
            triangle.forEach(function (vertexIndex) {
              if (vertexIndex < 0 || vertexIndex >= node.mesh.vertices.length) {
                errors.push('triangle index out of range: ' + id);
              }
            });
          });
        }
        if (!texturesById[node.textureId]) errors.push('missing texture: ' + node.textureId);
        (node.maskIds || []).forEach(function (maskId) {
          if (!nodesById[maskId] || nodesById[maskId].type !== 'part') {
            errors.push('invalid mask part: ' + maskId);
          }
        });
      }
      if (node.type === 'warp') {
        if (!node.warp || !(node.warp.columns > 0) || !(node.warp.rows > 0) ||
            !(node.warp.width > 0) || !(node.warp.height > 0)) {
          errors.push('warp definition is incomplete: ' + id);
        } else {
          var warpLength = (node.warp.columns + 1) * (node.warp.rows + 1) * 2;
          if (node.warp.baseOffsets && node.warp.baseOffsets.length !== warpLength) {
            errors.push('warp base offset count mismatch: ' + id);
          }
          Object.keys(node.bindings || {}).forEach(function (parameterId) {
            node.bindings[parameterId].keyforms.forEach(function (keyform) {
              if (keyform.state && keyform.state.warpOffsets &&
                  keyform.state.warpOffsets.length !== warpLength) {
                errors.push('warp key offset count mismatch: ' + id + ' / ' + parameterId);
              }
            });
          });
        }
      }
    });

    var physicsById = {};
    (model.physics || []).forEach(function (group) {
      if (!group.id) errors.push('physics group id is required');
      else if (physicsById[group.id]) errors.push('duplicate physics group id: ' + group.id);
      else physicsById[group.id] = group;
      if (!group.inputs || !group.inputs.length) errors.push('physics input is required: ' + group.id);
      if (!group.outputs || !group.outputs.length) errors.push('physics output is required: ' + group.id);
      (group.inputs || []).forEach(function (input) {
        if (!parametersById[input.parameterId]) {
          errors.push('unknown physics input parameter: ' + input.parameterId);
        }
        if (input.weight != null && !Number.isFinite(Number(input.weight))) {
          errors.push('physics input weight must be finite: ' + group.id);
        }
        if (input.center != null && !Number.isFinite(Number(input.center))) {
          errors.push('physics input center must be finite: ' + group.id);
        }
      });
      (group.outputs || []).forEach(function (output) {
        if (!parametersById[output.parameterId]) {
          errors.push('unknown physics output parameter: ' + output.parameterId);
        }
        if ((group.inputs || []).some(function (input) {
          return input.parameterId === output.parameterId;
        })) {
          errors.push('physics input/output feedback is unsupported: ' + group.id);
        }
        if (output.scale != null && !Number.isFinite(Number(output.scale))) {
          errors.push('physics output scale must be finite: ' + group.id);
        }
        if (output.offset != null && !Number.isFinite(Number(output.offset))) {
          errors.push('physics output offset must be finite: ' + group.id);
        }
      });
      var settings = group.settings || {};
      if (!(Number(settings.stiffness) > 0)) errors.push('physics stiffness must be positive: ' + group.id);
      if (!(Number(settings.damping) >= 0)) errors.push('physics damping must be non-negative: ' + group.id);
      if (!(settings.mass == null || Number(settings.mass) > 0)) {
        errors.push('physics mass must be positive: ' + group.id);
      }
    });

    Object.keys(nodesById).forEach(function (id) {
      var seen = {};
      var current = nodesById[id];
      while (current) {
        if (seen[current.id]) {
          errors.push('node hierarchy cycle at: ' + current.id);
          break;
        }
        seen[current.id] = true;
        current = current.parentId ? nodesById[current.parentId] : null;
      }
    });

    return { ok: errors.length === 0, errors: errors };
  }

  function createEvaluator(model) {
    var validation = validateModel(model);
    if (!validation.ok) throw new Error(validation.errors.join('\n'));
    var parametersById = {};
    var nodesById = {};
    model.parameters.forEach(function (parameter) { parametersById[parameter.id] = parameter; });
    model.nodes.forEach(function (node) { nodesById[node.id] = node; });

    function evaluate(values) {
      values = values || {};
      var statesById = {};
      model.nodes.forEach(function (node) {
        statesById[node.id] = evaluateNodeState(node, parametersById, values);
      });

      function evaluatePart(part) {
        var state = statesById[part.id];
        var positions = [];
        for (var index = 0; index < part.mesh.vertices.length; index++) {
          var base = part.mesh.vertices[index];
          var point = {
            x: base[0] + state.meshOffsets[index * 2],
            y: base[1] + state.meshOffsets[index * 2 + 1]
          };
          point = transformPoint(matrixFromTransform(state), point);
          var opacity = state.opacity;
          var visible = part.visible !== false;
          var parent = part.parentId ? nodesById[part.parentId] : null;
          while (parent) {
            var parentState = statesById[parent.id];
            if (parent.type === 'warp') point = applyWarp(point, parent, parentState);
            point = transformPoint(matrixFromTransform(parentState), point);
            opacity *= parentState.opacity;
            visible = visible && parent.visible !== false;
            parent = parent.parentId ? nodesById[parent.parentId] : null;
          }
          positions.push([point.x, point.y]);
          state.worldOpacity = clamp(opacity, 0, 1);
        }
        return {
          id: part.id,
          name: part.name,
          positions: positions,
          uvs: part.mesh.uvs,
          triangles: part.mesh.triangles,
          textureId: part.textureId,
          maskIds: (part.maskIds || []).slice(),
          opacity: state.worldOpacity == null ? state.opacity : state.worldOpacity,
          drawOrder: state.drawOrder,
          visible: visible
        };
      }

      var parts = model.nodes.filter(function (node) {
        return node.type === 'part';
      }).map(evaluatePart);
      parts.sort(function (left, right) {
        return left.drawOrder - right.drawOrder;
      });
      return { statesById: statesById, parts: parts };
    }

    return {
      model: model,
      parametersById: parametersById,
      nodesById: nodesById,
      evaluate: evaluate
    };
  }

  function exportModel(model) {
    var validation = validateModel(model);
    if (!validation.ok) throw new Error(validation.errors.join('\n'));
    return JSON.stringify(model, null, 2);
  }

  function importModel(json) {
    var model = typeof json === 'string' ? JSON.parse(json) : deepClone(json);
    var validation = validateModel(model);
    if (!validation.ok) throw new Error(validation.errors.join('\n'));
    return model;
  }

  function createPhysicsRuntime(model) {
    var validation = validateModel(model);
    if (!validation.ok) throw new Error(validation.errors.join('\n'));
    var parametersById = {};
    var states = {};
    model.parameters.forEach(function (parameter) {
      parametersById[parameter.id] = parameter;
    });
    (model.physics || []).forEach(function (group) {
      states[group.id] = { value: 0, velocity: 0 };
    });

    function reset() {
      Object.keys(states).forEach(function (id) {
        states[id].value = 0;
        states[id].velocity = 0;
      });
    }

    function step(values, deltaTime) {
      var dt = clamp(Number(deltaTime) || 0, 0, 0.05);
      var contributions = {};
      (model.physics || []).forEach(function (group) {
        if (group.enabled === false) return;
        var settings = group.settings || {};
        var stiffness = Number(settings.stiffness);
        var damping = Number(settings.damping);
        var mass = settings.mass == null ? 1 : Number(settings.mass);
        var target = 0;
        group.inputs.forEach(function (input) {
          var parameter = parametersById[input.parameterId];
          var value = values[input.parameterId] == null
            ? parameter.default : Number(values[input.parameterId]);
          var center = input.center == null ? parameter.default : Number(input.center);
          var weight = input.weight == null ? 1 : Number(input.weight);
          target += (value - center) * weight;
        });
        var state = states[group.id];
        var acceleration = (stiffness * (target - state.value) - damping * state.velocity) / mass;
        state.velocity += acceleration * dt;
        state.value += state.velocity * dt;
        group.outputs.forEach(function (output) {
          var parameter = parametersById[output.parameterId];
          var scale = output.scale == null ? 1 : Number(output.scale);
          var offset = output.offset == null ? 0 : Number(output.offset);
          if (contributions[output.parameterId] == null) {
            contributions[output.parameterId] = parameter.default;
          }
          contributions[output.parameterId] += state.value * scale + offset;
        });
      });
      Object.keys(contributions).forEach(function (parameterId) {
        var parameter = parametersById[parameterId];
        contributions[parameterId] = clamp(
          contributions[parameterId],
          parameter.min,
          parameter.max
        );
      });
      return contributions;
    }

    return {
      step: step,
      reset: reset,
      getStates: function () { return deepClone(states); }
    };
  }

  return {
    VERSION: VERSION,
    clamp: clamp,
    lerp: lerp,
    smoothstep: smoothstep,
    identityTransform: identityTransform,
    matrixFromTransform: matrixFromTransform,
    invertMatrix: invertMatrix,
    transformPoint: transformPoint,
    createRectMesh: createRectMesh,
    createZeroOffsets: createZeroOffsets,
    normalizedOffsets: normalizedOffsets,
    sampleKeyforms: sampleKeyforms,
    applyWarp: applyWarp,
    validateModel: validateModel,
    createEvaluator: createEvaluator,
    createPhysicsRuntime: createPhysicsRuntime,
    exportModel: exportModel,
    importModel: importModel
  };
});
