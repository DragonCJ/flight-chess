"use strict";

const COLOR_ORDER = ["red", "green", "yellow", "blue"];

const META = {
  red: { name: "红方", start: 39, corner: "bl", base: [[1, 11], [3, 11], [1, 13], [3, 13]] },
  green: { name: "绿方", start: 0, corner: "tl", base: [[1, 1], [3, 1], [1, 3], [3, 3]] },
  yellow: { name: "黄方", start: 13, corner: "tr", base: [[11, 1], [13, 1], [11, 3], [13, 3]] },
  blue: { name: "蓝方", start: 26, corner: "br", base: [[11, 11], [13, 11], [11, 13], [13, 13]] },
};

const MOD_COLOR = ["green", "yellow", "blue", "red"];
const GOAL = 57;
const PLANE_SVG = '<svg viewBox="-0.27 1 24 24" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 12 2a1.5 1.5 0 0 0-1.5 1.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>';

function rot90(c, r) {
  return [14 - r, c];
}

function buildRing() {
  const seg = [[0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0]];
  const ring = [];
  let cur = seg;
  for (let k = 0; k < 4; k++) {
    ring.push(...cur);
    cur = cur.map(([c, r]) => rot90(c, r));
  }
  return ring;
}

const RING = buildRing();

function laneFromStart(cell) {
  const [c, r] = cell;
  if (c === 0) return [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]];
  if (r === 0) return [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]];
  if (c === 14) return [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]];
  return [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]];
}

for (const color of COLOR_ORDER) {
  META[color].home = laneFromStart(RING[META[color].start]);
}

const SAFE = new Set([0, 13, 26, 39].map((i) => RING[i].join(",")));
const RING_AT = new Map(RING.map((p, i) => [p.join(","), i]));

const G = {
  phase: "setup",
  count: 2,
  control: { red: "human", green: "ai", yellow: "ai", blue: "ai" },
  active: ["red", "yellow"],
  turn: "red",
  dice: null,
  sixes: 0,
  moves: [],
  log: [],
  winner: null,
  sound: true,
  planes: [],
};

let playToken = 0;
let audioCtx = null;
let resumePhase = null;
let speaker = null;

function playerInk(color) {
  return { red: "#e23b3b", green: "#14924a", yellow: "#d4920a", blue: "#2f7cf6" }[color] || "#1c2430";
}

function activeOf(count) {
  if (count === 2) return ["red", "yellow"];
  if (count === 3) return ["red", "yellow", "blue"];
  return ["red", "green", "yellow", "blue"];
}

function turnOrder() {
  return COLOR_ORDER.filter((c) => G.active.includes(c));
}

function byId(id) {
  return G.planes.find((p) => p.id === id);
}

function cellFor(color, rel) {
  if (rel <= 51) return RING[(META[color].start + rel) % 52];
  return META[color].home[rel - 52];
}

function boardCell(plane) {
  if (!plane || plane.done || plane.rel == null) return null;
  return cellFor(plane.color, plane.rel);
}

function enemiesAt(mover, rel) {
  if (rel > 51) return [];
  const cell = cellFor(mover.color, rel);
  const key = cell.join(",");
  if (SAFE.has(key)) return [];
  const ids = [];
  for (const p of G.planes) {
    if (p === mover || p.done || p.rel == null || p.color === mover.color) continue;
    const loc = boardCell(p);
    if (loc && loc.join(",") === key) ids.push(p.id);
  }
  return ids;
}

function lineCells(a, b) {
  let x0 = a[0];
  let y0 = a[1];
  const x1 = b[0];
  const y1 = b[1];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  const cells = [];
  while (x0 !== x1 || y0 !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
    if (x0 === x1 && y0 === y1) break;
    cells.push([x0, y0]);
  }
  return cells;
}

function flyoverIds(mover) {
  const from = cellFor(mover.color, 16);
  const to = cellFor(mover.color, 28);
  const ids = [];
  for (const cell of lineCells(from, to)) {
    const key = cell.join(",");
    if (SAFE.has(key)) continue;
    for (const p of G.planes) {
      if (p === mover || p.done || p.rel == null || p.color === mover.color) continue;
      const loc = boardCell(p);
      if (loc && loc.join(",") === key) ids.push(p.id);
    }
  }
  return ids;
}

function specials(mover, rel) {
  const steps = [];
  if (rel > 51 || rel % 4 !== 0) return steps;

  const pushFly = () => {
    const over = flyoverIds(mover);
    const landed = enemiesAt(mover, 28);
    steps.push({ rel: 28, kind: "fly", captures: [...over, ...landed] });
  };

  if (rel === 16) {
    pushFly();
    const jumpRel = 32;
    steps.push({
      rel: jumpRel,
      kind: "jump",
      captures: enemiesAt(mover, jumpRel),
    });
    return steps;
  }

  const jumpRel = rel + 4;
  if (jumpRel > GOAL) return steps;
  steps.push({
    rel: jumpRel,
    kind: jumpRel === GOAL ? "finish" : "jump",
    captures: jumpRel <= 51 ? enemiesAt(mover, jumpRel) : [],
  });
  if (jumpRel === 16) pushFly();
  return steps;
}

function resolve(plane, dice) {
  if (!plane || plane.done || dice < 1 || dice > 6) return null;
  if (plane.rel == null) {
    if (dice !== 6) return null;
    return [{ rel: 0, kind: "takeoff", captures: enemiesAt(plane, 0) }];
  }

  const steps = [];
  const target = plane.rel + dice;
  if (target <= GOAL) {
    for (let rel = plane.rel + 1; rel <= target; rel++) {
      let kind = "pass";
      if (rel === GOAL) kind = "finish";
      else if (rel === target) kind = "land";
      steps.push({
        rel,
        kind,
        captures: rel === target && rel <= 51 ? enemiesAt(plane, rel) : [],
      });
    }
    if (target <= 51) steps.push(...specials(plane, target));
    return steps;
  }

  for (let rel = plane.rel + 1; rel <= GOAL; rel++) {
    steps.push({ rel, kind: "pass", captures: [] });
  }
  const extra = target - GOAL;
  for (let i = 1; i <= extra; i++) {
    steps.push({ rel: GOAL - i, kind: i === extra ? "bounce" : "pass", captures: [] });
  }
  return steps;
}

