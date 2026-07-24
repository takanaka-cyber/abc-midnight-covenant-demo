(function () {
  'use strict';

  var Core = window.FreeRigCore;
  var renderCanvas = document.getElementById('renderCanvas');
  var overlayCanvas = document.getElementById('overlayCanvas');
  var overlay = overlayCanvas.getContext('2d');
  var stage = document.getElementById('stage');
  var model = null;
  var evaluator = null;
  var evaluated = null;
  var parameterValues = {};
  var selectedId = null;
  var renderer = null;
  var showMesh = true;
  var meshEditing = false;
  var draggedVertex = -1;
  var warpEditing = false;
  var draggedWarpPoint = -1;
  var idleEnabled = false;
  var physicsEnabled = true;
  var physicsRuntime = null;
  var selectedPhysicsId = null;
  var lastFrame = performance.now();
  var frameCount = 0;
  var fpsStarted = lastFrame;

  function setStatus(message) {
    document.getElementById('statusText').textContent = message;
  }

  function slug(value) {
    return String(value || 'node').normalize('NFKC').toLowerCase()
      .replace(/[^a-z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '') || 'node';
  }

  function uniqueId(base, used) {
    var id = base;
    var suffix = 2;
    while (used[id]) id = base + '_' + suffix++;
    used[id] = true;
    return id;
  }

  function hashString(value) {
    var hash = 2166136261;
    for (var index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function pathKey(path) {
    return path.map(function (entry) {
      return entry.name + '#' + entry.occurrence;
    }).join('/');
  }

  function stablePathId(prefix, path) {
    var label = path.length ? slug(path[path.length - 1].name) : 'root';
    return prefix + '_' + label + '_' + hashString(pathKey(path));
  }

  function inspectPsdHierarchy(psd) {
    var groups = [];
    var leaves = [];

    function walk(children, parentPath) {
      var occurrences = {};
      (children || []).forEach(function (child) {
        var name = String(child.name || 'unnamed');
        occurrences[name] = (occurrences[name] || 0) + 1;
        var token = { name: name, occurrence: occurrences[name] };
        var nextPath = parentPath.concat([token]);
        if (child.children) {
          groups.push({
            id: stablePathId('source_group', nextPath),
            name: name,
            path: nextPath,
            visible: child.hidden !== true,
            opacity: child.opacity == null ? 1 : Number(child.opacity),
            blendMode: child.blendMode || 'normal'
          });
          walk(child.children, nextPath);
          return;
        }
        if (!child.imageData) return;
        leaves.push({
          id: stablePathId('source_layer', nextPath),
          name: name,
          path: nextPath,
          groupPath: parentPath,
          visible: child.hidden !== true,
          layer: child
        });
      });
    }

    walk(psd.children || [], []);
    return { groups: groups, leaves: leaves };
  }

  function flattenPsdForRigger(psd, hierarchy) {
    var flatChildren = hierarchy.leaves.map(function (record) {
      var layer = Object.assign({}, record.layer);
      layer.__freeRigSourceId = record.id;
      layer.__freeRigSourcePath = record.path;
      layer.__freeRigGroupPath = record.groupPath;
      layer.__freeRigVisible = record.visible;
      return layer;
    });
    return Object.assign({}, psd, { children: flatChildren });
  }

  function imageDataToDataUrl(image) {
    var canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    var context = canvas.getContext('2d');
    var pixels = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function zeroGrid(columns, rows) {
    return Core.createZeroOffsets((columns + 1) * (rows + 1));
  }

  function gridOffsets(columns, rows, callback) {
    var result = [];
    for (var y = 0; y <= rows; y++) {
      for (var x = 0; x <= columns; x++) {
        var point = callback(x / columns, y / rows);
        result.push(point[0], point[1]);
      }
    }
    return result;
  }

  function binding(values, states, interpolation) {
    return {
      interpolation: interpolation || 'smooth',
      keyforms: values.map(function (value, index) {
        return { value: value, state: states[index] };
      })
    };
  }

  function createSampleModel(rig, sourceName, sourceHierarchy) {
    var usedIds = {};
    var textures = [];
    var nodes = [];
    var byOriginalName = {};
    var columns = 2;
    var rows = 2;
    var anchors = rig.anchors;
    var face = anchors.face;
    var headX = Math.max(0, face.x0 - (face.x1 - face.x0) * 0.55);
    var headY = Math.max(0, face.y0 - (face.y1 - face.y0) * 0.45);
    var headWidth = Math.min(rig.canvas.w - headX, (face.x1 - face.x0) * 2.1);
    var headHeight = Math.min(rig.canvas.h - headY, (face.y1 - face.y0) * 1.75);
    var chestY = Math.max(0, anchors.neckTop);
    var chestHeight = Math.min(rig.canvas.h - chestY, (face.y1 - face.y0) * 1.6);
    var chestX = Math.max(0, anchors.neckPivot.cx - (face.x1 - face.x0) * 0.9);
    var chestWidth = Math.min(rig.canvas.w - chestX, (face.x1 - face.x0) * 1.8);

    nodes.push({
      id: 'root_rotation',
      name: 'Root rotation',
      type: 'rotation',
      parentId: null,
      transform: {
        x: 0, y: 0, pivotX: anchors.bodyPivot.cx, pivotY: anchors.bodyPivot.cy,
        rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, drawOrder: 0
      },
      bindings: {
        BodyAngle: binding([-1, 0, 1], [
          { rotation: -2.8 }, { rotation: 0 }, { rotation: 2.8 }
        ])
      }
    });
    nodes.push({
      id: 'body_warp',
      name: 'Body warp',
      type: 'warp',
      parentId: 'root_rotation',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, drawOrder: 0 },
      warp: { x: 0, y: 0, width: rig.canvas.w, height: rig.canvas.h, columns: 2, rows: 3 },
      bindings: {
        Breath: binding([0, 1], [
          { warpOffsets: zeroGrid(2, 3) },
          {
            warpOffsets: gridOffsets(2, 3, function (x, y) {
              var upperBody = Math.max(0, 1 - Math.abs(y - 0.46) * 3.4);
              return [(x - 0.5) * upperBody * 2.4, -upperBody * 3.2];
            })
          }
        ])
      }
    });
    nodes.push({
      id: 'head_rotation',
      name: 'Head rotation',
      type: 'rotation',
      parentId: 'body_warp',
      transform: {
        x: 0, y: 0, pivotX: anchors.neckPivot.cx, pivotY: anchors.neckPivot.cy,
        rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, drawOrder: 0
      },
      bindings: {
        AngleZ: binding([-1, 0, 1], [
          { rotation: -5.5 }, { rotation: 0 }, { rotation: 5.5 }
        ])
      }
    });
    nodes.push({
      id: 'head_warp',
      name: 'Head XY warp',
      type: 'warp',
      parentId: 'head_rotation',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, drawOrder: 0 },
      warp: { x: headX, y: headY, width: headWidth, height: headHeight, columns: columns, rows: rows },
      bindings: {
        AngleX: binding([-1, 0, 1], [
          {
            warpOffsets: gridOffsets(columns, rows, function (x, y) {
              return [-6 - y * 2 + x * 3, (x - 0.5) * 2.2];
            })
          },
          { warpOffsets: zeroGrid(columns, rows) },
          {
            warpOffsets: gridOffsets(columns, rows, function (x, y) {
              return [6 + y * 2 - (1 - x) * 3, -(x - 0.5) * 2.2];
            })
          }
        ]),
        AngleY: binding([-1, 0, 1], [
          {
            warpOffsets: gridOffsets(columns, rows, function (x, y) {
              return [(x - 0.5) * (1 - y) * 4, -7 + y * 4];
            })
          },
          { warpOffsets: zeroGrid(columns, rows) },
          {
            warpOffsets: gridOffsets(columns, rows, function (x, y) {
              return [-(x - 0.5) * y * 4, 7 - (1 - y) * 4];
            })
          }
        ])
      }
    });
    nodes.push({
      id: 'bust_warp',
      name: 'Bust local warp',
      type: 'warp',
      parentId: 'body_warp',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, drawOrder: 0 },
      warp: { x: chestX, y: chestY, width: chestWidth, height: chestHeight, columns: 2, rows: 2 },
      bindings: {
        Bust: binding([-1, 0, 1], [
          {
            warpOffsets: gridOffsets(2, 2, function (x, y) {
              var center = Math.max(0, 1 - Math.abs(x - 0.5) * 1.6);
              return [(x - 0.5) * center * -1.5, center * y * -4.5];
            })
          },
          { warpOffsets: zeroGrid(2, 2) },
          {
            warpOffsets: gridOffsets(2, 2, function (x, y) {
              var center = Math.max(0, 1 - Math.abs(x - 0.5) * 1.6);
              return [(x - 0.5) * center * 1.5, center * y * 5.5];
            })
          }
        ])
      }
    });

    var sourceGroupsByDomain = {};
    var sourceGroupMetadata = {};
    (sourceHierarchy && sourceHierarchy.groups || []).forEach(function (group) {
      sourceGroupMetadata[pathKey(group.path)] = group;
    });

    function ensureSourceGroupChain(groupPath, domainParentId) {
      var currentParentId = domainParentId;
      for (var index = 0; index < groupPath.length; index++) {
        var currentPath = groupPath.slice(0, index + 1);
        var key = domainParentId + '|' + pathKey(currentPath);
        if (!sourceGroupsByDomain[key]) {
          var sourceGroup = sourceGroupMetadata[pathKey(currentPath)] || {};
          var sourceOpacity = sourceGroup.opacity == null ? 1 : Number(sourceGroup.opacity);
          if (sourceOpacity > 1) sourceOpacity /= 255;
          if (!Number.isFinite(sourceOpacity)) sourceOpacity = 1;
          var groupId = stablePathId('group_' + slug(domainParentId), currentPath);
          nodes.push({
            id: groupId,
            name: currentPath[currentPath.length - 1].name,
            type: 'group',
            parentId: currentParentId,
            visible: sourceGroup.visible !== false,
            source: {
              kind: 'psd-group',
              path: currentPath,
              domainParentId: domainParentId,
              blendMode: sourceGroup.blendMode || 'normal'
            },
            transform: {
              x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
              opacity: Core.clamp(sourceOpacity, 0, 1), drawOrder: 0
            },
            bindings: {}
          });
          sourceGroupsByDomain[key] = groupId;
        }
        currentParentId = sourceGroupsByDomain[key];
      }
      return currentParentId;
    }

    rig.layers.forEach(function (layer, layerIndex) {
      var base = slug(layer.name);
      var sourceSuffix = layer.side ? '_' + layer.side.toLowerCase() : '';
      var partBase = layer.sourceId
        ? 'part_' + layer.sourceId.replace(/^source_layer_/, '') + sourceSuffix
        : 'part_' + base;
      var partId = uniqueId(partBase, usedIds);
      var textureId = 'tex_' + partId;
      textures.push({
        id: textureId,
        name: layer.name,
        width: layer.img.width,
        height: layer.img.height,
        src: imageDataToDataUrl(layer.img)
      });
      var meshColumns = Math.max(2, Math.min(5, Math.round(layer.w / 76)));
      var meshRows = Math.max(2, Math.min(6, Math.round(layer.h / 76)));
      var parentId = layer.group === 'head' ? 'head_warp' : 'body_warp';
      if (/^topwear/.test(base)) parentId = 'bust_warp';
      parentId = ensureSourceGroupChain(layer.sourceGroupPath || [], parentId);
      var part = {
        id: partId,
        name: layer.name,
        type: 'part',
        parentId: parentId,
        textureId: textureId,
        visible: layer.sourceVisible !== false,
        maskIds: [],
        source: {
          kind: 'psd-layer',
          sourceId: layer.sourceId || null,
          path: layer.sourcePath || [{ name: layer.name, occurrence: 1 }],
          groupPath: layer.sourceGroupPath || []
        },
        transform: {
          x: layer.x,
          y: layer.y,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
          drawOrder: layerIndex * 10
        },
        mesh: Core.createRectMesh(layer.w, layer.h, meshColumns, meshRows),
        bindings: {}
      };

      var eyeParameter = layer.side === 'L' ? 'EyeOpenL' : layer.side === 'R' ? 'EyeOpenR' : null;
      if (eyeParameter && layer.fade === 'eyeOpen') {
        part.bindings[eyeParameter] = binding([0, 1], [{ opacity: 0 }, { opacity: 1 }]);
      }
      if (eyeParameter && layer.fade === 'eyeClose') {
        part.transform.opacity = 0;
        part.bindings[eyeParameter] = binding([0, 1], [{ opacity: 1 }, { opacity: 0 }]);
      }
      if (layer.fade === 'mouthOpen') {
        part.transform.opacity = 0;
        part.bindings.MouthOpen = binding([0, 1], [{ opacity: 0 }, { opacity: 1 }]);
      }
      if (layer.fade === 'mouthClose') {
        part.bindings.MouthOpen = binding([0, 1], [{ opacity: 1 }, { opacity: 0 }]);
      }
      nodes.push(part);
      byOriginalName[layer.name] = part;
    });

    (sourceHierarchy && sourceHierarchy.groups || []).forEach(function (group) {
      var represented = Object.keys(sourceGroupsByDomain).some(function (key) {
        return key.slice(key.indexOf('|') + 1) === pathKey(group.path);
      });
      if (!represented) ensureSourceGroupChain(group.path, 'body_warp');
    });

    nodes.forEach(function (node) {
      if (node.type !== 'part' || node.name.indexOf('irides') !== 0) return;
      var suffix = /_l$/.test(node.name) ? '_l' : /_r$/.test(node.name) ? '_r' : '';
      var mask = byOriginalName['eyewhite' + suffix];
      if (mask) node.maskIds = [mask.id];
    });

    return {
      version: Core.VERSION,
      meta: {
        name: sourceName || 'ABC Succubus sample',
        generator: 'Free Rig Studio core P1',
        source: 'PSD semantic layers',
        sourceHierarchy: {
          groups: sourceHierarchy ? sourceHierarchy.groups.length : 0,
          layers: sourceHierarchy ? sourceHierarchy.leaves.length : rig.layers.length
        }
      },
      canvas: { width: rig.canvas.w, height: rig.canvas.h },
      parameters: [
        { id: 'AngleX', name: 'Angle X', min: -1, max: 1, default: 0 },
        { id: 'AngleY', name: 'Angle Y', min: -1, max: 1, default: 0 },
        { id: 'AngleZ', name: 'Angle Z', min: -1, max: 1, default: 0 },
        { id: 'BodyAngle', name: 'Body angle', min: -1, max: 1, default: 0 },
        { id: 'EyeOpenL', name: 'Left eye open', min: 0, max: 1, default: 1 },
        { id: 'EyeOpenR', name: 'Right eye open', min: 0, max: 1, default: 1 },
        { id: 'MouthOpen', name: 'Mouth open', min: 0, max: 1, default: 0 },
        { id: 'Breath', name: 'Breath', min: 0, max: 1, default: 0 },
        { id: 'Bust', name: 'Bust spring', min: -1, max: 1, default: 0 }
      ],
      textures: textures,
      nodes: nodes,
      physics: [{
        id: 'physics_bust',
        name: 'Bust follow-through',
        enabled: true,
        inputs: [{ parameterId: 'Breath', center: 0, weight: 1 }],
        outputs: [{ parameterId: 'Bust', scale: 0.55, offset: 0 }],
        settings: { stiffness: 24, damping: 4.2, mass: 1 }
      }]
    };
  }

  function RigRenderer(canvas) {
    var gl = canvas.getContext('webgl', {
      alpha: true,
      stencil: true,
      antialias: true,
      premultipliedAlpha: true
    });
    if (!gl) throw new Error('WebGL is unavailable');

    function shader(type, source) {
      var instance = gl.createShader(type);
      gl.shaderSource(instance, source);
      gl.compileShader(instance);
      if (!gl.getShaderParameter(instance, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(instance));
      }
      return instance;
    }

    var program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER,
      'attribute vec2 aPosition;' +
      'attribute vec2 aUv;' +
      'uniform vec2 uResolution;' +
      'varying vec2 vUv;' +
      'void main(){' +
      'vUv=aUv;' +
      'vec2 clip=aPosition/uResolution*2.0-1.0;' +
      'gl_Position=vec4(clip.x,-clip.y,0.0,1.0);' +
      '}'));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER,
      'precision mediump float;' +
      'varying vec2 vUv;' +
      'uniform sampler2D uTexture;' +
      'uniform float uOpacity;' +
      'uniform float uAlphaCutoff;' +
      'void main(){' +
      'vec4 color=texture2D(uTexture,vUv);' +
      'if(color.a<uAlphaCutoff) discard;' +
      'gl_FragColor=color*uOpacity;' +
      '}'));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);
    var positionLocation = gl.getAttribLocation(program, 'aPosition');
    var uvLocation = gl.getAttribLocation(program, 'aUv');
    var resolutionLocation = gl.getUniformLocation(program, 'uResolution');
    var opacityLocation = gl.getUniformLocation(program, 'uOpacity');
    var cutoffLocation = gl.getUniformLocation(program, 'uAlphaCutoff');
    gl.enableVertexAttribArray(positionLocation);
    gl.enableVertexAttribArray(uvLocation);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    var positionBuffer = gl.createBuffer();
    var uvBuffer = gl.createBuffer();
    var indexBuffer = gl.createBuffer();
    var textures = {};

    function createTexture(image) {
      var texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return texture;
    }

    this.setModel = async function (nextModel) {
      Object.keys(textures).forEach(function (id) { gl.deleteTexture(textures[id]); });
      textures = {};
      await Promise.all(nextModel.textures.map(function (entry) {
        return new Promise(function (resolve, reject) {
          var image = new Image();
          image.onload = function () {
            textures[entry.id] = createTexture(image);
            resolve();
          };
          image.onerror = function () { reject(new Error('texture load failed: ' + entry.id)); };
          image.src = entry.src;
        });
      }));
    };

    function flattenPairs(pairs) {
      var array = new Float32Array(pairs.length * 2);
      pairs.forEach(function (pair, index) {
        array[index * 2] = pair[0];
        array[index * 2 + 1] = pair[1];
      });
      return array;
    }

    function flattenTriangles(triangles) {
      var array = new Uint16Array(triangles.length * 3);
      triangles.forEach(function (triangle, index) {
        array[index * 3] = triangle[0];
        array[index * 3 + 1] = triangle[1];
        array[index * 3 + 2] = triangle[2];
      });
      return array;
    }

    function drawPart(part, opacity, cutoff) {
      var texture = textures[part.textureId];
      if (!texture) return;
      var positions = flattenPairs(part.positions);
      var uvs = flattenPairs(part.uvs);
      var indices = flattenTriangles(part.triangles);
      gl.uniform1f(opacityLocation, opacity);
      gl.uniform1f(cutoffLocation, cutoff);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
      gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    }

    this.render = function (nextModel, result) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      gl.uniform2f(resolutionLocation, nextModel.canvas.width, nextModel.canvas.height);
      var partsById = {};
      result.parts.forEach(function (part) { partsById[part.id] = part; });

      result.parts.forEach(function (part) {
        if (!part.visible || part.opacity < 0.002) return;
        if (!part.maskIds.length) {
          drawPart(part, part.opacity, 0);
          return;
        }

        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.enable(gl.STENCIL_TEST);
        gl.stencilMask(0xff);
        gl.stencilFunc(gl.ALWAYS, 1, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        gl.colorMask(false, false, false, false);
        part.maskIds.forEach(function (maskId) {
          var mask = partsById[maskId];
          if (mask) drawPart(mask, 1, 0.08);
        });

        gl.colorMask(true, true, true, true);
        gl.stencilMask(0);
        gl.stencilFunc(gl.EQUAL, 1, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        drawPart(part, part.opacity, 0);
        gl.stencilMask(0xff);
        gl.disable(gl.STENCIL_TEST);
      });
    };
  }

  function defaultParameters() {
    var result = {};
    if (!model) return result;
    model.parameters.forEach(function (parameter) { result[parameter.id] = parameter.default; });
    return result;
  }

  function evaluateAndRender() {
    if (!model || !evaluator || !renderer) return;
    evaluated = evaluator.evaluate(parameterValues);
    renderer.render(model, evaluated);
    drawOverlay();
    window.__freeRigDebug = {
      modelName: model.meta && model.meta.name,
      parameterValues: Object.assign({}, parameterValues),
      selectedId: selectedId,
      partCount: evaluated.parts.length,
      nodeCount: model.nodes.length,
      sourceHierarchy: model.meta && model.meta.sourceHierarchy,
      physics: {
        enabled: physicsEnabled,
        groups: (model.physics || []).length,
        states: physicsRuntime ? physicsRuntime.getStates() : {}
      },
      validation: Core.validateModel(model)
    };
  }

  function rebuildEvaluator() {
    evaluator = Core.createEvaluator(model);
    physicsRuntime = Core.createPhysicsRuntime(model);
    evaluateAndRender();
    renderOutliner();
    renderValidation();
    updateStats();
    renderPhysicsInspector();
  }

  async function setModel(nextModel) {
    var validation = Core.validateModel(nextModel);
    if (!validation.ok) throw new Error(validation.errors.join('\n'));
    model = nextModel;
    parameterValues = defaultParameters();
    selectedId = model.nodes.length ? model.nodes[0].id : null;
    renderCanvas.width = overlayCanvas.width = model.canvas.width;
    renderCanvas.height = overlayCanvas.height = model.canvas.height;
    renderCanvas.style.aspectRatio = overlayCanvas.style.aspectRatio =
      model.canvas.width + ' / ' + model.canvas.height;
    document.getElementById('emptyState').hidden = true;
    document.getElementById('modelName').textContent =
      (model.meta && model.meta.name ? model.meta.name : 'UNTITLED').toUpperCase();
    setStatus('Textureを準備中…');
    await renderer.setModel(model);
    evaluator = Core.createEvaluator(model);
    physicsRuntime = Core.createPhysicsRuntime(model);
    selectedPhysicsId = model.physics && model.physics.length ? model.physics[0].id : null;
    renderParameters();
    renderOutliner();
    selectNode(selectedId);
    renderPhysicsInspector();
    renderValidation();
    updateStats();
    evaluateAndRender();
    setStatus('モデル読込完了');
  }

  async function loadPsdBuffer(buffer, name) {
    if (!window.agPsd || !window.Rigger) throw new Error('PSD parser is unavailable');
    setStatus('PSDをPartsへ変換中…');
    var psd = window.agPsd.readPsd(new Uint8Array(buffer), {
      useImageData: true,
      skipThumbnail: true
    });
    var sourceHierarchy = inspectPsdHierarchy(psd);
    var flattenedPsd = flattenPsdForRigger(psd, sourceHierarchy);
    window.Rigger.cleanPsdLayers(flattenedPsd);
    var rig = window.Rigger.buildRig(flattenedPsd, {});
    var nextModel = createSampleModel(rig, name || 'Imported PSD', sourceHierarchy);
    await setModel(nextModel);
  }

  async function loadSample() {
    try {
      setStatus('ABCサンプルPSDを取得中…');
      var response = await fetch('../assets/abc_succubus_rig_v4.psd');
      if (!response.ok) throw new Error('sample PSD HTTP ' + response.status);
      await loadPsdBuffer(await response.arrayBuffer(), 'ABC Succubus / Free Rig P1');
    } catch (error) {
      setStatus('読込失敗: ' + error.message);
      throw error;
    }
  }

  function childrenOf(parentId) {
    return model.nodes.filter(function (node) { return (node.parentId || null) === parentId; });
  }

  function renderOutliner() {
    var root = document.getElementById('outliner');
    root.innerHTML = '';
    if (!model) return;

    function append(parentId, depth) {
      childrenOf(parentId).forEach(function (node) {
        var button = document.createElement('button');
        button.className = 'tree-node' + (node.id === selectedId ? ' selected' : '');
        button.style.setProperty('--depth', depth);
        button.dataset.nodeId = node.id;
        button.setAttribute('role', 'treeitem');
        var icon = node.type === 'part' ? '◆'
          : node.type === 'warp' ? '▦'
            : node.type === 'group' ? '▣' : '◉';
        button.innerHTML =
          '<span class="tree-icon">' + icon + '</span>' +
          '<span class="tree-name"></span>' +
          '<span class="tree-type">' + node.type + '</span>';
        button.querySelector('.tree-name').textContent = node.name;
        button.addEventListener('click', function () { selectNode(node.id); });
        root.appendChild(button);
        append(node.id, depth + 1);
      });
    }
    append(null, 0);
    document.getElementById('nodeCount').textContent = model.nodes.length;
  }

  function renderParameters() {
    var container = document.getElementById('parameters');
    container.innerHTML = '';
    if (!model) return;
    model.parameters.forEach(function (parameter) {
      var row = document.createElement('div');
      row.className = 'parameter';
      var label = document.createElement('label');
      var input = document.createElement('input');
      var output = document.createElement('output');
      label.textContent = parameter.name;
      input.type = 'range';
      input.min = parameter.min;
      input.max = parameter.max;
      input.step = (parameter.max - parameter.min) / 200;
      input.value = parameterValues[parameter.id];
      input.dataset.parameterId = parameter.id;
      output.value = Number(input.value).toFixed(2);
      input.addEventListener('input', function () {
        parameterValues[parameter.id] = Number(input.value);
        output.value = Number(input.value).toFixed(2);
        refreshKeyInspector();
        evaluateAndRender();
      });
      row.append(label, input, output);
      container.appendChild(row);
    });
    renderKeyParameterOptions();
  }

  function resetParameters() {
    if (!model) return;
    parameterValues = defaultParameters();
    document.querySelectorAll('.parameter input').forEach(function (input) {
      var id = input.dataset.parameterId;
      input.value = parameterValues[id];
      input.parentNode.querySelector('output').value = Number(input.value).toFixed(2);
    });
    if (physicsRuntime) physicsRuntime.reset();
    refreshKeyInspector();
    evaluateAndRender();
  }

  function selectNode(id) {
    if (!model) return;
    selectedId = id;
    meshEditing = false;
    warpEditing = false;
    draggedWarpPoint = -1;
    updateMeshButton();
    updateWarpButton();
    renderOutliner();
    renderInspector();
    evaluateAndRender();
  }

  function selectedNode() {
    return model && model.nodes.find(function (node) { return node.id === selectedId; });
  }

  function renderInspector() {
    var node = selectedNode();
    document.getElementById('inspectorEmpty').hidden = Boolean(node);
    document.getElementById('inspector').hidden = !node;
    if (!node) return;
    document.getElementById('selectedName').textContent = node.name;
    document.getElementById('selectedType').textContent = node.type;
    var transform = Core.identityTransform(node.transform);
    document.getElementById('baseX').value = transform.x;
    document.getElementById('baseY').value = transform.y;
    document.getElementById('baseRotation').value = transform.rotation;
    document.getElementById('baseOpacity').value = transform.opacity;
    document.getElementById('drawOrder').value = transform.drawOrder;
    document.getElementById('nodeVisible').checked = node.visible !== false;
    document.getElementById('maskField').hidden = node.type !== 'part';
    document.getElementById('warpEditor').hidden = node.type !== 'warp';

    var parent = document.getElementById('parentId');
    parent.innerHTML = '<option value="">— root —</option>';
    model.nodes.forEach(function (candidate) {
      if (candidate.id === node.id || candidate.type === 'part') return;
      var option = document.createElement('option');
      option.value = candidate.id;
      option.textContent = candidate.name + ' (' + candidate.type + ')';
      option.selected = node.parentId === candidate.id;
      parent.appendChild(option);
    });

    var mask = document.getElementById('maskId');
    mask.innerHTML = '<option value="">— none —</option>';
    model.nodes.forEach(function (candidate) {
      if (candidate.type !== 'part' || candidate.id === node.id) return;
      var option = document.createElement('option');
      option.value = candidate.id;
      option.textContent = candidate.name;
      option.selected = node.maskIds && node.maskIds[0] === candidate.id;
      mask.appendChild(option);
    });
    renderKeyParameterOptions();
    refreshKeyInspector();
  }

  function renderKeyParameterOptions() {
    var select = document.getElementById('keyParameter');
    if (!select || !model) return;
    var current = select.value;
    select.innerHTML = '';
    model.parameters.forEach(function (parameter) {
      var option = document.createElement('option');
      option.value = parameter.id;
      option.textContent = parameter.name;
      select.appendChild(option);
    });
    if (model.parameters.some(function (parameter) { return parameter.id === current; })) {
      select.value = current;
    }
  }

  function selectedPhysicsGroup() {
    return model && (model.physics || []).find(function (group) {
      return group.id === selectedPhysicsId;
    });
  }

  function fillParameterSelect(select, selectedParameterId) {
    select.innerHTML = '';
    (model.parameters || []).forEach(function (parameter) {
      var option = document.createElement('option');
      option.value = parameter.id;
      option.textContent = parameter.name;
      option.selected = parameter.id === selectedParameterId;
      select.appendChild(option);
    });
  }

  function renderPhysicsInspector() {
    var select = document.getElementById('physicsGroup');
    var empty = document.getElementById('physicsEmpty');
    var inspector = document.getElementById('physicsInspector');
    if (!model) {
      select.innerHTML = '';
      empty.hidden = false;
      inspector.hidden = true;
      return;
    }
    model.physics = model.physics || [];
    if (!selectedPhysicsGroup()) {
      selectedPhysicsId = model.physics.length ? model.physics[0].id : null;
    }
    select.innerHTML = '';
    model.physics.forEach(function (group) {
      var option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.name;
      option.selected = group.id === selectedPhysicsId;
      select.appendChild(option);
    });
    document.getElementById('physicsCount').textContent = model.physics.length;
    var group = selectedPhysicsGroup();
    empty.hidden = Boolean(group);
    inspector.hidden = !group;
    if (!group) return;

    var input = group.inputs[0];
    var output = group.outputs[0];
    var settings = group.settings || {};
    document.getElementById('physicsName').value = group.name;
    fillParameterSelect(document.getElementById('physicsInput'), input.parameterId);
    fillParameterSelect(document.getElementById('physicsOutput'), output.parameterId);
    document.getElementById('physicsCenter').value = input.center == null ? 0 : input.center;
    document.getElementById('physicsWeight').value = input.weight == null ? 1 : input.weight;
    document.getElementById('physicsScale').value = output.scale == null ? 1 : output.scale;
    document.getElementById('physicsOffset').value = output.offset == null ? 0 : output.offset;
    document.getElementById('physicsStiffness').value = settings.stiffness;
    document.getElementById('physicsDamping').value = settings.damping;
    document.getElementById('physicsMass').value = settings.mass == null ? 1 : settings.mass;
    document.getElementById('physicsEnabled').checked = group.enabled !== false;
  }

  function addPhysicsGroup() {
    if (!model || model.parameters.length < 2) {
      setStatus('Physicsには2つ以上のParameterが必要です');
      return;
    }
    var used = {};
    (model.physics || []).forEach(function (group) { used[group.id] = true; });
    var id = uniqueId('physics_group', used);
    model.physics = model.physics || [];
    model.physics.push({
      id: id,
      name: 'Physics group ' + (model.physics.length + 1),
      enabled: true,
      inputs: [{
        parameterId: model.parameters[0].id,
        center: model.parameters[0].default,
        weight: 1
      }],
      outputs: [{
        parameterId: model.parameters[1].id,
        scale: 1,
        offset: 0
      }],
      settings: { stiffness: 20, damping: 4, mass: 1 }
    });
    selectedPhysicsId = id;
    rebuildEvaluator();
    setStatus('Physics groupを追加');
  }

  function deletePhysicsGroup() {
    if (!model || !selectedPhysicsGroup()) return;
    var deletingId = selectedPhysicsId;
    model.physics = model.physics.filter(function (group) { return group.id !== deletingId; });
    selectedPhysicsId = model.physics.length ? model.physics[0].id : null;
    rebuildEvaluator();
    setStatus('Physics groupを削除');
  }

  function applyPhysicsInspector() {
    var group = selectedPhysicsGroup();
    if (!group) return;
    var applied = safeMutation(function () {
      group.name = document.getElementById('physicsName').value.trim() || group.id;
      group.enabled = document.getElementById('physicsEnabled').checked;
      group.inputs = [{
        parameterId: document.getElementById('physicsInput').value,
        center: Number(document.getElementById('physicsCenter').value),
        weight: Number(document.getElementById('physicsWeight').value)
      }];
      group.outputs = [{
        parameterId: document.getElementById('physicsOutput').value,
        scale: Number(document.getElementById('physicsScale').value),
        offset: Number(document.getElementById('physicsOffset').value)
      }];
      group.settings = {
        stiffness: Number(document.getElementById('physicsStiffness').value),
        damping: Number(document.getElementById('physicsDamping').value),
        mass: Number(document.getElementById('physicsMass').value)
      };
    });
    setStatus(applied ? 'Physics設定を反映' : 'Physics設定を反映できませんでした');
  }

  function safeMutation(callback) {
    var backup = Core.importModel(Core.exportModel(model));
    callback();
    var validation = Core.validateModel(model);
    if (!validation.ok) {
      model = backup;
      alert(validation.errors.join('\n'));
      evaluator = Core.createEvaluator(model);
      physicsRuntime = Core.createPhysicsRuntime(model);
      renderOutliner();
      renderInspector();
      renderPhysicsInspector();
      renderValidation();
      updateStats();
      evaluateAndRender();
      return false;
    }
    rebuildEvaluator();
    renderInspector();
    return true;
  }

  function applyBaseInspector() {
    var node = selectedNode();
    if (!node) return;
    safeMutation(function () {
      node.parentId = document.getElementById('parentId').value || null;
      node.transform = Core.identityTransform({
        x: Number(document.getElementById('baseX').value),
        y: Number(document.getElementById('baseY').value),
        rotation: Number(document.getElementById('baseRotation').value),
        scaleX: node.transform && node.transform.scaleX,
        scaleY: node.transform && node.transform.scaleY,
        pivotX: node.transform && node.transform.pivotX,
        pivotY: node.transform && node.transform.pivotY,
        opacity: Number(document.getElementById('baseOpacity').value),
        drawOrder: Number(document.getElementById('drawOrder').value)
      });
      node.visible = document.getElementById('nodeVisible').checked;
      if (node.type === 'part') {
        var maskId = document.getElementById('maskId').value;
        node.maskIds = maskId ? [maskId] : [];
      }
    });
  }

  function keyContext() {
    var node = selectedNode();
    var parameterId = document.getElementById('keyParameter').value;
    if (!node || !parameterId) return null;
    var parameter = model.parameters.find(function (item) { return item.id === parameterId; });
    return {
      node: node,
      parameter: parameter,
      value: parameterValues[parameterId]
    };
  }

  function findKey(bindingValue, value) {
    if (!bindingValue) return null;
    return bindingValue.keyforms.find(function (key) {
      return Math.abs(key.value - value) < 0.00001;
    }) || null;
  }

  function refreshKeyInspector() {
    if (!model || !selectedNode()) return;
    var context = keyContext();
    if (!context) return;
    var bindingValue = (context.node.bindings || {})[context.parameter.id];
    var key = findKey(bindingValue, context.value);
    var state = key ? key.state : {};
    document.getElementById('keyX').value = state.x == null ? 0 : state.x;
    document.getElementById('keyY').value = state.y == null ? 0 : state.y;
    document.getElementById('keyRotation').value = state.rotation == null ? 0 : state.rotation;
    document.getElementById('keyOpacity').value = state.opacity == null
      ? Core.identityTransform(context.node.transform).opacity : state.opacity;
    var badge = document.getElementById('keyState');
    badge.textContent = key ? 'KEY ' + Number(context.value).toFixed(2) : 'NO KEY';
    badge.className = 'status ' + (key ? 'pass' : 'waiting');
  }

  function saveCurrentKey() {
    var context = keyContext();
    if (!context) return;
    safeMutation(function () {
      context.node.bindings = context.node.bindings || {};
      var bindingValue = context.node.bindings[context.parameter.id];
      if (!bindingValue) {
        bindingValue = context.node.bindings[context.parameter.id] = {
          interpolation: 'smooth',
          keyforms: [{
            value: context.parameter.default,
            state: {
              x: 0,
              y: 0,
              rotation: 0,
              opacity: Core.identityTransform(context.node.transform).opacity
            }
          }]
        };
      }
      var key = findKey(bindingValue, context.value);
      if (!key) {
        key = { value: context.value, state: {} };
        bindingValue.keyforms.push(key);
      }
      key.state.x = Number(document.getElementById('keyX').value);
      key.state.y = Number(document.getElementById('keyY').value);
      key.state.rotation = Number(document.getElementById('keyRotation').value);
      key.state.opacity = Number(document.getElementById('keyOpacity').value);
      bindingValue.keyforms.sort(function (left, right) { return left.value - right.value; });
    });
  }

  function deleteCurrentKey() {
    var context = keyContext();
    if (!context) return;
    safeMutation(function () {
      var bindingValue = (context.node.bindings || {})[context.parameter.id];
      if (!bindingValue) return;
      bindingValue.keyforms = bindingValue.keyforms.filter(function (key) {
        return Math.abs(key.value - context.value) >= 0.00001;
      });
      if (!bindingValue.keyforms.length) delete context.node.bindings[context.parameter.id];
    });
  }

  function renderValidation() {
    var state = document.getElementById('validationState');
    var messages = document.getElementById('validationMessages');
    if (!model) return;
    var validation = Core.validateModel(model);
    var audit = [];
    if (validation.ok) {
      model.parameters.forEach(function (parameter) {
        [parameter.min, parameter.max].forEach(function (value) {
          var values = defaultParameters();
          values[parameter.id] = value;
          var result = evaluator.evaluate(values);
          result.parts.forEach(function (part) {
            part.positions.forEach(function (point) {
              if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
                audit.push('非数値頂点: ' + part.name + ' / ' + parameter.id);
              }
            });
          });
        });
      });
    }
    var errors = validation.errors.concat(audit);
    state.textContent = errors.length ? 'FAIL ' + errors.length : 'PASS';
    state.className = 'status ' + (errors.length ? 'fail' : 'pass');
    messages.innerHTML = '';
    var lines = errors.length ? errors : [
      'ID・親子循環・参照整合性: PASS',
      '全Parameter極値の頂点有限性: PASS',
      'PSD source group: ' +
        (model.meta && model.meta.sourceHierarchy ? model.meta.sourceHierarchy.groups : 0) +
        ' / rig group node: ' +
        model.nodes.filter(function (node) { return node.type === 'group'; }).length,
      'Physics group: ' + (model.physics || []).length,
      '保存可能なschema v' + model.version
    ];
    lines.slice(0, 12).forEach(function (line) {
      var item = document.createElement('li');
      item.textContent = line;
      messages.appendChild(item);
    });
  }

  function updateStats() {
    if (!model) return;
    var validation = Core.validateModel(model);
    var parts = model.nodes.filter(function (node) { return node.type === 'part'; }).length;
    var groups = model.nodes.filter(function (node) { return node.type === 'group'; }).length;
    document.getElementById('runtimeStats').textContent =
      'parts ' + parts + ' / groups ' + groups +
      ' / params ' + model.parameters.length +
      ' / physics ' + (model.physics || []).length +
      ' / errors ' + validation.errors.length;
  }

  function nodeById(id) {
    return model && model.nodes.find(function (node) { return node.id === id; });
  }

  function invertWarpPoint(target, node, state) {
    var point = { x: target.x, y: target.y };
    for (var iteration = 0; iteration < 10; iteration++) {
      var warped = Core.applyWarp(point, node, state);
      point.x += target.x - warped.x;
      point.y += target.y - warped.y;
    }
    return point;
  }

  function projectNodePoint(node, point) {
    var projected = Core.transformPoint(
      Core.matrixFromTransform(evaluated.statesById[node.id]),
      point
    );
    var parent = node.parentId ? nodeById(node.parentId) : null;
    while (parent) {
      var parentState = evaluated.statesById[parent.id];
      if (parent.type === 'warp') projected = Core.applyWarp(projected, parent, parentState);
      projected = Core.transformPoint(Core.matrixFromTransform(parentState), projected);
      parent = parent.parentId ? nodeById(parent.parentId) : null;
    }
    return projected;
  }

  function unprojectNodePoint(node, point) {
    var chain = [];
    var parent = node.parentId ? nodeById(node.parentId) : null;
    while (parent) {
      chain.push(parent);
      parent = parent.parentId ? nodeById(parent.parentId) : null;
    }
    for (var index = chain.length - 1; index >= 0; index--) {
      var parentNode = chain[index];
      var parentState = evaluated.statesById[parentNode.id];
      point = Core.transformPoint(
        Core.invertMatrix(Core.matrixFromTransform(parentState)),
        point
      );
      if (parentNode.type === 'warp') point = invertWarpPoint(point, parentNode, parentState);
    }
    return Core.transformPoint(
      Core.invertMatrix(Core.matrixFromTransform(evaluated.statesById[node.id])),
      point
    );
  }

  function warpControlPoint(node, state, pointIndex) {
    var columns = node.warp.columns;
    var column = pointIndex % (columns + 1);
    var row = Math.floor(pointIndex / (columns + 1));
    return {
      x: node.warp.x + node.warp.width * column / columns + state.warpOffsets[pointIndex * 2],
      y: node.warp.y + node.warp.height * row / node.warp.rows + state.warpOffsets[pointIndex * 2 + 1]
    };
  }

  function drawOverlay() {
    overlay.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (!showMesh || !evaluated || !selectedNode()) return;
    var node = selectedNode();
    if (node.type === 'part') {
      var part = evaluated.parts.find(function (entry) { return entry.id === node.id; });
      if (!part) return;
      overlay.save();
      overlay.lineWidth = Math.max(1, model.canvas.width / 900);
      overlay.strokeStyle = 'rgba(241,204,131,.72)';
      overlay.fillStyle = 'rgba(88,208,201,.95)';
      part.triangles.forEach(function (triangle) {
        overlay.beginPath();
        triangle.forEach(function (vertexIndex, index) {
          var point = part.positions[vertexIndex];
          if (index === 0) overlay.moveTo(point[0], point[1]);
          else overlay.lineTo(point[0], point[1]);
        });
        overlay.closePath();
        overlay.stroke();
      });
      part.positions.forEach(function (point) {
        overlay.beginPath();
        overlay.arc(point[0], point[1], meshEditing ? 3.8 : 2.4, 0, Math.PI * 2);
        overlay.fill();
      });
      overlay.restore();
    } else if (node.type === 'warp') {
      var warp = node.warp;
      var state = evaluated.statesById[node.id];
      overlay.save();
      overlay.strokeStyle = 'rgba(209,164,91,.9)';
      overlay.fillStyle = 'rgba(209,164,91,.95)';
      overlay.lineWidth = Math.max(1, model.canvas.width / 900);
      for (var y = 0; y <= warp.rows; y++) {
        overlay.beginPath();
        for (var x = 0; x <= warp.columns; x++) {
          var index = (y * (warp.columns + 1) + x) * 2;
          var point = projectNodePoint(node, {
            x: warp.x + warp.width * x / warp.columns + state.warpOffsets[index],
            y: warp.y + warp.height * y / warp.rows + state.warpOffsets[index + 1]
          });
          if (x === 0) overlay.moveTo(point.x, point.y); else overlay.lineTo(point.x, point.y);
        }
        overlay.stroke();
      }
      for (var column = 0; column <= warp.columns; column++) {
        overlay.beginPath();
        for (var row = 0; row <= warp.rows; row++) {
          var pointIndex = (row * (warp.columns + 1) + column) * 2;
          var gridPoint = projectNodePoint(node, {
            x: warp.x + warp.width * column / warp.columns + state.warpOffsets[pointIndex],
            y: warp.y + warp.height * row / warp.rows + state.warpOffsets[pointIndex + 1]
          });
          if (row === 0) overlay.moveTo(gridPoint.x, gridPoint.y);
          else overlay.lineTo(gridPoint.x, gridPoint.y);
        }
        overlay.stroke();
      }
      var controlPointCount = (warp.columns + 1) * (warp.rows + 1);
      for (var controlIndex = 0; controlIndex < controlPointCount; controlIndex++) {
        var controlPoint = projectNodePoint(node, warpControlPoint(node, state, controlIndex));
        overlay.beginPath();
        overlay.arc(
          controlPoint.x,
          controlPoint.y,
          warpEditing ? 4.6 : 2.6,
          0,
          Math.PI * 2
        );
        overlay.fillStyle = controlIndex === draggedWarpPoint
          ? 'rgba(88,208,201,1)' : 'rgba(209,164,91,.95)';
        overlay.fill();
      }
      overlay.restore();
    }
  }

  function pointerToModel(event) {
    var rectangle = overlayCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rectangle.left) * overlayCanvas.width / rectangle.width,
      y: (event.clientY - rectangle.top) * overlayCanvas.height / rectangle.height
    };
  }

  function updateMeshButton() {
    var button = document.getElementById('meshEdit');
    button.setAttribute('aria-pressed', meshEditing ? 'true' : 'false');
    button.textContent = meshEditing ? '頂点編集を終了' : '頂点編集を開始';
    var badge = document.getElementById('meshState');
    badge.textContent = meshEditing ? 'ON' : 'OFF';
    badge.className = 'status ' + (meshEditing ? 'pass' : 'waiting');
  }

  function updateWarpButton() {
    var button = document.getElementById('warpEdit');
    var badge = document.getElementById('warpState');
    if (!button || !badge) return;
    button.setAttribute('aria-pressed', warpEditing ? 'true' : 'false');
    button.textContent = warpEditing ? 'Warp点編集を終了' : 'Warp点編集を開始';
    badge.textContent = warpEditing ? 'ON' : 'OFF';
    badge.className = 'status ' + (warpEditing ? 'pass' : 'waiting');
  }

  function toggleMeshEditing() {
    var node = selectedNode();
    if (!node || node.type !== 'part') {
      setStatus('Mesh編集はPartを選択してください');
      return;
    }
    if (!meshEditing) resetParameters();
    meshEditing = !meshEditing;
    updateMeshButton();
    drawOverlay();
  }

  function setParameterControl(parameterId, value) {
    parameterValues[parameterId] = value;
    var input = document.querySelector('input[data-parameter-id="' + parameterId + '"]');
    if (input) {
      input.value = value;
      input.parentNode.querySelector('output').value = Number(value).toFixed(2);
    }
  }

  function toggleWarpEditing() {
    var node = selectedNode();
    var context = keyContext();
    if (!node || node.type !== 'warp' || !context) {
      setStatus('Warp編集はWarp nodeとParameterを選択してください');
      return;
    }
    if (!warpEditing) {
      var editingValue = context.value;
      resetParameters();
      setParameterControl(context.parameter.id, editingValue);
      refreshKeyInspector();
      meshEditing = false;
      updateMeshButton();
      showMesh = true;
      document.getElementById('toggleMesh').classList.add('active');
      document.getElementById('toggleMesh').setAttribute('aria-pressed', 'true');
    }
    warpEditing = !warpEditing;
    draggedWarpPoint = -1;
    updateWarpButton();
    evaluateAndRender();
  }

  function updateWarpKeyPoint(node, pointIndex, localPoint) {
    var context = keyContext();
    if (!context) return;
    var pointCount = (node.warp.columns + 1) * (node.warp.rows + 1);
    var offsetLength = pointCount * 2;
    node.warp.baseOffsets = Core.normalizedOffsets(node.warp.baseOffsets, offsetLength);
    var column = pointIndex % (node.warp.columns + 1);
    var row = Math.floor(pointIndex / (node.warp.columns + 1));
    var basePoint = {
      x: node.warp.x + node.warp.width * column / node.warp.columns,
      y: node.warp.y + node.warp.height * row / node.warp.rows
    };
    var desiredOffset = [localPoint.x - basePoint.x, localPoint.y - basePoint.y];
    var offsetIndex = pointIndex * 2;

    if (Math.abs(context.value - context.parameter.default) < 0.00001) {
      node.warp.baseOffsets[offsetIndex] = desiredOffset[0];
      node.warp.baseOffsets[offsetIndex + 1] = desiredOffset[1];
      return;
    }

    node.bindings = node.bindings || {};
    var bindingValue = node.bindings[context.parameter.id];
    if (!bindingValue) {
      bindingValue = node.bindings[context.parameter.id] = {
        interpolation: 'smooth',
        keyforms: [{
          value: context.parameter.default,
          state: { warpOffsets: Core.createZeroOffsets(pointCount) }
        }]
      };
    }
    var neutralState = Core.sampleKeyforms(
      bindingValue.keyforms,
      context.parameter.default,
      bindingValue.interpolation
    );
    var neutralOffsets = Core.normalizedOffsets(neutralState.warpOffsets, offsetLength);
    var key = findKey(bindingValue, context.value);
    if (!key) {
      var sampled = Core.sampleKeyforms(
        bindingValue.keyforms,
        context.value,
        bindingValue.interpolation
      );
      key = {
        value: context.value,
        state: {
          warpOffsets: Core.normalizedOffsets(sampled.warpOffsets, offsetLength)
        }
      };
      bindingValue.keyforms.push(key);
      bindingValue.keyforms.sort(function (left, right) { return left.value - right.value; });
    }
    key.state.warpOffsets = Core.normalizedOffsets(key.state.warpOffsets, offsetLength);
    key.state.warpOffsets[offsetIndex] =
      desiredOffset[0] - node.warp.baseOffsets[offsetIndex] + neutralOffsets[offsetIndex];
    key.state.warpOffsets[offsetIndex + 1] =
      desiredOffset[1] - node.warp.baseOffsets[offsetIndex + 1] + neutralOffsets[offsetIndex + 1];
  }

  overlayCanvas.addEventListener('pointerdown', function (event) {
    if ((!meshEditing && !warpEditing) || !evaluated) return;
    var node = selectedNode();
    var point = pointerToModel(event);
    if (warpEditing && node.type === 'warp') {
      var warpState = evaluated.statesById[node.id];
      var pointCount = (node.warp.columns + 1) * (node.warp.rows + 1);
      var bestWarpDistance = Infinity;
      for (var pointIndex = 0; pointIndex < pointCount; pointIndex++) {
        var projected = projectNodePoint(node, warpControlPoint(node, warpState, pointIndex));
        var warpDistance = Math.hypot(projected.x - point.x, projected.y - point.y);
        if (warpDistance < bestWarpDistance) {
          bestWarpDistance = warpDistance;
          draggedWarpPoint = pointIndex;
        }
      }
      var warpThreshold = 16 * overlayCanvas.width / overlayCanvas.getBoundingClientRect().width;
      if (bestWarpDistance > warpThreshold) draggedWarpPoint = -1;
      if (draggedWarpPoint >= 0) overlayCanvas.setPointerCapture(event.pointerId);
      drawOverlay();
      return;
    }
    if (!meshEditing || node.type !== 'part') return;
    var part = evaluated.parts.find(function (entry) { return entry.id === node.id; });
    if (!part) return;
    var bestDistance = Infinity;
    part.positions.forEach(function (candidate, index) {
      var distance = Math.hypot(candidate[0] - point.x, candidate[1] - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        draggedVertex = index;
      }
    });
    var visualThreshold = 14 * overlayCanvas.width / overlayCanvas.getBoundingClientRect().width;
    if (bestDistance > visualThreshold) draggedVertex = -1;
    if (draggedVertex >= 0) overlayCanvas.setPointerCapture(event.pointerId);
  });

  overlayCanvas.addEventListener('pointermove', function (event) {
    var node = selectedNode();
    var point = pointerToModel(event);
    if (warpEditing && draggedWarpPoint >= 0 && node.type === 'warp') {
      updateWarpKeyPoint(node, draggedWarpPoint, unprojectNodePoint(node, point));
      evaluator = Core.createEvaluator(model);
      evaluateAndRender();
      return;
    }
    if (!meshEditing || draggedVertex < 0 || node.type !== 'part') return;
    point = unprojectNodePoint(node, point);
    node.mesh.vertices[draggedVertex] = [point.x, point.y];
    evaluator = Core.createEvaluator(model);
    evaluateAndRender();
  });

  function finishPointDrag() {
    if (draggedVertex >= 0) {
      draggedVertex = -1;
      renderValidation();
      setStatus('Mesh頂点を更新');
    }
    if (draggedWarpPoint >= 0) {
      draggedWarpPoint = -1;
      renderValidation();
      refreshKeyInspector();
      setStatus('Warp control pointを更新');
      drawOverlay();
    }
  }
  overlayCanvas.addEventListener('pointerup', finishPointDrag);
  overlayCanvas.addEventListener('pointercancel', finishPointDrag);

  function saveJson() {
    if (!model) return;
    var json = Core.exportModel(model);
    var url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = slug(model.meta && model.meta.name || 'free-rig-model') + '.freerig.json';
    anchor.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setStatus('JSONを保存');
  }

  async function loadJsonFile(file) {
    var nextModel = Core.importModel(await file.text());
    await setModel(nextModel);
  }

  function animate(now) {
    requestAnimationFrame(animate);
    frameCount++;
    if (now - fpsStarted > 500) {
      document.getElementById('fps').textContent =
        Math.round(frameCount * 1000 / (now - fpsStarted)) + ' fps';
      frameCount = 0;
      fpsStarted = now;
    }
    var dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!model) return;
    var changed = false;
    if (idleEnabled) {
      var time = now / 1000;
      parameterValues.AngleX = Math.sin(time * 0.52) * 0.22;
      parameterValues.AngleY = Math.sin(time * 0.37 + 0.8) * 0.12;
      parameterValues.AngleZ = Math.sin(time * 0.31 + 1.4) * 0.18;
      parameterValues.BodyAngle = Math.sin(time * 0.24) * 0.2;
      parameterValues.Breath = 0.5 + Math.sin(time * Math.PI * 2 / 3.6) * 0.5;
      changed = true;
    }
    if (physicsEnabled && physicsRuntime) {
      var physicsOutputs = physicsRuntime.step(parameterValues, dt);
      Object.keys(physicsOutputs).forEach(function (parameterId) {
        parameterValues[parameterId] = physicsOutputs[parameterId];
        changed = true;
      });
    }
    if (!changed) return;
    document.querySelectorAll('.parameter input').forEach(function (input) {
      var id = input.dataset.parameterId;
      if (parameterValues[id] == null) return;
      input.value = parameterValues[id];
      input.parentNode.querySelector('output').value = Number(input.value).toFixed(2);
    });
    evaluateAndRender();
  }

  document.getElementById('loadSample').addEventListener('click', loadSample);
  document.getElementById('emptyLoadSample').addEventListener('click', loadSample);
  document.getElementById('openPsd').addEventListener('click', function () {
    document.getElementById('psdInput').click();
  });
  document.getElementById('openJson').addEventListener('click', function () {
    document.getElementById('jsonInput').click();
  });
  document.getElementById('saveJson').addEventListener('click', saveJson);
  document.getElementById('resetParameters').addEventListener('click', resetParameters);
  document.getElementById('togglePhysics').addEventListener('click', function () {
    physicsEnabled = !physicsEnabled;
    this.setAttribute('aria-pressed', physicsEnabled ? 'true' : 'false');
    this.textContent = physicsEnabled ? 'Physics ON' : 'Physics OFF';
    if (!physicsEnabled) resetParameters();
  });
  document.getElementById('toggleIdle').addEventListener('click', function () {
    idleEnabled = !idleEnabled;
    this.setAttribute('aria-pressed', idleEnabled ? 'true' : 'false');
    this.textContent = idleEnabled ? 'Idle ON' : 'Idle OFF';
    if (!idleEnabled) resetParameters();
  });
  document.getElementById('toggleMesh').addEventListener('click', function () {
    showMesh = !showMesh;
    this.classList.toggle('active', showMesh);
    this.setAttribute('aria-pressed', showMesh ? 'true' : 'false');
    drawOverlay();
  });
  document.querySelectorAll('.view-mode').forEach(function (button) {
    button.addEventListener('click', function () {
      document.querySelectorAll('.view-mode').forEach(function (entry) {
        entry.classList.remove('active');
      });
      button.classList.add('active');
      stage.className = 'stage ' + button.dataset.background;
    });
  });
  document.getElementById('psdInput').addEventListener('change', async function (event) {
    var file = event.target.files[0];
    if (file) await loadPsdBuffer(await file.arrayBuffer(), file.name);
    event.target.value = '';
  });
  document.getElementById('jsonInput').addEventListener('change', async function (event) {
    var file = event.target.files[0];
    if (file) await loadJsonFile(file);
    event.target.value = '';
  });
  document.getElementById('applyBase').addEventListener('click', applyBaseInspector);
  document.getElementById('keyParameter').addEventListener('change', refreshKeyInspector);
  document.getElementById('saveKey').addEventListener('click', saveCurrentKey);
  document.getElementById('deleteKey').addEventListener('click', deleteCurrentKey);
  document.getElementById('meshEdit').addEventListener('click', toggleMeshEditing);
  document.getElementById('warpEdit').addEventListener('click', toggleWarpEditing);
  document.getElementById('physicsGroup').addEventListener('change', function () {
    selectedPhysicsId = this.value;
    renderPhysicsInspector();
  });
  document.getElementById('addPhysics').addEventListener('click', addPhysicsGroup);
  document.getElementById('deletePhysics').addEventListener('click', deletePhysicsGroup);
  document.getElementById('applyPhysics').addEventListener('click', applyPhysicsInspector);

  try {
    renderer = new RigRenderer(renderCanvas);
    setStatus('WebGL runtime ready');
  } catch (error) {
    setStatus(error.message);
    document.getElementById('validationState').textContent = 'WEBGL FAIL';
    document.getElementById('validationState').className = 'status fail';
  }

  window.__freeRigStudio = {
    loadSample: loadSample,
    loadPsdBuffer: loadPsdBuffer,
    inspectPsdHierarchy: inspectPsdHierarchy,
    setParameter: function (id, value) {
      parameterValues[id] = value;
      evaluateAndRender();
    },
    setPhysicsEnabled: function (value) {
      physicsEnabled = Boolean(value);
      if (!physicsEnabled && physicsRuntime) physicsRuntime.reset();
    },
    selectNode: selectNode,
    exportModel: function () { return model ? Core.exportModel(model) : null; },
    getModel: function () { return model; }
  };

  requestAnimationFrame(animate);
})();
