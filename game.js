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
const PLANE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 12 2a1.5 1.5 0 0 0-1.5 1.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>';

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

function unlockAudio() {
  try {
    audioCtx = audioCtx || new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (err) {
    /* ignore missing audio */
  }
}

function tone(freq, dur, type) {
  if (!G.sound) return;
  try {
    unlockAudio();
    const ctx = audioCtx;
    if (!ctx) return;
    const play = () => {
      const t0 = ctx.currentTime;
      const length = Math.max(dur, 0.14);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.25, t0);
      gain.gain.linearRampToValueAtTime(0.0001, t0 + length);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + length + 0.02);
    };
    if (ctx.state === "suspended") ctx.resume().then(play).catch(() => {});
    else play();
  } catch (err) {
    /* ignore missing audio */
  }
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
    const who = META[G.turn].name + (G.control[G.turn] === "human" ? "（你）" : "（电脑）");
    if (G.phase === "roll") hint.textContent = G.control[G.turn] === "human" ? who + "，请掷骰子" : who + "思考中…";
    else if (G.phase === "pick") hint.textContent = who + "，点一架可以走的飞机";
    else hint.textContent = who + "正在飞行";
  }
  six.textContent = playing && G.sixes > 0 ? "已连续 " + G.sixes + " 个 6" : "";

  const humanTurn = playing && G.phase === "roll" && G.control[G.turn] === "human";
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
    const who = G.control[color] === "human" ? "你" : "电脑";
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

  const legal = new Set(G.phase === "pick" ? G.moves.map((m) => m.id) : []);
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
    el.style.transition = "left " + dur + " ease, top " + dur + " ease";
    el.style.left = (vis.x / 15) * 100 + "%";
    el.style.top = (vis.y / 15) * 100 + "%";
    el.style.transform = "translate(-50%, -50%) rotate(" + vis.rot + "deg)";
    el.classList.toggle("legal", legal.has(plane.id));
    el.classList.toggle("in-base", plane.rel == null);
    el.classList.toggle("done", plane.done);
    el.classList.toggle("turn", playing && plane.color === G.turn && !plane.done);
    el.title = META[plane.color].name + " " + (plane.slot + 1) + "号" + (plane.done ? "（已到达）" : "");
  }

  const soundBtn = document.getElementById("sound-btn");
  if (soundBtn) soundBtn.textContent = G.sound ? "音效开" : "音效关";
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
  const move = G.moves.find((m) => m.id === id);
  if (!move) return;
  commit(move, G.dice, playToken);
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
    if (G.phase === "setup" || G.phase === "paused") return;
    startGame();
  });
  document.getElementById("sound-btn").addEventListener("click", () => {
    G.sound = !G.sound;
    unlockAudio();
    paint();
    if (G.sound) tone(660, 0.16);
  });
  document.addEventListener("pointerdown", unlockAudio, { passive: true });
  document.getElementById("dice").addEventListener("click", () => {
    if (G.phase === "roll" && G.control[G.turn] === "human") onRoll();
  });
  document.querySelectorAll("#counts button").forEach((btn) => {
    btn.addEventListener("click", () => {
      G.count = Number(btn.dataset.count);
      renderSetup();
    });
  });
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.repeat) return;
    if (event.target && event.target.id === "dice") return;
    if (G.phase === "roll" && G.control[G.turn] === "human") {
      event.preventDefault();
      onRoll();
    }
  });
}

if (typeof document !== "undefined") boot();