function legalMoves(color, dice) {
  const moves = [];
  for (const plane of G.planes) {
    if (plane.color !== color || plane.done) continue;
    const steps = resolve(plane, dice);
    if (steps) moves.push({ id: plane.id, steps });
  }
  return moves;
}

function chooseMove(moves) {
  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const last = move.steps[move.steps.length - 1];
    const caps = new Set(move.steps.flatMap((s) => s.captures));
    let score = last.rel;
    if (move.steps.some((s) => s.kind === "finish")) score += 500;
    score += caps.size * 80;
    if (move.steps.some((s) => s.kind === "takeoff")) score += 36;
    if (move.steps.some((s) => s.kind === "fly")) score += 24;
    if (move.steps.some((s) => s.kind === "jump")) score += 8;
    if (move.steps.some((s) => s.kind === "bounce")) score -= 4;
    score += Math.random() * 2;
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

function leadPlane(color) {
  const out = G.planes.filter((p) => p.color === color && !p.done && p.rel != null);
  out.sort((a, b) => b.rel - a.rel);
  return out[0] || null;
}

function adjacent(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
}

function selfCheck() {
  if (RING.length !== 52) throw new Error("ring length");
  if (new Set(RING.map((p) => p.join(","))).size !== 52) throw new Error("ring dup");

  const used = new Set(RING.map((p) => p.join(",")));
  for (const color of COLOR_ORDER) {
    const home = META[color].home;
    if (home.length !== 6) throw new Error("home " + color);
    for (const cell of home) {
      if (used.has(cell.join(","))) throw new Error("home overlap " + color);
    }
    const approach = RING[(META[color].start + 51) % 52];
    if (!adjacent(approach, home[0])) throw new Error("home entry " + color);
    if ((META[color].start + 16) % 4 !== META[color].start % 4) throw new Error("fly color " + color);
  }

  G.planes = [];
  for (const color of COLOR_ORDER) {
    for (let slot = 0; slot < 4; slot++) {
      G.planes.push({ id: color + slot, color, slot, rel: null, done: false });
    }
  }
  const green = G.planes.find((p) => p.color === "green" && p.slot === 0);
  const before = green.rel;

  if (resolve(green, 5) !== null) throw new Error("takeoff without 6");
  const takeoff = resolve(green, 6);
  if (!takeoff || takeoff.length !== 1 || takeoff[0].rel !== 0 || takeoff[0].kind !== "takeoff") {
    throw new Error("takeoff");
  }
  if (green.rel !== before) throw new Error("resolve mutated");

  green.rel = 0;
  let steps = resolve(green, 4);
  if (steps.map((s) => s.rel).join(",") !== "1,2,3,4,8") throw new Error("jump " + steps.map((s) => s.rel));

  green.rel = 12;
  steps = resolve(green, 4);
  if (steps.map((s) => s.rel).join(",") !== "13,14,15,16,28,32") throw new Error("fly walk " + steps.map((s) => s.rel));

  green.rel = 8;
  steps = resolve(green, 4);
  if (steps.map((s) => s.rel).join(",") !== "9,10,11,12,16,28") throw new Error("fly jump " + steps.map((s) => s.rel));

  green.rel = 44;
  steps = resolve(green, 4);
  if (steps[steps.length - 1].rel !== 52 || steps[steps.length - 1].kind !== "jump") throw new Error("jump home");

  green.rel = 51;
  steps = resolve(green, 6);
  if (steps[steps.length - 1].kind !== "finish" || steps[steps.length - 1].rel !== 57) throw new Error("finish");

  green.rel = 56;
  steps = resolve(green, 6);
  if (steps.some((s) => s.kind === "finish")) throw new Error("bounce marked finish");
  if (steps[steps.length - 1].rel !== 52 || steps[steps.length - 1].kind !== "bounce") throw new Error("bounce");

  green.rel = 3;
  const blue = G.planes.find((p) => p.color === "blue" && p.slot === 0);
  blue.rel = (5 - META.blue.start + 52) % 52;
  if (cellFor("blue", blue.rel).join(",") !== cellFor("green", 5).join(",")) throw new Error("capture setup");
  steps = resolve(green, 2);
  if (!steps[steps.length - 1].captures.includes(blue.id)) throw new Error("capture");
  if (blue.rel == null) throw new Error("capture mutated");

  blue.rel = (0 - META.blue.start + 52) % 52;
  green.rel = null;
  steps = resolve(green, 6);
  if (steps[0].captures.length !== 0) throw new Error("safe start");

  green.rel = null;
  blue.rel = null;
}

selfCheck();

function say(text) {
  G.log.unshift(text);
  if (G.log.length > 14) G.log.length = 14;
}

function summarize(color, steps) {
  const name = META[color].name;
  const bits = [steps.some((s) => s.kind === "takeoff") ? name + "的飞机起飞了" : name + "的飞机向前飞"];
  if (steps.some((s) => s.kind === "jump")) bits.push("同色跳了 4 格");
  if (steps.some((s) => s.kind === "fly")) bits.push("沿航线飞了一段");
  if (steps.some((s) => s.kind === "bounce")) bits.push("超出终点，反弹");
  if (steps.some((s) => s.kind === "finish")) bits.push("抵达终点");
  const caps = [...new Set(steps.flatMap((s) => s.captures))];
  if (caps.length) {
    const tally = {};
    for (const id of caps) {
      const plane = byId(id);
      if (!plane) continue;
      tally[plane.color] = (tally[plane.color] || 0) + 1;
    }
    const text = Object.entries(tally).map(([c, n]) => META[c].name + " " + n + " 架").join("、");
    bits.push("击落" + text);
  }
  return bits.join("，");
}

const clipUrls = new Map();

function audioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    audioCtx = audioCtx || new AC();
  } catch (err) {
    return null;
  }
  return audioCtx;
}

