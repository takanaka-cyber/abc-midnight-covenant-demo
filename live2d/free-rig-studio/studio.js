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
  var idleEnabled = false;
  var lastFrame = performance.now();
  var frameCount = 0;
  var fpsStarted = lastFrame;
  var bustSpring = { value: 0, velocity: 0 };

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

  function createSampleModel(rig, sourceName) {
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

    rig.layers.forEach(function (layer, layerIndex) {
      var base = slug(layer.name);
      var partId = uniqueId('part_' + base, usedIds);
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
      var part = {
        id: partId,
        name: layer.name,
        type: 'part',
        parentId: parentId,
        textureId: textureId,
        visible: true,
        maskIds: [],
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
        generator: 'Free Rig Studio core P0',
        source: 'PSD semantic layers'
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
      nodes: nodes
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
      validation: Core.validateModel(model)
    };
  }

  function rebuildEvaluator() {
    evaluator = Core.createEvaluator(model);
    evaluateAndRender();
    renderOutliner();
    renderValidation();
    updateStats();
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
    renderParameters();
    renderOutliner();
    selectNode(selectedId);
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
    window.Rigger.cleanPsdLayers(psd);
    var rig = window.Rigger.buildRig(psd, {});
    var nextModel = createSampleModel(rig, name || 'Imported PSD');
    await setModel(nextModel);
  }

  async function loadSample() {
    try {
      setStatus('ABCサンプルPSDを取得中…');
      var response = await fetch('../assets/abc_succubus_rig_v4.psd');
      if (!response.ok) throw new Error('sample PSD HTTP ' + response.status);
      await loadPsdBuffer(await response.arrayBuffer(), 'ABC Succubus / Free Rig P0');
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
        var icon = node.type === 'part' ? '◆' : node.type === 'warp' ? '▦' : '◉';
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
    bustSpring.value = 0;
    bustSpring.velocity = 0;
    refreshKeyInspector();
    evaluateAndRender();
  }

  function selectNode(id) {
    if (!model) return;
    selectedId = id;
    meshEditing = false;
    updateMeshButton();
    renderOutliner();
    renderInspector();
    drawOverlay();
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

  function safeMutation(callback) {
    var backup = Core.importModel(Core.exportModel(model));
    callback();
    var validation = Core.validateModel(model);
    if (!validation.ok) {
      model = backup;
      alert(validation.errors.join('\n'));
      renderInspector();
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
    document.getElementById('runtimeStats').textContent =
      'parts ' + parts + ' / params ' + model.parameters.length + ' / errors ' + validation.errors.length;
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
      function projectControlPoint(point) {
        var projected = Core.transformPoint(Core.matrixFromTransform(state), point);
        var parent = node.parentId
          ? model.nodes.find(function (entry) { return entry.id === node.parentId; })
          : null;
        while (parent) {
          var parentState = evaluated.statesById[parent.id];
          if (parent.type === 'warp') projected = Core.applyWarp(projected, parent, parentState);
          projected = Core.transformPoint(Core.matrixFromTransform(parentState), projected);
          var parentId = parent.parentId;
          parent = parentId
            ? model.nodes.find(function (entry) { return entry.id === parentId; })
            : null;
        }
        return projected;
      }
      overlay.save();
      overlay.strokeStyle = 'rgba(209,164,91,.9)';
      overlay.fillStyle = 'rgba(209,164,91,.95)';
      overlay.lineWidth = Math.max(1, model.canvas.width / 900);
      for (var y = 0; y <= warp.rows; y++) {
        overlay.beginPath();
        for (var x = 0; x <= warp.columns; x++) {
          var index = (y * (warp.columns + 1) + x) * 2;
          var point = projectControlPoint({
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
          var gridPoint = projectControlPoint({
            x: warp.x + warp.width * column / warp.columns + state.warpOffsets[pointIndex],
            y: warp.y + warp.height * row / warp.rows + state.warpOffsets[pointIndex + 1]
          });
          if (row === 0) overlay.moveTo(gridPoint.x, gridPoint.y);
          else overlay.lineTo(gridPoint.x, gridPoint.y);
        }
        overlay.stroke();
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

  overlayCanvas.addEventListener('pointerdown', function (event) {
    if (!meshEditing || !evaluated) return;
    var node = selectedNode();
    var part = evaluated.parts.find(function (entry) { return entry.id === node.id; });
    if (!part) return;
    var point = pointerToModel(event);
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
    if (!meshEditing || draggedVertex < 0) return;
    var node = selectedNode();
    var point = pointerToModel(event);
    var chain = [];
    var current = node;
    while (current) {
      chain.push(current);
      var parentId = current.parentId;
      current = parentId
        ? model.nodes.find(function (entry) { return entry.id === parentId; })
        : null;
    }
    for (var index = chain.length - 1; index >= 0; index--) {
      var chainState = evaluated.statesById[chain[index].id];
      point = Core.transformPoint(
        Core.invertMatrix(Core.matrixFromTransform(chainState)),
        point
      );
    }
    node.mesh.vertices[draggedVertex] = [point.x, point.y];
    evaluator = Core.createEvaluator(model);
    evaluateAndRender();
  });

  function finishVertexDrag() {
    if (draggedVertex >= 0) {
      draggedVertex = -1;
      renderValidation();
      setStatus('Mesh頂点を更新');
    }
  }
  overlayCanvas.addEventListener('pointerup', finishVertexDrag);
  overlayCanvas.addEventListener('pointercancel', finishVertexDrag);

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
    if (!idleEnabled || !model) return;
    var time = now / 1000;
    parameterValues.AngleX = Math.sin(time * 0.52) * 0.22;
    parameterValues.AngleY = Math.sin(time * 0.37 + 0.8) * 0.12;
    parameterValues.AngleZ = Math.sin(time * 0.31 + 1.4) * 0.18;
    parameterValues.BodyAngle = Math.sin(time * 0.24) * 0.2;
    parameterValues.Breath = 0.5 + Math.sin(time * Math.PI * 2 / 3.6) * 0.5;
    var target = Math.sin(time * Math.PI * 2 / 3.6) * 0.36 + parameterValues.BodyAngle * 0.3;
    var acceleration = -24 * (bustSpring.value - target) - 4.2 * bustSpring.velocity;
    bustSpring.velocity += acceleration * dt;
    bustSpring.value += bustSpring.velocity * dt;
    parameterValues.Bust = Core.clamp(bustSpring.value, -1, 1);
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
    setParameter: function (id, value) {
      parameterValues[id] = value;
      evaluateAndRender();
    },
    selectNode: selectNode,
    exportModel: function () { return model ? Core.exportModel(model) : null; },
    getModel: function () { return model; }
  };

  requestAnimationFrame(animate);
})();
