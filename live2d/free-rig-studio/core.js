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

  function multiplyMatrices(left, right) {
    return [
      left[0] * right[0] + left[2] * right[1],
      left[1] * right[0] + left[3] * right[1],
      left[0] * right[2] + left[2] * right[3],
      left[1] * right[2] + left[3] * right[3],
      left[0] * right[4] + left[2] * right[5] + left[4],
      left[1] * right[4] + left[3] * right[5] + left[5]
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

  function sourceBaseTransform(node) {
    return identityTransform(node && node.source && node.source.baseTransform
      ? node.source.baseTransform : node && node.transform);
  }

  function mergeTransformDelta(currentNode, importedNode) {
    var current = identityTransform(currentNode.transform);
    var currentBase = sourceBaseTransform(currentNode);
    var imported = identityTransform(importedNode.transform);
    var importedBase = sourceBaseTransform(importedNode);
    ['x', 'y', 'pivotX', 'pivotY', 'rotation', 'drawOrder'].forEach(function (key) {
      imported[key] = importedBase[key] + (current[key] - currentBase[key]);
    });
    ['scaleX', 'scaleY'].forEach(function (key) {
      imported[key] = currentBase[key] === 0
        ? importedBase[key] : importedBase[key] * current[key] / currentBase[key];
    });
    // PSD owns source opacity; authoring owns only the geometric delta.
    imported.opacity = importedBase.opacity;
    return imported;
  }

  function scalePreservedVertices(currentNode, importedNode) {
    if (!currentNode.mesh || !importedNode.mesh ||
        currentNode.mesh.vertices.length !== importedNode.mesh.vertices.length) {
      return importedNode.mesh;
    }
    var currentSize = currentNode.source && currentNode.source.size;
    var importedSize = importedNode.source && importedNode.source.size;
    var scaleX = currentSize && importedSize && currentSize.width
      ? importedSize.width / currentSize.width : 1;
    var scaleY = currentSize && importedSize && currentSize.height
      ? importedSize.height / currentSize.height : 1;
    var merged = deepClone(importedNode.mesh);
    merged.vertices = currentNode.mesh.vertices.map(function (vertex) {
      return [Number(vertex[0]) * scaleX, Number(vertex[1]) * scaleY];
    });
    return merged;
  }

  function filterRigReferences(nextModel) {
    var nodesById = {};
    var parametersById = {};
    nextModel.nodes.forEach(function (node) { nodesById[node.id] = node; });
    nextModel.parameters.forEach(function (parameter) { parametersById[parameter.id] = parameter; });
    nextModel.nodes.forEach(function (node) {
      if (node.parentId && !nodesById[node.parentId]) node.parentId = null;
      if (node.type === 'part') {
        node.maskIds = (node.maskIds || []).filter(function (id) {
          return nodesById[id] && nodesById[id].type === 'part';
        });
      }
      Object.keys(node.bindings || {}).forEach(function (parameterId) {
        if (!parametersById[parameterId]) delete node.bindings[parameterId];
      });
    });
    nextModel.physics = (nextModel.physics || []).filter(function (group) {
      group.inputs = (group.inputs || []).filter(function (input) {
        return Boolean(parametersById[input.parameterId]);
      });
      group.outputs = (group.outputs || []).filter(function (output) {
        return Boolean(parametersById[output.parameterId]);
      });
      return group.inputs.length && group.outputs.length;
    });
    nextModel.glues = (nextModel.glues || []).filter(function (glue) {
      var partA = nodesById[glue.partAId];
      var partB = nodesById[glue.partBId];
      if (!partA || !partB || partA.type !== 'part' || partB.type !== 'part') return false;
      glue.bindings = (glue.bindings || []).filter(function (entry) {
        return entry.vertexA >= 0 && entry.vertexA < partA.mesh.vertices.length &&
          entry.vertexB >= 0 && entry.vertexB < partB.mesh.vertices.length;
      });
      return glue.bindings.length > 0;
    });
    nextModel.skins = (nextModel.skins || []).filter(function (skin) {
      var part = nodesById[skin.partId];
      if (!part || part.type !== 'part') return false;
      skin.bones = (skin.bones || []).filter(function (bone) {
        return !bone.parameterId || parametersById[bone.parameterId];
      });
      var bonesById = {};
      skin.bones.forEach(function (bone) { bonesById[bone.id] = bone; });
      skin.bones.forEach(function (bone) {
        if (bone.parentId && !bonesById[bone.parentId]) bone.parentId = null;
      });
      skin.weights = (skin.weights || []).slice(0, part.mesh.vertices.length).map(function (weights) {
        return (weights || []).filter(function (weight) {
          return bonesById[weight.boneId];
        });
      });
      while (skin.weights.length < part.mesh.vertices.length) skin.weights.push([]);
      return skin.bones.length > 0;
    });
  }

  function mergeReimportedModel(currentModel, importedModel) {
    var current = deepClone(currentModel);
    var imported = deepClone(importedModel);
    var currentById = {};
    var importedIds = {};
    var matched = 0;
    var newNodes = 0;
    current.nodes.forEach(function (node) { currentById[node.id] = node; });

    var mergedNodes = imported.nodes.map(function (nextNode) {
      importedIds[nextNode.id] = true;
      var oldNode = currentById[nextNode.id];
      if (!oldNode || oldNode.type !== nextNode.type) {
        newNodes++;
        return nextNode;
      }
      matched++;
      if (!(nextNode.source && nextNode.source.kind)) return deepClone(oldNode);
      var merged = deepClone(nextNode);
      merged.transform = mergeTransformDelta(oldNode, nextNode);
      merged.bindings = deepClone(oldNode.bindings || {});
      if (merged.type === 'part') {
        merged.mesh = scalePreservedVertices(oldNode, nextNode);
        merged.maskIds = deepClone(oldNode.maskIds || []);
      }
      return merged;
    });

    current.nodes.forEach(function (node) {
      if (!importedIds[node.id] && !(node.source && node.source.kind)) {
        mergedNodes.push(deepClone(node));
      }
    });

    var parameterIds = {};
    var parameters = imported.parameters.map(function (parameter) {
      parameterIds[parameter.id] = true;
      var oldParameter = current.parameters.find(function (entry) {
        return entry.id === parameter.id;
      });
      return deepClone(oldParameter || parameter);
    });
    current.parameters.forEach(function (parameter) {
      if (!parameterIds[parameter.id]) parameters.push(deepClone(parameter));
    });

    imported.nodes.forEach(function (node) {
      if (node.source && node.source.kind && !node.source.baseTransform) {
        node.source.baseTransform = identityTransform(node.transform);
      }
    });
    mergedNodes.forEach(function (node) {
      if (node.source && node.source.kind) {
        var importedNode = imported.nodes.find(function (entry) { return entry.id === node.id; });
        node.source.baseTransform = identityTransform(
          importedNode && importedNode.source && importedNode.source.baseTransform
            ? importedNode.source.baseTransform : importedNode && importedNode.transform
        );
      }
    });

    var mergedById = {};
    mergedNodes.forEach(function (node) { mergedById[node.id] = node; });
    var remappedSkins = 0;
    var preservedSkins = deepClone(current.skins || []);
    preservedSkins.forEach(function (skin) {
      var oldPart = currentById[skin.partId];
      var nextPart = mergedById[skin.partId];
      if (!oldPart || !nextPart || oldPart.type !== 'part' || nextPart.type !== 'part') return;
      if (oldPart.mesh.vertices.length === nextPart.mesh.vertices.length) return;
      var minY = Math.min.apply(null, nextPart.mesh.vertices.map(function (vertex) {
        return vertex[1];
      }));
      var maxY = Math.max.apply(null, nextPart.mesh.vertices.map(function (vertex) {
        return vertex[1];
      }));
      skin.weights = generateSmoothChainWeights(nextPart.mesh.vertices, skin.bones, {
        fadeStartY: minY + (maxY - minY) * 0.06
      });
      remappedSkins++;
    });

    var nextModel = {
      version: VERSION,
      meta: Object.assign({}, imported.meta || {}, {
        generator: 'Free Rig Studio core P2',
        reimportedFrom: current.meta && current.meta.name || null
      }),
      canvas: deepClone(imported.canvas),
      parameters: parameters,
      textures: deepClone(imported.textures),
      nodes: mergedNodes,
      physicsFps: Number(current.physicsFps || imported.physicsFps || 60),
      physics: deepClone(current.physics || imported.physics || []),
      glues: deepClone(current.glues || []),
      skins: preservedSkins,
      textureAtlases: [],
      atlasSettings: deepClone(current.atlasSettings || null)
    };
    filterRigReferences(nextModel);
    var validation = validateModel(nextModel);
    if (!validation.ok) throw new Error(validation.errors.join('\n'));
    return {
      model: nextModel,
      report: {
        matched: matched,
        newNodes: newNodes,
        removed: current.nodes.filter(function (node) {
          return node.source && node.source.kind && !importedIds[node.id];
        }).length,
        preservedRigNodes: mergedNodes.filter(function (node) {
          return !(node.source && node.source.kind);
        }).length,
        remappedSkins: remappedSkins,
        atlasInvalidated: Boolean((current.textureAtlases || []).length)
      }
    };
  }

  function nextPowerOfTwo(value) {
    var result = 1;
    while (result < value) result *= 2;
    return result;
  }

  function tryPackTextureRects(textures, width, height, padding) {
    var entries = [];
    var x = padding;
    var y = padding;
    var shelfHeight = 0;
    for (var index = 0; index < textures.length; index++) {
      var texture = textures[index];
      if (texture.width + padding * 2 > width || texture.height + padding * 2 > height) {
        return null;
      }
      if (x + texture.width + padding > width) {
        x = padding;
        y += shelfHeight + padding;
        shelfHeight = 0;
      }
      if (y + texture.height + padding > height) return null;
      entries.push({
        textureId: texture.id,
        x: x,
        y: y,
        width: texture.width,
        height: texture.height
      });
      x += texture.width + padding;
      shelfHeight = Math.max(shelfHeight, texture.height);
    }
    return entries;
  }

  function packTextureRects(textures, options) {
    options = options || {};
    var padding = Math.max(0, Number(options.padding == null ? 2 : options.padding) | 0);
    var sorted = (textures || []).map(function (texture) {
      return {
        id: texture.id,
        width: Number(texture.width),
        height: Number(texture.height)
      };
    }).sort(function (left, right) {
      return right.height - left.height || right.width - left.width ||
        String(left.id).localeCompare(String(right.id));
    });
    if (!sorted.length) return { ok: false, errors: ['textures are required'], entries: [] };
    if (sorted.some(function (texture) {
      return !texture.id || !(texture.width > 0) || !(texture.height > 0);
    })) return { ok: false, errors: ['texture dimensions must be positive'], entries: [] };

    var width = Number(options.width || 0);
    var height = Number(options.height || 0);
    if (!width || !height) {
      var totalArea = sorted.reduce(function (sum, texture) {
        return sum + (texture.width + padding) * (texture.height + padding);
      }, 0);
      var largest = sorted.reduce(function (value, texture) {
        return Math.max(value, texture.width + padding * 2, texture.height + padding * 2);
      }, 0);
      width = height = Math.max(256, nextPowerOfTwo(Math.max(largest, Math.sqrt(totalArea))));
    }
    var entries = tryPackTextureRects(sorted, width, height, padding);
    while (!entries && !options.width && width < 8192) {
      width *= 2;
      height *= 2;
      entries = tryPackTextureRects(sorted, width, height, padding);
    }
    if (!entries) {
      return {
        ok: false,
        width: width,
        height: height,
        errors: ['textures do not fit in atlas'],
        entries: []
      };
    }
    return {
      ok: true,
      width: width,
      height: height,
      padding: padding,
      entries: entries,
      errors: []
    };
  }

  function generateSmoothChainWeights(vertices, bones, options) {
    options = options || {};
    var sortedBones = (bones || []).slice().sort(function (left, right) {
      return Number(left.pivotY || 0) - Number(right.pivotY || 0);
    });
    if (!sortedBones.length) return (vertices || []).map(function () { return []; });
    var minY = Math.min.apply(null, (vertices || []).map(function (vertex) {
      return Number(vertex[1]);
    }));
    var firstPivot = Number(sortedBones[0].pivotY || minY);
    var fadeStart = options.fadeStartY == null
      ? lerp(minY, firstPivot, 0.35) : Number(options.fadeStartY);
    var fadeEnd = Math.max(fadeStart + 0.00001, firstPivot);

    return (vertices || []).map(function (vertex) {
      var y = Number(vertex[1]);
      var activation = smoothstep((y - fadeStart) / (fadeEnd - fadeStart));
      if (activation <= 0.00001) return [];
      if (y <= firstPivot || sortedBones.length === 1) {
        return [{ boneId: sortedBones[0].id, weight: activation }];
      }
      for (var index = 0; index < sortedBones.length - 1; index++) {
        var left = sortedBones[index];
        var right = sortedBones[index + 1];
        var leftY = Number(left.pivotY);
        var rightY = Number(right.pivotY);
        if (y > rightY) continue;
        var t = smoothstep((y - leftY) / Math.max(0.00001, rightY - leftY));
        var leftWeight = activation * (1 - t);
        var rightWeight = activation * t;
        var weights = [];
        if (leftWeight > 0.00001) weights.push({ boneId: left.id, weight: leftWeight });
        if (rightWeight > 0.00001) weights.push({ boneId: right.id, weight: rightWeight });
        return weights;
      }
      return [{ boneId: sortedBones[sortedBones.length - 1].id, weight: activation }];
    });
  }

  function createIdleMotionRuntime(seed) {
    var initialSeed = (Number(seed) || 0x5eed1234) >>> 0;
    var randomState = initialSeed;
    var time = 0;
    var nextBlink = 0;
    var blinkStarts = [];
    var blinkCount = 0;
    var lastEyeOpen = 1;

    function random() {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    }

    function scheduleFirstBlink() {
      nextBlink = 2.15 + random() * 1.1;
    }

    function blinkValue(localTime) {
      var closeDuration = 0.072;
      var closedDuration = 0.03;
      var openDuration = 0.118;
      if (localTime < 0 || localTime >= closeDuration + closedDuration + openDuration) return 1;
      if (localTime < closeDuration) return 1 - smoothstep(localTime / closeDuration);
      if (localTime < closeDuration + closedDuration) return 0;
      return smoothstep(
        (localTime - closeDuration - closedDuration) / openDuration
      );
    }

    function eyeOpenAt(currentTime, offset) {
      var value = 1;
      blinkStarts.forEach(function (start) {
        value = Math.min(value, blinkValue(currentTime - start - offset));
      });
      return value;
    }

    function reset() {
      randomState = initialSeed;
      time = 0;
      blinkStarts = [];
      blinkCount = 0;
      lastEyeOpen = 1;
      scheduleFirstBlink();
    }

    function step(deltaTime, motionScale) {
      var dt = clamp(Number(deltaTime) || 0, 0, 0.1);
      var scale = motionScale == null ? 1 : clamp(Number(motionScale), 0, 1);
      time += dt;
      while (time >= nextBlink) {
        blinkStarts.push(nextBlink);
        blinkCount++;
        if (random() < 0.18) {
          blinkStarts.push(nextBlink + 0.235);
          blinkCount++;
        }
        nextBlink += 2.75 + random() * 2.35;
      }
      blinkStarts = blinkStarts.filter(function (start) {
        return start > time - 0.45;
      });
      var eyeOpenL = eyeOpenAt(time, 0);
      var eyeOpenR = eyeOpenAt(time, 0.006);
      var breathPhase = time * Math.PI * 2 / 4.15;
      var breath = 0.5 - Math.cos(breathPhase) * 0.5;
      lastEyeOpen = Math.min(eyeOpenL, eyeOpenR);
      return {
        AngleX: (
          Math.sin(time * 0.52) * 0.34 +
          Math.sin(time * 0.19 + 1.1) * 0.08
        ) * scale,
        AngleY: (
          Math.sin(time * 0.37 + 0.82) * 0.18 +
          Math.sin(time * 0.13) * 0.05
        ) * scale,
        AngleZ: (
          Math.sin(time * 0.31 + 1.36) * 0.26 +
          Math.sin(time * 0.11 + 0.2) * 0.07
        ) * scale,
        BodyAngleX: (
          Math.sin(time * 0.235 - 0.4) * 0.3 +
          Math.sin(time * 0.08 + 1.7) * 0.065
        ) * scale,
        BodyAngleY: (
          Math.sin(time * 0.29 + 0.55) * 0.14 +
          Math.sin(time * 0.12 - 0.7) * 0.04
        ) * scale,
        BodyAngleZ: (
          Math.sin(time * 0.22 - 0.75) * 0.29 +
          Math.sin(time * 0.071 + 0.4) * 0.05
        ) * scale,
        ShoulderMotion: (
          Math.sin(breathPhase - 0.35) * 0.38 +
          Math.sin(time * 0.47 + 1.2) * 0.06
        ) * scale,
        HipShift: (
          Math.sin(time * 0.205 + 1.85) * 0.28 +
          Math.sin(time * 0.063 - 0.2) * 0.05
        ) * scale,
        Breath: 0.5 + (breath - 0.5) * scale,
        EyeOpenL: eyeOpenL,
        EyeOpenR: eyeOpenR
      };
    }

    reset();
    return {
      step: step,
      reset: reset,
      getDiagnostics: function () {
        return {
          time: time,
          blinkCount: blinkCount,
          nextBlink: nextBlink,
          eyeOpen: lastEyeOpen
        };
      }
    };
  }

  function createPerformanceRuntime(presets, seed) {
    presets = presets || {};
    var fallback = presets.neutral || {};
    var initialSeed = (Number(seed) || 0xface2718) >>> 0;
    var randomState = initialSeed;
    var currentName = presets.neutral ? 'neutral' : Object.keys(presets)[0];
    var from = deepClone(presets[currentName] || fallback);
    var current = deepClone(from);
    var target = deepClone(from);
    var fadeElapsed = 1;
    var fadeDuration = 0.5;
    var talkActive = false;
    var talkTime = 0;
    var nextSyllable = 0;
    var talkTarget = 0;
    var talkValue = 0;
    var talkFormTarget = 0;
    var talkFormValue = 0;
    var gazeTargetX = 0;
    var gazeTargetY = 0;
    var gazeX = 0;
    var gazeY = 0;
    var nextGazeTime = 0;
    var gestureName = null;
    var gestureTime = 0;

    function random() {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    }

    function keysForExpression() {
      var seen = {};
      [fallback, from, current, target].forEach(function (entry) {
        Object.keys(entry || {}).forEach(function (key) { seen[key] = true; });
      });
      return Object.keys(seen);
    }

    function sampleExpression(t) {
      var eased = smoothstep(t);
      var result = {};
      keysForExpression().forEach(function (key) {
        var defaultValue = Number(fallback[key] || 0);
        var fromValue = from[key] == null ? defaultValue : Number(from[key]);
        var targetValue = target[key] == null ? defaultValue : Number(target[key]);
        result[key] = lerp(fromValue, targetValue, eased);
      });
      return result;
    }

    function setExpression(name, duration) {
      from = deepClone(current);
      target = deepClone(presets[name] || fallback);
      currentName = presets[name] ? name : 'neutral';
      fadeElapsed = 0;
      fadeDuration = Math.max(0.08, Number(duration == null ? 0.5 : duration));
    }

    function setTalk(active) {
      talkActive = Boolean(active);
      if (!talkActive) {
        talkTarget = 0;
        talkFormTarget = 0;
        gazeTargetX = 0;
        gazeTargetY = 0;
      }
    }

    function triggerGesture(name) {
      gestureName = name || 'nod';
      gestureTime = 0;
    }

    function sampleGesture(deltaTime) {
      var result = {
        AngleX: 0,
        AngleY: 0,
        AngleZ: 0,
        BodyAngleX: 0,
        BodyAngleY: 0,
        BodyAngleZ: 0,
        ShoulderMotion: 0,
        HipShift: 0,
        WingSwing: 0,
        WingFlap: 0,
        TailSwing: 0,
        TailCurl: 0,
        CloakSwing: 0,
        CloakFlutter: 0,
        ArmSwing: 0,
        ArmFollow: 0
      };
      if (!gestureName) return result;
      gestureTime += deltaTime;
      var progress;
      if (gestureName === 'nod') {
        progress = clamp(gestureTime / 0.9, 0, 1);
        result.AngleY = Math.sin(progress * Math.PI * 2) * -0.34;
        result.BodyAngleX = Math.sin(progress * Math.PI) * 0.13;
        result.ShoulderMotion = Math.sin(progress * Math.PI) * 0.1;
        result.HipShift = Math.sin(progress * Math.PI) * -0.05;
      } else if (gestureName === 'invite') {
        progress = clamp(gestureTime / 1.8, 0, 1);
        var rise = Math.sin(progress * Math.PI);
        var flourish = Math.sin(progress * Math.PI * 2);
        result.AngleX = rise * 0.08;
        result.AngleZ = rise * 0.38;
        result.BodyAngleX = rise * 0.16;
        result.BodyAngleY = flourish * 0.08;
        result.BodyAngleZ = rise * -0.22;
        result.ShoulderMotion = rise * 0.16;
        result.HipShift = rise * 0.14;
        result.WingSwing = rise * 0.28;
        result.WingFlap = flourish * 0.22;
        result.TailSwing = Math.sin(progress * Math.PI * 1.5) * 0.24;
        result.TailCurl = rise * 0.28;
        result.CloakSwing = rise * -0.18;
        result.CloakFlutter = flourish * 0.12;
        result.ArmSwing = rise * 0.12;
        result.ArmFollow = flourish * 0.08;
      } else {
        progress = 1;
      }
      if (progress >= 1) gestureName = null;
      return result;
    }

    function step(deltaTime, motionScale) {
      var dt = clamp(Number(deltaTime) || 0, 0, 0.1);
      var scale = motionScale == null ? 1 : clamp(Number(motionScale), 0, 1);
      fadeElapsed += dt;
      current = sampleExpression(clamp(fadeElapsed / fadeDuration, 0, 1));

      talkTime += dt;
      if (talkActive && talkTime >= nextSyllable) {
        nextSyllable = talkTime + 0.07 + random() * 0.09;
        talkTarget = random() < 0.16 ? 0.08 : 0.48 + random() * 0.52;
        talkFormTarget = -0.28 + random() * 0.72;
      }
      if (!talkActive) {
        talkTarget = 0;
        talkFormTarget = 0;
      }
      talkValue += (talkTarget - talkValue) * Math.min(1, dt * (talkActive ? 22 : 15));
      talkFormValue += (talkFormTarget - talkFormValue) *
        Math.min(1, dt * (talkActive ? 18 : 12));
      if (talkValue < 0.001) talkValue = 0;
      if (Math.abs(talkFormValue) < 0.001) talkFormValue = 0;

      if (talkActive && talkTime >= nextGazeTime) {
        nextGazeTime = talkTime + 0.45 + random() * 0.65;
        gazeTargetX = -0.18 + random() * 0.36;
        gazeTargetY = -0.07 + random() * 0.14;
      }
      if (!talkActive) {
        gazeTargetX = 0;
        gazeTargetY = 0;
      }
      gazeX += (gazeTargetX - gazeX) * Math.min(1, dt * 5.5);
      gazeY += (gazeTargetY - gazeY) * Math.min(1, dt * 5.5);

      var gesture = sampleGesture(dt);
      if (talkActive) {
        gesture.AngleY += Math.sin(talkTime * 4.4) * 0.1;
        gesture.AngleX += Math.sin(talkTime * 2.4 + 0.8) * 0.055;
        gesture.AngleZ += Math.sin(talkTime * 1.9 + 0.4) * 0.04;
        gesture.BodyAngleZ += Math.sin(talkTime * 2.1 + 1.1) * 0.065;
        gesture.ShoulderMotion += Math.sin(talkTime * 3.1) * 0.09;
        gesture.HipShift += Math.sin(talkTime * 1.55 + 0.3) * 0.055;
        gesture.ArmSwing += Math.sin(talkTime * 2.3 + 0.8) * 0.045;
        gesture.CloakFlutter += Math.sin(talkTime * 2.7 + 1.6) * 0.035;
      }
      Object.keys(gesture).forEach(function (key) {
        gesture[key] *= scale;
      });
      return {
        expression: deepClone(current),
        talkMouth: talkValue,
        talkMouthForm: talkFormValue,
        talkGazeX: gazeX,
        talkGazeY: gazeY,
        offsets: gesture
      };
    }

    function reset() {
      randomState = initialSeed;
      currentName = presets.neutral ? 'neutral' : Object.keys(presets)[0];
      from = deepClone(presets[currentName] || fallback);
      current = deepClone(from);
      target = deepClone(from);
      fadeElapsed = 1;
      talkActive = false;
      talkTime = 0;
      nextSyllable = 0;
      talkTarget = 0;
      talkValue = 0;
      talkFormTarget = 0;
      talkFormValue = 0;
      gazeTargetX = 0;
      gazeTargetY = 0;
      gazeX = 0;
      gazeY = 0;
      nextGazeTime = 0;
      gestureName = null;
      gestureTime = 0;
    }

    return {
      step: step,
      reset: reset,
      setExpression: setExpression,
      setTalk: setTalk,
      triggerGesture: triggerGesture,
      getDiagnostics: function () {
        return {
          expression: currentName,
          fade: clamp(fadeElapsed / fadeDuration, 0, 1),
          talking: talkActive,
          talkMouth: talkValue,
          talkMouthForm: talkFormValue,
          talkGazeX: gazeX,
          talkGazeY: gazeY,
          gesture: gestureName
        };
      }
    };
  }

  function validateModel(model) {
    var errors = [];
    if (!model || typeof model !== 'object') return { ok: false, errors: ['model is required'] };
    if (model.version !== VERSION) errors.push('unsupported model version: ' + model.version);
    if (!model.canvas || !(model.canvas.width > 0) || !(model.canvas.height > 0)) {
      errors.push('canvas width and height must be positive');
    }
    if (model.physicsFps != null &&
        !(Number(model.physicsFps) >= 15 && Number(model.physicsFps) <= 240)) {
      errors.push('physics fps must be between 15 and 240');
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

    var gluesById = {};
    (model.glues || []).forEach(function (glue) {
      if (!glue.id) errors.push('glue id is required');
      else if (gluesById[glue.id]) errors.push('duplicate glue id: ' + glue.id);
      else gluesById[glue.id] = glue;
      var partA = nodesById[glue.partAId];
      var partB = nodesById[glue.partBId];
      if (!partA || partA.type !== 'part') errors.push('invalid glue part A: ' + glue.id);
      if (!partB || partB.type !== 'part') errors.push('invalid glue part B: ' + glue.id);
      if (glue.partAId === glue.partBId) errors.push('glue parts must differ: ' + glue.id);
      if (!Number.isFinite(Number(glue.compatibility)) ||
          Number(glue.compatibility) < 0 || Number(glue.compatibility) > 1) {
        errors.push('glue compatibility must be between 0 and 1: ' + glue.id);
      }
      if (!glue.bindings || !glue.bindings.length) {
        errors.push('glue binding is required: ' + glue.id);
      }
      (glue.bindings || []).forEach(function (entry) {
        if (!Number.isInteger(Number(entry.vertexA)) || !partA ||
            entry.vertexA < 0 || entry.vertexA >= partA.mesh.vertices.length) {
          errors.push('glue vertex A is out of range: ' + glue.id);
        }
        if (!Number.isInteger(Number(entry.vertexB)) || !partB ||
            entry.vertexB < 0 || entry.vertexB >= partB.mesh.vertices.length) {
          errors.push('glue vertex B is out of range: ' + glue.id);
        }
        if (!Number.isFinite(Number(entry.weight)) ||
            Number(entry.weight) < 0 || Number(entry.weight) > 1) {
          errors.push('glue weight must be between 0 and 1: ' + glue.id);
        }
      });
    });

    var skinsById = {};
    (model.skins || []).forEach(function (skin) {
      if (!skin.id) errors.push('skin id is required');
      else if (skinsById[skin.id]) errors.push('duplicate skin id: ' + skin.id);
      else skinsById[skin.id] = skin;
      var part = nodesById[skin.partId];
      if (!part || part.type !== 'part') errors.push('invalid skin part: ' + skin.id);
      var bonesById = {};
      (skin.bones || []).forEach(function (bone) {
        if (!bone.id) errors.push('skin bone id is required: ' + skin.id);
        else if (bonesById[bone.id]) errors.push('duplicate skin bone id: ' + bone.id);
        else bonesById[bone.id] = bone;
        if (bone.parameterId && !parametersById[bone.parameterId]) {
          errors.push('unknown skin parameter: ' + bone.parameterId);
        }
        ['pivotX', 'pivotY', 'angleScale', 'angleOffset'].forEach(function (key) {
          if (bone[key] != null && !Number.isFinite(Number(bone[key]))) {
            errors.push('skin bone value must be finite: ' + bone.id + ' / ' + key);
          }
        });
      });
      Object.keys(bonesById).forEach(function (boneId) {
        var seen = {};
        var currentBone = bonesById[boneId];
        while (currentBone) {
          if (seen[currentBone.id]) {
            errors.push('skin bone hierarchy cycle at: ' + currentBone.id);
            break;
          }
          seen[currentBone.id] = true;
          if (currentBone.parentId && !bonesById[currentBone.parentId]) {
            errors.push('missing skin bone parent: ' + currentBone.parentId);
            break;
          }
          currentBone = currentBone.parentId ? bonesById[currentBone.parentId] : null;
        }
      });
      if (part && Array.isArray(skin.weights) &&
          skin.weights.length !== part.mesh.vertices.length) {
        errors.push('skin weight count mismatch: ' + skin.id);
      }
      (skin.weights || []).forEach(function (vertexWeights, vertexIndex) {
        var sum = 0;
        (vertexWeights || []).forEach(function (weight) {
          if (!bonesById[weight.boneId]) errors.push('unknown skin weight bone: ' + weight.boneId);
          if (!Number.isFinite(Number(weight.weight)) || Number(weight.weight) < 0) {
            errors.push('skin weight must be non-negative: ' + skin.id + ' / ' + vertexIndex);
          }
          sum += Number(weight.weight);
        });
        if (sum > 1.00001) errors.push('skin vertex weight exceeds 1: ' + skin.id + ' / ' + vertexIndex);
      });
    });

    (model.textureAtlases || []).forEach(function (atlas) {
      if (!texturesById[atlas.textureId]) errors.push('missing atlas texture: ' + atlas.textureId);
      if (!(atlas.width > 0) || !(atlas.height > 0)) {
        errors.push('atlas size must be positive: ' + atlas.id);
      }
      (atlas.entries || []).forEach(function (entry, entryIndex) {
        if (entry.x < 0 || entry.y < 0 || entry.x + entry.width > atlas.width ||
            entry.y + entry.height > atlas.height) {
          errors.push('atlas entry is out of bounds: ' + entry.sourceTextureId);
        }
        (atlas.entries || []).slice(entryIndex + 1).forEach(function (other) {
          if (entry.x < other.x + other.width && entry.x + entry.width > other.x &&
              entry.y < other.y + other.height && entry.y + entry.height > other.y) {
            errors.push(
              'atlas entries overlap: ' + entry.sourceTextureId + ' / ' + other.sourceTextureId
            );
          }
        });
      });
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

    function skinLocalPositions(part, positions, values) {
      var skin = (model.skins || []).find(function (entry) {
        return entry.partId === part.id;
      });
      if (!skin || !skin.bones || !skin.bones.length) return positions;
      var bonesById = {};
      var bindMatrices = {};
      var currentMatrices = {};
      skin.bones.forEach(function (bone) { bonesById[bone.id] = bone; });

      function evaluateBone(bone) {
        if (currentMatrices[bone.id]) return;
        var parameter = bone.parameterId ? parametersById[bone.parameterId] : null;
        var value = parameter
          ? (values[parameter.id] == null ? parameter.default : Number(values[parameter.id]))
          : 0;
        if (parameter) value = clamp(value, parameter.min, parameter.max);
        var offset = Number(bone.angleOffset || 0);
        var delta = parameter ? (value - parameter.default) * Number(bone.angleScale || 0) : 0;
        var bindLocal = matrixFromTransform({
          x: 0,
          y: 0,
          pivotX: Number(bone.pivotX || 0),
          pivotY: Number(bone.pivotY || 0),
          rotation: offset,
          scaleX: 1,
          scaleY: 1
        });
        var currentLocal = matrixFromTransform({
          x: 0,
          y: 0,
          pivotX: Number(bone.pivotX || 0),
          pivotY: Number(bone.pivotY || 0),
          rotation: offset + delta,
          scaleX: 1,
          scaleY: 1
        });
        if (bone.parentId) {
          evaluateBone(bonesById[bone.parentId]);
          bindMatrices[bone.id] = multiplyMatrices(bindMatrices[bone.parentId], bindLocal);
          currentMatrices[bone.id] = multiplyMatrices(currentMatrices[bone.parentId], currentLocal);
        } else {
          bindMatrices[bone.id] = bindLocal;
          currentMatrices[bone.id] = currentLocal;
        }
      }
      skin.bones.forEach(evaluateBone);
      var skinMatrices = {};
      skin.bones.forEach(function (bone) {
        skinMatrices[bone.id] = multiplyMatrices(
          currentMatrices[bone.id],
          invertMatrix(bindMatrices[bone.id])
        );
      });
      return positions.map(function (point, vertexIndex) {
        var weights = skin.weights && skin.weights[vertexIndex] || [];
        var sum = 0;
        var result = { x: 0, y: 0 };
        weights.forEach(function (weight) {
          var amount = Number(weight.weight);
          var transformed = transformPoint(skinMatrices[weight.boneId], point);
          result.x += transformed.x * amount;
          result.y += transformed.y * amount;
          sum += amount;
        });
        var remaining = Math.max(0, 1 - sum);
        result.x += point.x * remaining;
        result.y += point.y * remaining;
        return result;
      });
    }

    function evaluate(values) {
      values = values || {};
      var statesById = {};
      model.nodes.forEach(function (node) {
        statesById[node.id] = evaluateNodeState(node, parametersById, values);
      });

      function evaluatePart(part) {
        var state = statesById[part.id];
        var positions = [];
        var localPositions = part.mesh.vertices.map(function (base, index) {
          return {
            x: base[0] + state.meshOffsets[index * 2],
            y: base[1] + state.meshOffsets[index * 2 + 1]
          };
        });
        localPositions = skinLocalPositions(part, localPositions, values);
        for (var index = 0; index < part.mesh.vertices.length; index++) {
          var point = localPositions[index];
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
      var partsById = {};
      parts.forEach(function (part) { partsById[part.id] = part; });
      (model.glues || []).forEach(function (glue) {
        var partA = partsById[glue.partAId];
        var partB = partsById[glue.partBId];
        if (!partA || !partB) return;
        var compatibility = clamp(Number(glue.compatibility), 0, 1);
        glue.bindings.forEach(function (binding) {
          var pointA = partA.positions[binding.vertexA];
          var pointB = partB.positions[binding.vertexB];
          var weight = clamp(Number(binding.weight), 0, 1);
          var targetX = lerp(pointA[0], pointB[0], weight);
          var targetY = lerp(pointA[1], pointB[1], weight);
          pointA[0] = lerp(pointA[0], targetX, compatibility);
          pointA[1] = lerp(pointA[1], targetY, compatibility);
          pointB[0] = lerp(pointB[0], targetX, compatibility);
          pointB[1] = lerp(pointB[1], targetY, compatibility);
        });
      });
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
    var fixedFps = clamp(Number(model.physicsFps || 60), 15, 240);
    var fixedDelta = 1 / fixedFps;
    var accumulator = 0;
    var maxSubsteps = 8;
    var lastSubsteps = 0;
    var totalSteps = 0;
    var droppedTime = 0;
    model.parameters.forEach(function (parameter) {
      parametersById[parameter.id] = parameter;
    });
    (model.physics || []).forEach(function (group) {
      states[group.id] = { value: 0, velocity: 0, previousValue: 0 };
    });

    function reset() {
      accumulator = 0;
      lastSubsteps = 0;
      totalSteps = 0;
      droppedTime = 0;
      Object.keys(states).forEach(function (id) {
        states[id].value = 0;
        states[id].velocity = 0;
        states[id].previousValue = 0;
      });
    }

    function inputTarget(group, values) {
      var target = 0;
      group.inputs.forEach(function (input) {
        var parameter = parametersById[input.parameterId];
        var value = values[input.parameterId] == null
          ? parameter.default : Number(values[input.parameterId]);
        var center = input.center == null ? parameter.default : Number(input.center);
        var weight = input.weight == null ? 1 : Number(input.weight);
        target += (value - center) * weight;
      });
      return target;
    }

    function integrate(values) {
      (model.physics || []).forEach(function (group) {
        if (group.enabled === false) return;
        var settings = group.settings || {};
        var stiffness = Number(settings.stiffness);
        var damping = Number(settings.damping);
        var mass = settings.mass == null ? 1 : Number(settings.mass);
        var state = states[group.id];
        var target = inputTarget(group, values);
        state.previousValue = state.value;
        var acceleration = (stiffness * (target - state.value) - damping * state.velocity) / mass;
        state.velocity += acceleration * fixedDelta;
        state.value += state.velocity * fixedDelta;
      });
      totalSteps++;
    }

    function step(values, deltaTime) {
      var rawDelta = Math.max(0, Number(deltaTime) || 0);
      var acceptedDelta = Math.min(rawDelta, fixedDelta * maxSubsteps);
      droppedTime += Math.max(0, rawDelta - acceptedDelta);
      accumulator += acceptedDelta;
      lastSubsteps = 0;
      while (accumulator + 1e-12 >= fixedDelta && lastSubsteps < maxSubsteps) {
        integrate(values);
        accumulator -= fixedDelta;
        lastSubsteps++;
      }
      if (accumulator < 1e-12) accumulator = 0;

      var alpha = clamp(accumulator / fixedDelta, 0, 1);
      var contributions = {};
      (model.physics || []).forEach(function (group) {
        if (group.enabled === false) return;
        var state = states[group.id];
        var sampledValue = lerp(state.previousValue, state.value, alpha);
        group.outputs.forEach(function (output) {
          var parameter = parametersById[output.parameterId];
          var scale = output.scale == null ? 1 : Number(output.scale);
          var offset = output.offset == null ? 0 : Number(output.offset);
          if (contributions[output.parameterId] == null) {
            contributions[output.parameterId] = parameter.default;
          }
          contributions[output.parameterId] += sampledValue * scale + offset;
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
      getStates: function () {
        var result = {};
        Object.keys(states).forEach(function (id) {
          result[id] = { value: states[id].value, velocity: states[id].velocity };
        });
        return result;
      },
      getDiagnostics: function () {
        return {
          fixedFps: fixedFps,
          fixedDelta: fixedDelta,
          accumulator: accumulator,
          lastSubsteps: lastSubsteps,
          totalSteps: totalSteps,
          droppedTime: droppedTime
        };
      }
    };
  }

  return {
    VERSION: VERSION,
    clamp: clamp,
    lerp: lerp,
    smoothstep: smoothstep,
    identityTransform: identityTransform,
    matrixFromTransform: matrixFromTransform,
    multiplyMatrices: multiplyMatrices,
    invertMatrix: invertMatrix,
    transformPoint: transformPoint,
    createRectMesh: createRectMesh,
    createZeroOffsets: createZeroOffsets,
    normalizedOffsets: normalizedOffsets,
    sampleKeyforms: sampleKeyforms,
    applyWarp: applyWarp,
    mergeReimportedModel: mergeReimportedModel,
    packTextureRects: packTextureRects,
    generateSmoothChainWeights: generateSmoothChainWeights,
    createIdleMotionRuntime: createIdleMotionRuntime,
    createPerformanceRuntime: createPerformanceRuntime,
    validateModel: validateModel,
    createEvaluator: createEvaluator,
    createPhysicsRuntime: createPhysicsRuntime,
    exportModel: exportModel,
    importModel: importModel
  };
});