function unlockAudio() {
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();
  try {
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch (err) {
    /* ignore */
  }
}

function wavUrl(freq, seconds, type) {
  const key = freq + ":" + seconds + ":" + (type || "sine");
  if (clipUrls.has(key)) return clipUrls.get(key);
  const rate = 22050;
  const n = Math.max(1, Math.floor(rate * seconds));
  const bytes = 44 + n * 2;
  const raw = new ArrayBuffer(bytes);
  const view = new DataView(raw);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.sin(Math.PI * Math.min(1, i / n));
    let sample = Math.sin(2 * Math.PI * freq * t);
    if (type === "square") sample = sample >= 0 ? 0.7 : -0.7;
    const value = Math.max(-1, Math.min(1, sample * env * 0.92));
    view.setInt16(44 + i * 2, value * 32767, true);
  }
  const pcm = new Uint8Array(raw);
  let binary = "";
  for (let i = 0; i < pcm.length; i++) binary += String.fromCharCode(pcm[i]);
  const url = "data:audio/wav;base64," + btoa(binary);
  clipUrls.set(key, url);
  return url;
}

function playClip(freq, dur, type) {
  try {
    if (!speaker) {
      speaker = document.createElement("audio");
      speaker.setAttribute("playsinline", "");
      speaker.setAttribute("webkit-playsinline", "");
      speaker.preload = "auto";
      document.body.appendChild(speaker);
    }
    speaker.volume = 1;
    speaker.src = wavUrl(freq, Math.max(dur, 0.22), type);
    const pending = speaker.play();
    const note = document.getElementById("sound-note");
    if (pending && pending.then) {
      pending.then(() => {
        if (note) note.textContent = "";
      }).catch((err) => {
        if (note) note.textContent = "声音没播出来（" + (err && err.name ? err.name : "被拦住") + "）。先关掉侧面静音键，再点一次音效。";
      });
    }
  } catch (err) {
    /* ignore missing audio */
  }
}

function tone(freq, dur, type) {
  if (!G.sound) return;
  playClip(freq, dur, type);
}

function soundFor(kind) {
  if (kind === "takeoff") tone(523, 0.1);
  else if (kind === "jump") tone(659, 0.09);
  else if (kind === "fly") tone(784, 0.14);
  else if (kind === "finish") tone(880, 0.16);
  else if (kind === "park") tone(1046, 0.12);
  else if (kind === "capture") tone(196, 0.12, "square");
  else if (kind === "dice") tone(392, 0.06);
}

function wait(ms, token) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(token === playToken), ms);
  });
}

const SPEED = { pass: 85, land: 100, bounce: 90, takeoff: 340, jump: 360, fly: 480, finish: 240 };

function angle(from, to) {
  const dc = to[0] - from[0];
  const dr = to[1] - from[1];
  return Math.atan2(dc, -dr) * 180 / Math.PI;
}

function nextCell(color, rel) {
  if (rel < 51) return cellFor(color, rel + 1);
  if (rel === 51) return META[color].home[0];
  if (rel < GOAL) return cellFor(color, rel + 1);
  return cellFor(color, rel);
}

function visualOf(plane, stackIndex, stackCount) {
  if (plane.done || plane.rel == null) {
    const base = META[plane.color].base[plane.slot];
    const start = RING[META[plane.color].start];
    let rot = angle(base, start);
    if (plane.done) rot += 180;
    return { x: base[0] + 0.5, y: base[1] + 0.5, rot };
  }
  const cell = cellFor(plane.color, plane.rel);
  const nxt = nextCell(plane.color, plane.rel);
  const offs = {
    1: [[0, 0]],
    2: [[-0.16, 0], [0.16, 0]],
    3: [[-0.16, -0.14], [0.16, -0.14], [0, 0.16]],
    4: [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]],
  };
  const off = (offs[stackCount] || offs[1])[stackIndex] || [0, 0];
  return {
    x: cell[0] + 0.5 + off[0],
    y: cell[1] + 0.5 + off[1],
    rot: angle(cell, nxt),
  };
}

function spawnPlanes(colors) {
  G.planes = [];
  for (const color of colors) {
    for (let slot = 0; slot < 4; slot++) {
      G.planes.push({
        id: color + "-" + slot,
        color,
        slot,
        rel: null,
        done: false,
        swoop: false,
      });
    }
  }
}

function showDice(n) {
  const maps = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  const on = new Set(maps[n] || []);
  const pips = document.querySelectorAll("#dice i");
  pips.forEach((pip, i) => pip.classList.toggle("on", on.has(i)));
  const dice = document.getElementById("dice");
  const num = document.getElementById("dice-num");
  if (num) num.textContent = n ? String(n) : "";
  if (dice) dice.setAttribute("aria-label", n ? n + "点" : "掷骰子");
}

