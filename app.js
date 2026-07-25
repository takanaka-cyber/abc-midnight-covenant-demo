(() => {
  "use strict";

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const ASSETS = {
    neutral: "assets/character/succubus_STANDEE_live2d_v4.webp",
    smile: "assets/character/succubus_STANDEE_live2d_v4.webp",
    serious: "assets/character/succubus_STANDEE_live2d_v4.webp",
    concerned: "assets/character/succubus_STANDEE_live2d_v4.webp",
    alluring: "assets/character/succubus_STANDEE_live2d_v4.webp",
    bustEmphasis: "assets/character/succubus_EVENT_bust_emphasis_v1.png",
  };

  Object.values(ASSETS).forEach((src) => {
    const image = new Image();
    image.src = src;
  });

  const QUESTIONS = [
    {
      key: "concern",
      chapter: "SEAL I / SECRET",
      seal: "SEAL I",
      title: "秘密の輪郭",
      quest: "QUEST 01 / SECRET DESIRE",
      prompt: "いま、<em>いちばんほどきたい悩み</em>は？",
      line: "誰にも言えなかったこと、ここでは隠さなくていいわ。<em>私にだけ、そっと教えて？</em>",
      expression: "neutral",
      options: ["包茎について", "長さについて", "太さについて", "早さについて", "まだ決めていない"],
    },
    {
      key: "anxiety",
      chapter: "SEAL II / DEBUFF",
      seal: "SEAL II",
      title: "迷いの正体",
      quest: "QUEST 02 / DEBUFF SEARCH",
      prompt: "相談を止めている、<em>いちばん強い不安</em>は？",
      line: "怖いままでもいいの。あなたを止めているもの、<em>私と一緒にひとつずつほどきましょう。</em>",
      expression: "concerned",
      options: ["痛みへの不安", "金額・条件", "周囲に知られる", "医師の技術", "まだ整理できていない"],
    },
    {
      key: "priority",
      chapter: "SEAL III / SKILL",
      seal: "SEAL III",
      title: "必要な情報",
      quest: "QUEST 03 / SKILL SELECT",
      prompt: "相談前に、<em>最優先で確かめたいこと</em>は？",
      line: "もう半分まで来たわ。次は安心して踏み出すために、<em>私と確かめたいことを選んで？</em>",
      expression: "smile",
      options: ["治療の時間・流れ", "痛みへの配慮", "費用・支払い条件", "プライバシー・担当者", "まず全体を聞きたい"],
    },
    {
      key: "future",
      chapter: "SEAL IV / ROUTE",
      seal: "SEAL IV",
      title: "望むルート",
      quest: "QUEST 04 / ENDING ROUTE",
      prompt: "悩みを整理した先で、<em>どう過ごせたら嬉しい</em>？",
      line: "あと一枚で契約は完成。悩みを手放したあなたが、<em>私にどんな顔を見せてくれるのかしら？</em>",
      expression: "alluring",
      options: ["自分に自信を持つ", "温泉・サウナを楽しむ", "パートナーとの不安を減らす", "普段から気にせず過ごす", "まだ決めていない"],
    },
  ];

  const state = {
    index: 0,
    answers: {},
    sound: false,
    locked: false,
    audioContext: null,
  };

  const titleScreen = qs("#titleScreen");
  const game = qs("#game");
  const panel = qs("#panel");
  const dialogueText = qs("#dialogueText");
  const character = qs("#character");
  const characterRig = qs("#characterRig");
  const eventPose = qs("#eventPose");
  const stage = qs("#stage");
  const chapterLabel = qs("#chapterLabel");
  const chapterGate = qs("#chapterGate");
  const mapScreen = qs("#mapScreen");
  const bossScreen = qs("#bossScreen");
  const resultScreen = qs("#resultScreen");
  let rigReady = false;
  const pendingRigState = {
    expression: "neutral",
    talk: false,
    motion: null,
  };

  function postToRig(message) {
    if (message?.type === "anime25d-expression") pendingRigState.expression = message.name;
    if (message?.type === "anime25d-talk") pendingRigState.talk = Boolean(message.active);
    if (message?.type === "anime25d-motion") pendingRigState.motion = message.name;
    if (!rigReady || !characterRig?.contentWindow || reduceMotion.matches) return;
    characterRig.contentWindow.postMessage(message, window.location.origin);
    if (message?.type === "anime25d-motion") pendingRigState.motion = null;
  }

  window.addEventListener("message", (event) => {
    if (
      event.origin !== window.location.origin
      || event.source !== characterRig?.contentWindow
      || !event.data
    ) return;

    if (event.data.type === "anime25d-ready" && !reduceMotion.matches) {
      rigReady = true;
      stage.classList.add("is-rig-ready");
      postToRig({ type: "anime25d-fit" });
      postToRig({ type: "anime25d-expression", name: pendingRigState.expression });
      postToRig({ type: "anime25d-talk", active: pendingRigState.talk });
      if (pendingRigState.motion) {
        postToRig({ type: "anime25d-motion", name: pendingRigState.motion });
        pendingRigState.motion = null;
      }
    }
  });

  function createProgress() {
    const sealDots = qs("#sealDots");
    const mapNodes = qs("#mapNodes");
    for (let i = 0; i < QUESTIONS.length; i += 1) {
      const dot = document.createElement("span");
      dot.className = "seal-dot";
      dot.setAttribute("aria-hidden", "true");
      sealDots.appendChild(dot);

      const node = document.createElement("span");
      node.className = "map-node";
      node.innerHTML = `<span>${i + 1}</span>`;
      mapNodes.appendChild(node);
    }
  }

  function updateProgress() {
    const completed = Object.keys(state.answers).length;
    qsa(".seal-dot").forEach((dot, index) => {
      dot.classList.toggle("is-active", index < completed);
    });
    qsa(".map-node").forEach((node, index) => {
      node.classList.toggle("is-active", index < completed);
    });
  }

  function setExpression(key) {
    const next = ASSETS[key] || ASSETS.neutral;
    postToRig({ type: "anime25d-expression", name: key });
    if (character.getAttribute("src") === next) return;
    character.classList.add("is-swapping");
    window.setTimeout(() => {
      character.src = next;
      character.classList.remove("is-swapping");
    }, reduceMotion.matches ? 0 : 120);
  }

  function typeDialogue(html) {
    if (reduceMotion.matches) {
      postToRig({ type: "anime25d-talk", active: false });
      dialogueText.innerHTML = html;
      return Promise.resolve();
    }

    postToRig({ type: "anime25d-talk", active: true });
    const tokens = html.match(/<[^>]+>|./gs) || [];
    let index = 0;
    let output = "";
    dialogueText.innerHTML = "";

    return new Promise((resolve) => {
      const draw = () => {
        if (index >= tokens.length) {
          dialogueText.innerHTML = html;
          postToRig({ type: "anime25d-talk", active: false });
          resolve();
          return;
        }
        const token = tokens[index];
        output += token;
        dialogueText.innerHTML = output;
        index += 1;
        window.setTimeout(draw, token.startsWith("<") ? 0 : 17);
      };
      draw();
    });
  }

  function playEventPose() {
    if (!eventPose?.complete || !eventPose.naturalWidth) return;
    stage.classList.remove("is-event-pose");
    void stage.offsetWidth;
    stage.classList.add("is-event-pose");
    window.setTimeout(() => {
      stage.classList.remove("is-event-pose");
    }, reduceMotion.matches ? 500 : 3000);
  }

  function renderQuestion() {
    const question = QUESTIONS[state.index];
    if (!question) {
      showBoss();
      return;
    }

    state.locked = false;
    chapterLabel.textContent = question.chapter;
    stage.dataset.phase = String(state.index + 1);
    setExpression(question.expression);
    if (question.expression === "smile") {
      postToRig({ type: "anime25d-motion", name: "closer" });
    }
    if (question.expression === "alluring") {
      postToRig({ type: "anime25d-motion", name: "tempt" });
      playEventPose();
    }
    typeDialogue(question.line);

    panel.innerHTML = `
      <div class="quest-heading">
        <div class="quest-heading__main">
          <span>${question.quest}</span>
          <strong>${question.prompt}</strong>
        </div>
        <div class="quest-heading__count">${String(state.index + 1).padStart(2, "0")}<small>/04</small></div>
      </div>
      <div class="choices" role="group" aria-label="${question.prompt.replace(/<[^>]+>/g, "")}">
        ${question.options.map((option) => `
          <button class="choice" type="button" aria-pressed="false" data-value="${option}">${option}</button>
        `).join("")}
      </div>
      <p class="panel__privacy">回答はこの端末上で相談メモにまとめるためだけに使います。</p>
    `;

    qsa(".choice", panel).forEach((button) => {
      button.addEventListener("click", () => selectAnswer(button, question), { once: true });
    });
  }

  async function selectAnswer(button, question) {
    if (state.locked) return;
    state.locked = true;
    qsa(".choice", panel).forEach((item) => {
      item.disabled = true;
      item.setAttribute("aria-pressed", String(item === button));
      item.classList.toggle("is-selected", item === button);
    });

    state.answers[question.key] = button.dataset.value;
    updateProgress();
    playTone("select");
    setExpression("smile");
    postToRig({ type: "anime25d-motion", name: "nod" });

    await sleep(reduceMotion.matches ? 30 : 300);
    await showChapterGate(question);

    state.index += 1;
    if (state.index === 2) {
      await showMap();
    }
    renderQuestion();
  }

  async function showChapterGate(question) {
    qs("#chapterGateKicker").textContent = question.seal;
    qs("#chapterGateTitle").textContent = question.title;
    qs("#chapterGateStatus").textContent = `${Object.keys(state.answers).length} / 4 SEALS RELEASED`;
    chapterGate.classList.add("is-active");
    chapterGate.setAttribute("aria-hidden", "false");
    playTone("seal");
    burst(16);
    await sleep(reduceMotion.matches ? 90 : 1080);
    chapterGate.classList.remove("is-active");
    chapterGate.setAttribute("aria-hidden", "true");
    await sleep(reduceMotion.matches ? 10 : 180);
  }

  async function showMap() {
    updateProgress();
    mapScreen.classList.add("is-active");
    mapScreen.setAttribute("aria-hidden", "false");
    playTone("clear");
    await sleep(reduceMotion.matches ? 160 : 2400);
    mapScreen.classList.remove("is-active");
    mapScreen.setAttribute("aria-hidden", "true");
    await sleep(reduceMotion.matches ? 10 : 180);
  }

  function showBoss() {
    game.setAttribute("aria-hidden", "true");
    bossScreen.classList.add("is-active");
    bossScreen.setAttribute("aria-hidden", "false");
    qs("#ritualButton").focus();
    playTone("boss");
  }

  async function defeatBoss() {
    const ritualButton = qs("#ritualButton");
    const bossFill = qs("#bossFill");
    const bossPercent = qs("#bossPercent");
    const bossPortrait = qs("#bossPortrait");
    ritualButton.disabled = true;

    const values = [74, 46, 18, 0];
    bossPortrait.classList.add("is-hit");
    for (const value of values) {
      if (!reduceMotion.matches) {
        bossFill.animate(
          [{ width: `${Math.min(100, value + 26)}%` }, { width: `${value}%` }],
          { duration: 360, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" }
        );
      }
      bossFill.style.width = `${value}%`;
      bossPercent.textContent = `${value}%`;
      playTone("hit");
      burst(10);
      await sleep(reduceMotion.matches ? 20 : 360);
    }

    bossPortrait.classList.remove("is-hit");
    bossPortrait.classList.add("is-defeated");
    flash();
    playTone("clear");
    burst(34);
    await sleep(reduceMotion.matches ? 80 : 900);
    showResult();
  }

  function showResult() {
    bossScreen.classList.remove("is-active");
    bossScreen.setAttribute("aria-hidden", "true");
    resultScreen.classList.add("is-active");
    resultScreen.setAttribute("aria-hidden", "false");

    const labels = {
      concern: "相談したいこと",
      anxiety: "いちばんの不安",
      priority: "優先して確認",
      future: "望んでいること",
    };

    qs("#answerSummary").innerHTML = QUESTIONS.map((question) => `
      <div>
        <dt>${labels[question.key]}</dt>
        <dd>${state.answers[question.key] || "未回答"}</dd>
      </div>
    `).join("");

    resultScreen.scrollTop = 0;
    qs(".primary-cta").focus();
  }

  function resetExperience() {
    state.index = 0;
    state.answers = {};
    state.locked = false;
    resultScreen.classList.remove("is-active");
    resultScreen.setAttribute("aria-hidden", "true");
    bossScreen.classList.remove("is-active");
    qs("#bossFill").style.width = "100%";
    qs("#bossPercent").textContent = "100%";
    qs("#bossPortrait").classList.remove("is-hit", "is-defeated");
    qs("#ritualButton").disabled = false;
    game.setAttribute("aria-hidden", "false");
    updateProgress();
    renderQuestion();
    window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
  }

  function startExperience() {
    if (state.locked) return;
    state.locked = true;
    ensureAudio();
    titleScreen.classList.add("is-hidden");
    titleScreen.setAttribute("aria-hidden", "true");
    game.classList.add("is-active");
    game.setAttribute("aria-hidden", "false");
    window.setTimeout(() => postToRig({ type: "anime25d-fit" }), 0);
    playTone("clear");
    window.setTimeout(() => {
      titleScreen.hidden = true;
      state.locked = false;
      renderQuestion();
      qs(".choice", panel)?.focus();
    }, reduceMotion.matches ? 0 : 560);
  }

  function ensureAudio() {
    if (state.audioContext) return state.audioContext;
    try {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      state.audioContext = null;
    }
    return state.audioContext;
  }

  function playNote(frequency, duration, type = "sine", volume = 0.035, delay = 0) {
    if (!state.sound) return;
    const context = ensureAudio();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, context.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + delay + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(context.currentTime + delay);
    oscillator.stop(context.currentTime + delay + duration + 0.04);
  }

  function playTone(kind) {
    const patterns = {
      select: [[660, 0], [880, 0.07]],
      seal: [[392, 0], [523, 0.08], [784, 0.16]],
      boss: [[110, 0], [82, 0.12]],
      hit: [[180, 0], [130, 0.04]],
      clear: [[392, 0], [523, 0.08], [659, 0.16], [988, 0.24]],
    };
    (patterns[kind] || []).forEach(([frequency, delay]) => {
      playNote(frequency, kind === "boss" ? 0.32 : 0.16, kind === "hit" ? "sawtooth" : "sine", 0.035, delay);
    });
  }

  function toggleSound() {
    state.sound = !state.sound;
    const button = qs("#soundButton");
    button.textContent = state.sound ? "♪" : "♪̸";
    button.setAttribute("aria-pressed", String(state.sound));
    button.setAttribute("aria-label", state.sound ? "サウンドをオフにする" : "サウンドをオンにする");
    if (state.sound) {
      ensureAudio()?.resume?.();
      playTone("select");
    }
  }

  function flash() {
    const element = qs("#flash");
    element.classList.remove("is-active");
    void element.offsetWidth;
    element.classList.add("is-active");
  }

  const particles = [];
  const canvas = qs("#embers");
  const context = canvas.getContext("2d");
  let particleFrame = 0;

  function sizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function addParticle(x = Math.random() * window.innerWidth, y = window.innerHeight + 10, burstMode = false) {
    particles.push({
      x,
      y,
      vx: burstMode ? (Math.random() - 0.5) * 5 : (Math.random() - 0.5) * 0.4,
      vy: burstMode ? -2 - Math.random() * 5 : -0.35 - Math.random() * 0.55,
      radius: burstMode ? 1.4 + Math.random() * 2.2 : 0.7 + Math.random() * 1.2,
      life: 1,
      decay: burstMode ? 0.022 + Math.random() * 0.018 : 0.005 + Math.random() * 0.006,
      color: Math.random() > 0.42 ? "231,168,83" : "231,78,136",
    });
  }

  function burst(amount) {
    if (reduceMotion.matches) return;
    const x = window.innerWidth / 2;
    const y = window.innerHeight * 0.47;
    for (let i = 0; i < amount; i += 1) addParticle(x, y, true);
  }

  function animateParticles() {
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    particleFrame += 1;
    if (particles.length < 28 && particleFrame % 10 === 0) addParticle();

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const particle = particles[i];
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.life -= particle.decay;
      if (particle.life <= 0 || particle.y < -20) {
        particles.splice(i, 1);
        continue;
      }
      context.beginPath();
      context.fillStyle = `rgba(${particle.color},${particle.life})`;
      context.shadowColor = `rgba(${particle.color},0.65)`;
      context.shadowBlur = 8;
      context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      context.fill();
    }

    window.requestAnimationFrame(animateParticles);
  }

  createProgress();
  updateProgress();
  sizeCanvas();
  if (!reduceMotion.matches) animateParticles();

  qs("#startButton").addEventListener("click", startExperience);
  qs("#soundButton").addEventListener("click", toggleSound);
  qs("#ritualButton").addEventListener("click", defeatBoss, { once: true });
  qs("#restartButton").addEventListener("click", resetExperience);
  window.addEventListener("resize", sizeCanvas, { passive: true });
})();