function paint() {
  const hint = document.getElementById("hint");
  const six = document.getElementById("sixes");
  const dice = document.getElementById("dice");
  const players = document.getElementById("players");
  const log = document.getElementById("log");
  if (!hint) return;

  const playing = G.phase === "roll" || G.phase === "pick" || G.phase === "anim" || G.phase === "over";
  if (!playing) {
    hint.textContent = "选择人数，开始一局";
  } else if (G.phase === "over") {
    hint.textContent = META[G.winner].name + "获胜";
  } else {
    const who = META[G.turn].name + "（" + sideName(G.turn) + "）";
    if (G.phase === "roll") hint.textContent = localHuman(G.turn) ? who + "，请掷骰子" : who + (G.control[G.turn] === "ai" ? "思考中…" : "请操作");
    else if (G.phase === "pick") hint.textContent = who + "，点一架可以走的飞机";
    else hint.textContent = who + "正在飞行";
  }
  six.textContent = playing && G.sixes > 0 ? "已连续 " + G.sixes + " 个 6" : "";

  const humanTurn = playing && G.phase === "roll" && localHuman(G.turn);
  dice.disabled = !humanTurn;
  dice.classList.toggle("ready", humanTurn);
  const pip = playing ? playerInk(G.turn) : "#1c2430";
  document.querySelector(".dice-row").style.setProperty("--pip", pip);

  document.querySelectorAll(".airport").forEach((el) => {
    const color = el.dataset.color;
    el.classList.toggle("off", G.phase !== "setup" && !G.active.includes(color));
  });

  players.innerHTML = (playing ? turnOrder() : []).map((color) => {
    const list = G.planes.filter((p) => p.color === color);
    const dots = list.map((p) => {
      const st = p.done ? "done" : p.rel == null ? "base" : "out";
      return '<b class="' + st + '"></b>';
    }).join("");
    const arrived = list.filter((p) => p.done).length;
    const on = G.turn === color ? " on" : "";
    const who = sideName(color);
    return '<div class="prow c-' + color + on + '"><span class="name">' + META[color].name +
      '</span><span class="who">' + who + '</span><span class="dots">' + dots +
      '</span><span class="frac">' + arrived + "/4</span></div>";
  }).join("");

  log.innerHTML = G.log.map((line) => "<li>" + line + "</li>").join("");

  document.querySelectorAll(".cell.hint").forEach((el) => el.classList.remove("hint"));
  if (G.phase === "pick") {
    for (const move of G.moves) {
      const plane = byId(move.id);
      const rel = move.steps[move.steps.length - 1].rel;
      const cell = cellFor(plane.color, rel === GOAL && move.steps.at(-1).kind === "finish" ? GOAL : rel);
      const el = cellMap.get(cell.join(","));
      if (el) el.classList.add("hint");
    }
  }

  const legal = new Set(G.phase === "pick" && localHuman(G.turn) ? G.moves.map((m) => m.id) : []);
  const groups = new Map();
  for (const plane of G.planes) {
    if (plane.done || plane.rel == null) continue;
    const key = cellFor(plane.color, plane.rel).join(",");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(plane);
  }
  for (const list of groups.values()) list.sort((a, b) => a.id < b.id ? -1 : 1);

  for (const plane of G.planes) {
    const el = planeEls.get(plane.id);
    if (!el) continue;
    let stackIndex = 0;
    let stackCount = 1;
    if (!plane.done && plane.rel != null) {
      const list = groups.get(cellFor(plane.color, plane.rel).join(","));
      stackIndex = list.indexOf(plane);
      stackCount = list.length;
    }
    const vis = visualOf(plane, stackIndex, stackCount);
    const dur = plane.swoop ? "360ms" : "0ms";
    const half = plane.rel == null ? 0.28 : 0.36;
    el.style.transition = "left " + dur + " ease, top " + dur + " ease";
    el.style.left = (vis.x / 15) * 100 + "%";
    el.style.top = (vis.y / 15) * 100 + "%";
    el.style.marginLeft = "calc(-100% / 15 * " + half + ")";
    el.style.marginTop = "calc(-100% / 15 * " + half + ")";
    el.style.transform = "rotate(" + vis.rot + "deg)";
    el.classList.toggle("legal", legal.has(plane.id));
    el.classList.toggle("in-base", plane.rel == null);
    el.classList.toggle("done", plane.done);
    el.classList.toggle("turn", playing && plane.color === G.turn && !plane.done);
    el.title = META[plane.color].name + " " + (plane.slot + 1) + "号" + (plane.done ? "（已到达）" : "");
  }

  const soundBtn = document.getElementById("sound-btn");
  if (soundBtn) soundBtn.textContent = G.sound ? "音效开" : "音效关";
  refreshNetBar();
  netSnap();
}

function edgeColor(color) {
  return { red: "#e7b4b4", green: "#b7e0c8", yellow: "#ead392", blue: "#b9cef2" }[color] || "#e4d3a8";
}

const cellMap = new Map();
const planeEls = new Map();

function buildBoard() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  cellMap.clear();

  for (const color of COLOR_ORDER) {
    const port = document.createElement("div");
    port.className = "airport " + META[color].corner;
    port.dataset.color = color;
    const label = document.createElement("span");
    label.className = "corner-label";
    label.textContent = META[color].name.slice(0, 1);
    port.appendChild(label);
    grid.appendChild(port);
  }

  const homeMap = new Map();
  for (const color of COLOR_ORDER) {
    const dir = homeDir(META[color].home);
    META[color].home.forEach((cell, i) => homeMap.set(cell.join(","), { color, dir, i }));
  }
  const padMap = new Map();
  for (const color of COLOR_ORDER) {
    for (const cell of META[color].base) padMap.set(cell.join(","), color);
  }
  const flySet = new Set(COLOR_ORDER.map((c) => (META[c].start + 16) % 52));

  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const key = c + "," + r;
      const face = document.createElement("div");
      face.className = "face";
      if (RING_AT.has(key)) {
        const index = RING_AT.get(key);
        const color = MOD_COLOR[index % 4];
        face.classList.add("track", color);
        if ([0, 13, 26, 39].includes(index)) face.classList.add("start");
        if (flySet.has(index)) face.classList.add("fly");
      } else if (homeMap.has(key)) {
        const info = homeMap.get(key);
        face.classList.add("lane", info.color, info.dir);
      } else if (padMap.has(key)) {
        face.classList.add("pad");
      }
      cell.appendChild(face);
      grid.appendChild(cell);
      cellMap.set(key, cell);
    }
  }

  const hub = document.createElement("div");
  hub.className = "hub";
  hub.insertAdjacentHTML("beforeend", PLANE_SVG);
  grid.appendChild(hub);
  grid.appendChild(buildFlySvg());
}

function homeDir(home) {
  const dc = home[1][0] - home[0][0];
  const dr = home[1][1] - home[0][1];
  if (dc > 0) return "e";
  if (dc < 0) return "w";
  if (dr > 0) return "s";
  return "n";
}

function buildFlySvg() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "flys");
  svg.setAttribute("viewBox", "0 0 15 15");
  const defs = document.createElementNS(ns, "defs");
  const marker = document.createElementNS(ns, "marker");
  marker.setAttribute("id", "arrow");
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "5");
  marker.setAttribute("markerHeight", "5");
  marker.setAttribute("orient", "auto-start-reverse");
  const head = document.createElementNS(ns, "path");
  head.setAttribute("d", "M0 0 L10 5 L0 10 z");
  head.setAttribute("fill", "#2b3a4a");
  marker.appendChild(head);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const stroke = { red: "#b42323", green: "#0f7a3a", yellow: "#a56b00", blue: "#1d4ed8" };
  for (const color of COLOR_ORDER) {
    const a = cellFor(color, 16);
    const b = cellFor(color, 28);
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", a[0] + 0.5);
    line.setAttribute("y1", a[1] + 0.5);
    line.setAttribute("x2", b[0] + 0.5);
    line.setAttribute("y2", b[1] + 0.5);
    line.setAttribute("stroke", stroke[color]);
    line.setAttribute("stroke-width", "0.07");
    line.setAttribute("stroke-dasharray", "0.22 0.13");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("marker-end", "url(#arrow)");
    svg.appendChild(line);
  }
  return svg;
}

function mountPlanes() {
  const grid = document.getElementById("grid");
  for (const el of planeEls.values()) el.remove();
  planeEls.clear();
  for (const plane of G.planes) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "plane c-" + plane.color;
    el.dataset.id = plane.id;
    el.innerHTML = PLANE_SVG;
    el.addEventListener("click", () => onPlaneClick(plane.id));
    grid.appendChild(el);
    planeEls.set(plane.id, el);
  }
}

function renderSetup() {
  document.querySelectorAll("#counts button").forEach((btn) => {
    btn.classList.toggle("on", Number(btn.dataset.count) === G.count);
  });
  const active = new Set(activeOf(G.count));
  const seats = document.getElementById("seats");
  seats.innerHTML = COLOR_ORDER.map((color) => {
    if (!active.has(color)) {
      return '<div class="seat"><span class="tag ' + color + '">' + META[color].name +
        "</span><em>这局不参加</em></div>";
    }
    const humanOn = G.control[color] === "human" ? " on" : "";
    const aiOn = G.control[color] === "ai" ? " on" : "";
    return '<div class="seat"><span class="tag ' + color + '">' + META[color].name +
      '</span><span class="pair"><button type="button" data-color="' + color +
      '" data-ctrl="human" class="' + humanOn.trim() + '">人类</button><button type="button" data-color="' +
      color + '" data-ctrl="ai" class="' + aiOn.trim() + '">电脑</button></span></div>';
  }).join("");
  seats.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (Net.role !== "local") return;
      G.control[btn.dataset.color] = btn.dataset.ctrl;
      renderSetup();
    });
  });
}

function openSetup() {
  const inGame = G.phase === "roll" || G.phase === "pick" || G.phase === "anim" || G.phase === "over";
  if (inGame) {
    resumePhase = G.phase === "anim" ? "roll" : G.phase;
    playToken++;
  }
  document.getElementById("win-modal").hidden = true;
  document.getElementById("setup-modal").hidden = false;
  document.getElementById("close-setup").hidden = !inGame && !resumePhase;
  renderSetup();
  paint();
}

function closeSetup() {
  if (!resumePhase) return;
  document.getElementById("setup-modal").hidden = true;
  const phase = resumePhase;
  resumePhase = null;
  const token = ++playToken;
  G.phase = phase;
  paint();
  if (G.phase === "roll") maybeAuto(token);
}

function startGame() {
  if (Net.role === "guest") return;
  if (Net.role === "host" && Net.members.size < G.count) {
    setNetStatus("还差 " + (G.count - Net.members.size) + " 人。先复制链接发到微信。");
    return;
  }
  playToken++;
  const token = playToken;
  resumePhase = null;
  G.active = activeOf(G.count);
  G.turn = turnOrder()[0];
  G.phase = "roll";
  G.dice = null;
  G.sixes = 0;
  G.moves = [];
  G.log = [];
  G.winner = null;
  spawnPlanes(G.active);
  mountPlanes();
  document.getElementById("setup-modal").hidden = true;
  document.getElementById("win-modal").hidden = true;
  say("游戏开始，红方先走");
  showDice(G.dice || 1);
  paint();
  maybeAuto(token);
}

function showWin(color) {
  const title = document.getElementById("win-title");
  title.textContent = META[color].name + "获胜";
  title.style.color = { red: "var(--red)", green: "var(--green)", yellow: "#c48800", blue: "var(--blue)" }[color];
  document.getElementById("win-modal").hidden = false;
  tone(523, 0.12);
  setTimeout(() => tone(659, 0.12), 130);
  setTimeout(() => tone(784, 0.18), 260);
}

async function animateDice(value, token) {
  const dice = document.getElementById("dice");
  dice.classList.add("rolling");
  const timer = setInterval(() => showDice(1 + Math.floor(Math.random() * 6)), 70);
  const ok = await wait(420, token);
  clearInterval(timer);
  dice.classList.remove("rolling");
  showDice(value);
  if (ok) soundFor("dice");
  return ok;
}

function maybeAuto(token) {
  if (Net.role === "guest") return;
  if (token !== playToken) return;
  if (G.phase === "roll" && G.control[G.turn] === "ai") {
    wait(520, token).then((ok) => {
      if (ok && G.phase === "roll" && token === playToken) onRoll();
    });
  }
}

function endTurn(token) {
  if (token !== playToken) return;
  G.sixes = 0;
  G.dice = null;
  G.moves = [];
  const order = turnOrder();
  const index = order.indexOf(G.turn);
  G.turn = order[(index + 1) % order.length];
  G.phase = "roll";
  say("轮到" + META[G.turn].name);
  paint();
  maybeAuto(token);
}

function applyCaptures(step) {
  for (const id of step.captures) {
    const plane = byId(id);
    if (!plane || plane.done) continue;
    plane.rel = null;
    plane.swoop = true;
  }
}

async function commit(move, dice, token) {
  if (token !== playToken) return;
  G.phase = "anim";
  G.moves = [];
  const plane = byId(move.id);
  paint();
  for (const step of move.steps) {
    if (token !== playToken) return;
    applyCaptures(step);
    plane.rel = step.rel;
    paint();
    if (step.captures.length) soundFor("capture");
    soundFor(step.kind);
    if (!(await wait(SPEED[step.kind] || 90, token))) return;
    if (step.kind === "finish") {
      plane.done = true;
      plane.rel = null;
      plane.swoop = true;
      paint();
      soundFor("park");
      if (!(await wait(420, token))) return;
    }
  }
  for (const p of G.planes) p.swoop = false;
  say(summarize(plane.color, move.steps));
  if (G.planes.filter((p) => p.color === plane.color).every((p) => p.done)) {
    G.phase = "over";
    G.winner = plane.color;
    say(META[plane.color].name + "的四架飞机全部抵达");
    paint();
    showWin(plane.color);
    return;
  }
  if (dice === 6) {
    G.phase = "roll";
    say("掷出 6 点，可以再掷一次");
    paint();
    maybeAuto(token);
    return;
  }
  endTurn(token);
}

async function onRoll() {
  if (Net.role === "guest") return;
  if (G.phase !== "roll") return;
  const token = playToken;
  G.phase = "anim";
  paint();
  const dice = 1 + Math.floor(Math.random() * 6);
  if (!(await animateDice(dice, token))) return;
  G.dice = dice;
  say(META[G.turn].name + "掷出 " + dice + " 点");
  if (dice === 6) G.sixes += 1;
  else G.sixes = 0;

  if (G.sixes >= 3) {
    const lead = leadPlane(G.turn);
    G.sixes = 0;
    if (lead) {
      lead.rel = null;
      lead.swoop = true;
      say("连续三次掷出 6，最前面的飞机返航");
      tone(180, 0.18, "triangle");
    } else {
      say("连续三次掷出 6，本回合结束");
    }
    paint();
    if (!(await wait(520, token))) return;
    if (lead) lead.swoop = false;
    endTurn(token);
    return;
  }

  const moves = legalMoves(G.turn, dice);
  if (!moves.length) {
    say("没有可以移动的飞机");
    paint();
    if (!(await wait(700, token))) return;
    endTurn(token);
    return;
  }

  const unique = new Set(moves.map((m) => m.id));
  if (G.control[G.turn] === "ai" || unique.size === 1) {
    const move = G.control[G.turn] === "ai" ? chooseMove(moves) : moves[0];
    if (G.control[G.turn] === "ai") {
      if (!(await wait(260, token))) return;
    }
    await commit(move, dice, token);
    return;
  }

  G.phase = "pick";
  G.moves = moves;
  paint();
}

function onPlaneClick(id) {
  if (G.phase !== "pick") return;
  if (!localHuman(G.turn)) return;
  if (Net.role === "guest") {
    netSend({ t: "intent", action: "pick", id });
    return;
  }
  const move = G.moves.find((m) => m.id === id);
  if (!move) return;
  commit(move, G.dice, playToken);
}

const Net = {
  role: "local",
  room: "",
  id: "",
  topic: "",
  seat: null,
  client: null,
  members: new Map(),
  applying: false,
  planeKey: "",
  shownWin: null,
};

function deviceKind() {
  const ua = navigator.userAgent || "";
  if (/iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "手机";
  return "电脑";
}

function playerName() {
  const input = document.getElementById("player-name");
  const typed = input && input.value.trim();
  return (typed || deviceKind()).slice(0, 8);
}

function saveHostMark() {
  try {
    localStorage.setItem("fc-host", JSON.stringify({
      room: Net.room,
      count: G.count,
      at: Date.now(),
    }));
  } catch (err) { /* ignore */ }
}

function readHostMark() {
  try {
    const data = JSON.parse(localStorage.getItem("fc-host") || "null");
    if (!data || !data.room) return null;
    if (Date.now() - data.at > 12 * 60 * 60 * 1000) return null;
    return data;
  } catch (err) {
    return null;
  }
}

function clearHostMark() {
  try {
    localStorage.removeItem("fc-host");
    localStorage.removeItem("fc-host-snap");
  } catch (err) { /* ignore */ }
}

function saveHostSnap() {
  if (Net.role !== "host") return;
  try {
    localStorage.setItem("fc-host-snap", JSON.stringify({
      room: Net.room,
      phase: G.phase,
      count: G.count,
      control: G.control,
      active: G.active,
      turn: G.turn,
      dice: G.dice,
      sixes: G.sixes,
      moves: G.moves,
      log: G.log.slice(0, 14),
      winner: G.winner,
      planes: G.planes.map((p) => ({ id: p.id, color: p.color, slot: p.slot, rel: p.rel, done: !!p.done })),
    }));
  } catch (err) { /* ignore */ }
}

function restoreHostSnap(room) {
  let data = null;
  try { data = JSON.parse(localStorage.getItem("fc-host-snap") || "null"); } catch (err) { return; }
  if (!data || data.room !== room || !data.phase || data.phase === "setup") return;
  G.phase = data.phase;
  G.count = data.count;
  G.control = Object.assign({}, data.control);
  G.active = data.active.slice();
  G.turn = data.turn;
  G.dice = data.dice;
  G.sixes = data.sixes || 0;
  G.moves = data.moves || [];
  G.log = data.log || [];
  G.winner = data.winner || null;
  G.planes = (data.planes || []).map((p) => ({ id: p.id, color: p.color, slot: p.slot, rel: p.rel, done: !!p.done, swoop: false }));
  Net.planeKey = G.planes.map((p) => p.id).join(",");
  mountPlanes();
  document.getElementById("setup-modal").hidden = true;
  if (G.dice) showDice(G.dice);
  paint();
}

function rememberName() {
  try { localStorage.setItem("fc-name", playerName()); } catch (err) { /* ignore */ }
}

function localHuman(color) {
  if (Net.role === "host" || Net.role === "guest") return color === Net.seat;
  return G.control[color] === "human";
}

function sideName(color) {
  if (Net.role === "local") return G.control[color] === "human" ? "你" : "电脑";
  if (color === Net.seat) return "你";
  if (G.control[color] === "ai") return "电脑";
  const found = [...Net.members.values()].find((m) => m.color === color);
  return found ? found.name : "等待加入";
}

function refreshNetBar() {
  const bar = document.getElementById("net-bar");
  if (!bar) return;
  if (Net.role === "local") {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const mine = Net.seat ? META[Net.seat].name : "分配中";
  const link = Net.client && Net.client.connected ? "已连接" : "重连中";
  bar.textContent = "联网 " + Net.room + " · 你是" + mine + " · " + link;
}

function setNetStatus(text) {
  const el = document.getElementById("net-status");
  if (el) el.textContent = text;
  const copy = document.getElementById("copy-room");
  const start = document.getElementById("start-btn");
  const code = document.getElementById("room-code");
  if (copy) copy.hidden = Net.role !== "host";
  const leave = document.getElementById("leave-room");
  if (leave) leave.hidden = Net.role === "local";
  if (code) {
    code.hidden = Net.role !== "host" || !Net.room;
    code.textContent = Net.room || "";
  }
  if (start) {
    start.disabled = Net.role === "guest";
    start.textContent = Net.role === "guest" ? "等待房主开始" : "开始游戏";
  }
  refreshNetBar();
}

function roomLink() {
  return location.origin + location.pathname + "?room=" + Net.room;
}

function netSend(msg) {
  if (!Net.client || !Net.client.connected) return;
  msg.from = Net.id;
  Net.client.publish(Net.topic, JSON.stringify(msg), { qos: msg.t === "snap" ? 0 : 1 });
}

function netSnap() {
  if (Net.role !== "host" || Net.applying) return;
  saveHostSnap();
  netSend({
    t: "snap",
    phase: G.phase,
    count: G.count,
    control: G.control,
    active: G.active,
    turn: G.turn,
    dice: G.dice,
    sixes: G.sixes,
    moves: G.moves,
    log: G.log.slice(0, 14),
    winner: G.winner,
    planes: G.planes.map((p) => ({ id: p.id, color: p.color, slot: p.slot, rel: p.rel, done: !!p.done })),
    members: [...Net.members.values()],
  });
}

function applySnap(s) {
  Net.applying = true;
  G.phase = s.phase;
  G.count = s.count;
  G.control = Object.assign({}, s.control);
  G.active = s.active.slice();
  G.turn = s.turn;
  G.dice = s.dice;
  G.sixes = s.sixes || 0;
  G.moves = s.moves || [];
  G.log = s.log || [];
  G.winner = s.winner || null;
  G.planes = (s.planes || []).map((p) => ({ id: p.id, color: p.color, slot: p.slot, rel: p.rel, done: !!p.done, swoop: false }));
  if (s.members) Net.members = new Map(s.members.map((m) => [m.color, m]));
  const key = G.planes.map((p) => p.id).join(",");
  if (key !== Net.planeKey) {
    Net.planeKey = key;
    mountPlanes();
  }
  if (G.phase !== "setup") {
    document.getElementById("setup-modal").hidden = true;
  }
  if (G.dice) showDice(G.dice);
  paint();
  if (G.phase === "over" && G.winner && Net.shownWin !== G.winner) {
    Net.shownWin = G.winner;
    showWin(G.winner);
  }
  Net.applying = false;
}

function onNetMessage(msg) {
  if (!msg || msg.from === Net.id) return;
  if (Net.role === "host") {
    if (msg.t === "join") {
      let member = Net.members.get(msg.from);
      if (!member) {
        const taken = new Set([...Net.members.values()].map((m) => m.color));
        const open = activeOf(G.count).filter((c) => !taken.has(c));
        if (!open.length) {
          netSend({ t: "full", to: msg.from });
          return;
        }
        member = { name: msg.name || "好友", color: open[0] };
        Net.members.set(msg.from, member);
        G.control[member.color] = "human";
      } else if (msg.name) {
        member.name = msg.name;
      }
      netSend({ t: "seat", to: msg.from, color: member.color });
      setNetStatus("已加入 " + Net.members.size + "/" + G.count + "：" + [...Net.members.values()].map((m) => META[m.color].name + " " + m.name).join("，"));
      netSnap();
      return;
    }
    if (msg.t === "intent") {
      const member = Net.members.get(msg.from);
      if (!member || member.color !== G.turn) return;
      if (msg.action === "roll" && G.phase === "roll") onRoll();
      if (msg.action === "pick" && G.phase === "pick") {
        const move = G.moves.find((m) => m.id === msg.id);
        if (move) commit(move, G.dice, playToken);
      }
    }
    return;
  }
  if (msg.to && msg.to !== Net.id) return;
  if (msg.t === "seat") {
    Net.seat = msg.color;
    setNetStatus("你是" + META[msg.color].name + "。等房主点开始。");
  } else if (msg.t === "full") {
    setNetStatus("这个房间已经满了。");
  } else if (msg.t === "snap") {
    applySnap(msg);
  }
}

function connectNet(room, role) {
  if (typeof mqtt === "undefined") return Promise.reject(new Error("联网组件没加载"));
  Net.role = role;
  Net.room = room;
  Net.topic = "becky/flight/" + room;
  try {
    let id = localStorage.getItem("fc-id");
    if (!id) {
      id = "p" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("fc-id", id);
    }
    Net.id = id;
  } catch (err) {
    Net.id = "p" + Math.random().toString(36).slice(2, 10);
  }
  if (Net.timer) clearInterval(Net.timer);
  if (Net.client) {
    try { Net.client.end(true); } catch (err) { /* ignore */ }
  }
  const brokers = [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt",
  ];
  return new Promise((resolve, reject) => {
    let index = 0;
    const attempt = () => {
      const client = mqtt.connect(brokers[index], {
        clientId: "fc" + Net.id + Math.random().toString(36).slice(2, 5),
        clean: true,
        reconnectPeriod: 2000,
        connectTimeout: 7000,
        protocolVersion: 4,
      });
      Net.client = client;
      let settled = false;
      const timer = setTimeout(() => fail(new Error("连接超时")), 7000);
      const fail = (err) => {
        if (settled) return;
        clearTimeout(timer);
        try { client.end(true); } catch (e) { /* ignore */ }
        index += 1;
        if (index < brokers.length) attempt();
        else reject(err);
      };
      client.on("connect", () => {
        client.subscribe(Net.topic, (err) => {
          if (err) return fail(err);
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            Net.timer = setInterval(() => {
              if (!Net.client || !Net.client.connected) {
                refreshNetBar();
                return;
              }
              if (Net.role === "host") netSnap();
              if (Net.role === "guest") netSend({ t: "join", name: playerName() });
            }, 1500);
            resolve();
          } else if (Net.role === "guest") {
            netSend({ t: "join", name: playerName() });
          } else if (Net.role === "host") {
            netSnap();
          }
        });
      });
      client.on("error", (err) => fail(err || new Error("连不上")));
      client.on("message", (_topic, payload) => {
        try { onNetMessage(JSON.parse(payload.toString())); } catch (err) { /* ignore */ }
      });
    };
    attempt();
  });
}

function randomRoom() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

async function hostRoom() {
  const room = randomRoom();
  setNetStatus("正在创建房间…");
  try {
    await connectNet(room, "host");
  } catch (err) {
    Net.role = "local";
    setNetStatus("创建失败：" + (err && err.message ? err.message : "连不上"));
    return;
  }
  Net.seat = "red";
  Net.members = new Map();
  rememberName();
  Net.members.set(Net.id, { name: playerName(), color: "red" });
  for (const color of activeOf(G.count)) G.control[color] = "human";
  document.getElementById("room-input").value = room;
  saveHostMark();
  setNetStatus("房间 " + room + " 已创建。复制链接发到微信，切回来你仍然是房主。");
}

async function resumeHost(mark) {
  G.count = mark.count || G.count;
  renderSetup();
  document.getElementById("room-input").value = mark.room;
  setNetStatus("正在回到房间 " + mark.room + " …");
  try {
    await connectNet(mark.room, "host");
  } catch (err) {
    Net.role = "local";
    setNetStatus("回到房间失败，请重新创建。");
    return;
  }
  Net.seat = "red";
  Net.members = new Map();
  Net.members.set(Net.id, { name: playerName(), color: "red" });
  for (const color of activeOf(G.count)) G.control[color] = "human";
  restoreHostSnap(mark.room);
  saveHostMark();
  setNetStatus("你还是房主。房间 " + mark.room + "。");
  netSnap();
}

function leaveRoom() {
  clearHostMark();
  if (Net.timer) clearInterval(Net.timer);
  if (Net.client) {
    try { Net.client.end(true); } catch (err) { /* ignore */ }
  }
  Net.role = "local";
  Net.room = "";
  Net.seat = null;
  Net.client = null;
  Net.members = new Map();
  document.getElementById("room-input").value = "";
  setNetStatus("已退出房间。");
}

async function joinRoom(code) {
  const room = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(room)) {
    setNetStatus("房间号是 4 位字母或数字。");
    return;
  }
  const owned = readHostMark();
  if (owned && owned.room === room) {
    resumeHost(owned);
    return;
  }
  clearHostMark();
  setNetStatus("正在加入 " + room + " …");
  try {
    await connectNet(room, "guest");
  } catch (err) {
    Net.role = "local";
    setNetStatus("加入失败：" + (err && err.message ? err.message : "连不上"));
    return;
  }
  rememberName();
  netSend({ t: "join", name: playerName() });
  setNetStatus("已连接 " + room + "，等待分配颜色…");
}

function copyRoomLink() {
  const url = roomLink();
  const done = () => setNetStatus("链接已复制，发到微信即可：" + url);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(() => {
      window.prompt("复制这个链接发给朋友", url);
    });
    return;
  }
  window.prompt("复制这个链接发给朋友", url);
}

function bindWechatAudio() {
  const fire = () => {
    if (!window.WeixinJSBridge) return;
    window.WeixinJSBridge.invoke("getNetworkType", {}, () => playClip(880, 0.2));
  };
  if (window.WeixinJSBridge) fire();
  else document.addEventListener("WeixinJSBridgeReady", fire, false);
}

function boot() {
  buildBoard();
  spawnPlanes(COLOR_ORDER);
  mountPlanes();
  showDice(1);
  renderSetup();
  paint();

  document.getElementById("start-btn").addEventListener("click", startGame);
  document.getElementById("again-btn").addEventListener("click", startGame);
  document.getElementById("back-btn").addEventListener("click", openSetup);
  document.getElementById("setup-btn").addEventListener("click", openSetup);
  document.getElementById("close-setup").addEventListener("click", closeSetup);
  document.getElementById("setup-modal").addEventListener("click", (event) => {
    if (event.target.id === "setup-modal") closeSetup();
  });
  document.getElementById("reset-btn").addEventListener("click", () => {
    if (Net.role === "guest") return;
    if (G.phase === "setup" || G.phase === "paused") return;
    startGame();
  });
  document.getElementById("sound-btn").addEventListener("click", () => {
    G.sound = true;
    playClip(880, 0.28);
    paint();
    const note = document.getElementById("sound-note");
    if (note) note.textContent = "如果没听到，先关掉平板侧面的静音键，再点一次。";
  });
  document.getElementById("dice").addEventListener("click", () => {
    if (G.phase !== "roll" || !localHuman(G.turn)) return;
    if (G.sound) playClip(740, 0.16);
    if (Net.role === "guest") netSend({ t: "intent", action: "roll" });
    else onRoll();
  });
  document.getElementById("host-room").addEventListener("click", hostRoom);
  document.getElementById("join-room").addEventListener("click", () => {
    joinRoom(document.getElementById("room-input").value);
  });
  document.getElementById("copy-room").addEventListener("click", copyRoomLink);
  document.getElementById("leave-room").addEventListener("click", leaveRoom);
  document.querySelectorAll("#counts button").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (Net.role !== "local") return;
      G.count = Number(btn.dataset.count);
      renderSetup();
    });
  });
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.repeat) return;
    if (event.target && event.target.id === "dice") return;
    if (G.phase === "roll" && localHuman(G.turn)) {
      event.preventDefault();
      if (Net.role === "guest") netSend({ t: "intent", action: "roll" });
      else onRoll();
    }
  });
  bindWechatAudio();
  const nameInput = document.getElementById("player-name");
  try {
    nameInput.value = localStorage.getItem("fc-name") || deviceKind();
  } catch (err) {
    nameInput.value = deviceKind();
  }
  nameInput.addEventListener("change", rememberName);
  const preset = (new URLSearchParams(location.search).get("room") || "").toUpperCase();
  const owned = readHostMark();
  if (owned && (!preset || preset === owned.room)) {
    document.getElementById("room-input").value = owned.room;
    resumeHost(owned);
  } else if (preset) {
    document.getElementById("room-input").value = preset;
    joinRoom(preset);
  }
}

if (typeof document !== "undefined") boot();
