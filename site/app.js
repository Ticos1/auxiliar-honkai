"use strict";
/* Auxiliar Star Rail — tudo roda no navegador. Os dados da conta chegam
   criptografados (data.enc.json) e só são abertos com a senha. */

const KEY_STORE = "hsr-aux-key";
const TAB_STORE = "hsr-aux-tab";
const SLOT_NAMES = { 1: "Cabeça", 2: "Mãos", 3: "Corpo", 4: "Pés", 5: "Esfera", 6: "Corda" };
const TEAM_TIER = { "T0": 6, "T0.5": 5.5, "S": 5, "T1": 4.5, "A": 4, "B": 3, "C": 2 };
const MODE_NAMES = { MoC: "Memória do Caos", PF: "Ficção Pura", AS: "Sombra Apocalíptica" };

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

/* ---------------- Criptografia ---------------- */
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));

async function deriveKey(password, env) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: b64d(env.salt), iterations: env.iter },
    base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
}
async function decrypt(env, key) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(env.iv) }, key, b64d(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---------------- Estado ---------------- */
let META, ENV, DATA, A; // A = análise calculada

async function boot() {
  const [m, e] = await Promise.all([
    fetch("meta.json", { cache: "no-cache" }).then((r) => r.json()),
    fetch("data.enc.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  META = m; ENV = e;
  if (!ENV) { $("#lockMsg").textContent = "Dados ainda não gerados. Rode o workflow no GitHub Actions."; return; }
  const saved = store.get(KEY_STORE);
  if (saved) {
    try {
      const key = await crypto.subtle.importKey("raw", b64d(saved), "AES-GCM", true, ["decrypt"]);
      return open(await decrypt(ENV, key));
    } catch { store.del(KEY_STORE); }
  }
  $("#pw").focus();
}

$("#lockForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = ev.submitter || $("#lockForm button");
  btn.disabled = true; $("#lockMsg").textContent = "Abrindo…";
  try {
    const key = await deriveKey($("#pw").value, ENV);
    const data = await decrypt(ENV, key);
    if ($("#remember").checked) store.set(KEY_STORE, b64e(await crypto.subtle.exportKey("raw", key)));
    $("#pw").value = "";
    open(data);
  } catch {
    $("#lockMsg").textContent = ENV ? "Senha incorreta." : "Dados indisponíveis.";
  } finally { btn.disabled = false; }
});
$("#logout").addEventListener("click", () => { store.del(KEY_STORE); location.reload(); });

function open(data) {
  DATA = data;
  A = analyze(META, DATA);
  $("#lock").hidden = true; $("#app").hidden = false;
  $("#player").textContent = data.player ? `${data.player.nickname} · Nv. ${data.player.level}` : `UID ${data.uid}`;
  $("#updated").textContent = "Atualizado " + new Date(data.fetched_at * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  $("#foot").innerHTML = `Meta da versão ${esc(META.version)} (revisado em ${fmtDate(META.updated)}). Fontes: ` +
    META.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(", ") +
    ". Tier lists divergem entre sites; use como guia, não como regra.";
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  show(store.get(TAB_STORE) || "home");
}

function show(tab) {
  if (!RENDER[tab]) tab = "home";
  store.set(TAB_STORE, tab);
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab));
  $("#view").innerHTML = RENDER[tab]();
  if (tab === "chars") bindCharFilters();
  window.scrollTo({ top: 0 });
}

/* ---------------- Análise ---------------- */
function analyze(meta, data) {
  const tierOf = {};
  for (const [t, names] of Object.entries(meta.tiers)) for (const n of names) tierOf[norm(n)] = t;

  // Mapa de nomes de propriedades (tipo -> nome) a partir dos próprios dados
  const propName = {};
  for (const c of data.characters) {
    for (const r of [...c.relics, ...c.ornaments]) for (const p of [r.main, ...r.subs]) if (p.name) propName[p.type] = p.name;
    for (const s of c.stats) if (s.name && !propName[s.type]) propName[s.type] = s.name;
  }

  const chars = data.characters.map((c) => {
    const isTB = c.id >= 8000 || /trailblazer|\{nickname\}/i.test(c.name);
    const display = isTB ? `Trailblazer (${c.path})` : c.name;
    const keys = [norm(display), norm(`${c.name} (${c.path})`), norm(c.name)];
    const tier = keys.map((k) => tierOf[k]).find(Boolean) || null;
    const ch = { ...c, display, keys, tier, tierVal: tier ? meta.tierScale[tier] : 0 };
    ch.build = assessBuild(ch, propName);
    return ch;
  });

  const owned = new Map();
  for (const c of chars) for (const k of c.keys) if (!owned.has(k)) owned.set(k, c);
  const has = (name) => owned.get(norm(name));

  const evalTeam = (team, exclude = new Set(), extra = null) => {
    const used = new Set();
    const slots = team.slots.map((slot, i) => {
      const cands = [...slot.options, ...(slot.pool ? meta.pools[slot.pool] : [])];
      const seen = new Set();
      for (const [idx, name] of cands.entries()) {
        const k = norm(name);
        if (seen.has(k)) continue; seen.add(k);
        const c = has(name) || (extra && norm(extra) === k ? { display: extra, hypothetical: true, keys: [k], build: { score: 50 } } : null);
        if (c && !used.has(c.display) && !exclude.has(c.display)) {
          used.add(c.display);
          return { slot, char: c, ideal: idx === 0, fromOptions: idx < slot.options.length, core: i === 0 };
        }
      }
      return { slot, char: null, core: i === 0, wanted: slot.options };
    });
    const missing = slots.filter((s) => !s.char).length;
    const subs = slots.filter((s) => s.char && !s.ideal).length;
    const coreMissing = !slots[0].char;
    const built = slots.filter((s) => s.char && !s.char.hypothetical);
    const avgBuild = built.length ? built.reduce((a, s) => a + s.char.build.score, 0) / built.length : 0;
    const tv = TEAM_TIER[team.tier] || 3;
    const score = tv * 10 - missing * 18 - (coreMissing ? 25 : 0) - subs * 3 + avgBuild / 20;
    return { team, slots, missing, subs, coreMissing, avgBuild, score, members: used };
  };

  const teams = meta.teams.map((t) => evalTeam(t)).sort((a, b) => b.score - a.score);

  // Dois times sem repetir personagem (Memória do Caos / Sombra Apocalíptica)
  let pair = null;
  for (const t1 of teams.filter((t) => !t.missing).slice(0, 8)) {
    for (const t of meta.teams) {
      if (t.id === t1.team.id) continue;
      const t2 = evalTeam(t, t1.members);
      if (t2.missing) continue;
      const s = t1.score + t2.score;
      if (!pair || s > pair.s) pair = { s, a: t1, b: t2 };
    }
  }

  // Banners
  const today = new Date().toISOString().slice(0, 10);
  const banners = meta.banners.map((b) => ({
    ...b,
    status: b.end && b.end < today ? "past" : b.start <= today ? "now" : "next",
    picks: b.five.map((name) => judgePull(name)),
  })).filter((b) => b.status !== "past");

  function judgePull(name) {
    const c = has(name);
    const tier = tierOf[norm(name)];
    const tv = tier ? meta.tierScale[tier] : 0;
    if (c) return { name, owned: true, char: c, tier, verdict: "skip", why: `Você já tem (E${c.eidolon}). Para F2P, eidolon raramente compensa; guarde as jades.` };
    const gains = [];
    for (const t of meta.teams) {
      if (!t.slots.some((s) => s.options.some((o) => norm(o) === norm(name)))) continue;
      const before = evalTeam(t), after = evalTeam(t, new Set(), name);
      if (after.missing < before.missing || (after.subs < before.subs && !after.missing)) gains.push({ team: t, after });
    }
    const completes = gains.filter((g) => !g.after.missing);
    let verdict = "low", why;
    if (completes.length && tv >= 5) { verdict = "high"; why = `Completa: ${completes.map((g) => g.team.name).join("; ")}.`; }
    else if (completes.length) { verdict = "mid"; why = `Completa: ${completes.map((g) => g.team.name).join("; ")}, mas é tier ${tier || "?"}.`; }
    else if (gains.length && tv >= 5) { verdict = "mid"; why = `Forte (tier ${tier}), mas ainda faltariam peças em ${gains.map((g) => g.team.name).join("; ")}.`; }
    else why = gains.length ? `Ainda faltariam peças nos times dele(a).` : `Nenhum time da lista melhora com ele(a) na sua conta.`;
    return { name, owned: false, tier, verdict, why, gains, completes };
  }

  // 5★ grátis
  let free = null;
  if (meta.freePick && meta.freePick.until >= today) {
    const opts = meta.freePick.options.map(judgePull);
    const rank = { high: 3, mid: 2, low: 1, skip: 0 };
    const best = [...opts].sort((a, b) => rank[b.verdict] - rank[a.verdict] || (meta.tierScale[b.tier] || 0) - (meta.tierScale[a.tier] || 0))[0];
    free = { ...meta.freePick, opts, best };
  }

  // Investimentos: personagens dos melhores times, ordenados por impacto
  const teamUse = new Map();
  const focusTeams = pair ? [pair.a, pair.b] : teams.filter((t) => !t.missing).slice(0, 2);
  for (const t of [...focusTeams, ...teams.slice(0, 6)]) for (const s of t.slots) if (s.char && !s.char.hypothetical) {
    teamUse.set(s.char.display, Math.max(teamUse.get(s.char.display) || 0, TEAM_TIER[t.team.tier] + (focusTeams.includes(t) ? 3 : 0)));
  }
  const invest = chars.filter((c) => c.build.issues.length)
    .map((c) => ({ c, w: (teamUse.get(c.display) || 0) * 2 + c.tierVal + (100 - c.build.score) / 25 }))
    .sort((a, b) => b.w - a.w);

  const content = meta.content.filter((m) => m.end >= today).map((m) => ({
    ...m, now: m.start <= today,
    fits: teams.filter((t) => !t.missing && t.team.modes.includes(m.mode)).map((t) => ({ t, fav: t.team.tags.some((g) => m.favors.includes(g)) }))
      .sort((a, b) => b.fav - a.fav || b.t.score - a.t.score).slice(0, 3),
  }));

  return { chars, teams, pair, banners, free, invest, teamUse, content, propName, has };
}

function assessBuild(c, propName) {
  const issues = [];
  const add = (p, text) => issues.push({ p, text });
  const rec = new Set(c.recommended_stats || []);
  const recNames = (pos) => [...rec].map((t) => propName[t]).filter(Boolean);

  if (c.level < 80) add(c.level < 70 ? 1 : 2, `Subir o personagem para o nível 80 (está no ${c.level}).`);
  if (!c.lightcone) add(1, "Equipar um cone de luz.");
  else if (c.lightcone.level < 80) add(2, `Subir o cone "${c.lightcone.name}" para o nível 80 (está no ${c.lightcone.level}).`);

  const pieces = [...c.relics, ...c.ornaments];
  const byPos = Object.fromEntries(pieces.map((r) => [r.pos, r]));
  let total = 0;
  const pieceScores = [];
  for (let pos = 1; pos <= 6; pos++) {
    const r = byPos[pos];
    if (!r) { add(1, `Equipar ${SLOT_NAMES[pos]} (vazio).`); pieceScores.push({ pos, q: 0 }); continue; }
    const rolls = r.subs.reduce((a, s) => a + 1 + (s.rolls || 0), 0) || 1;
    const useful = r.subs.filter((s) => s.good).reduce((a, s) => a + 1 + (s.rolls || 0), 0);
    const subQ = useful / rolls;
    let mainOk = true;
    if (pos >= 3) {
      // A HoYoLAB marca o principal como "good" quando bate com a recomendação.
      // Esfera com bônus do próprio elemento é sempre aceitável.
      const ownElement = pos === 5 && norm(r.main.name).includes(norm(c.element)) && /dmg/i.test(r.main.name);
      mainOk = r.main.good || ownElement || rec.has(r.main.type) || !rec.size;
    }
    if (!mainOk) {
      const opts = recNames(pos);
      add(1, `${SLOT_NAMES[pos]}: principal "${r.main.name}" não é recomendado.` + (opts.length ? ` Recomendados para ${c.display}: ${opts.join(", ")}.` : ""));
    }
    if (r.rarity < 5) add(2, `${SLOT_NAMES[pos]}: trocar a peça ${r.rarity}★ por uma 5★.`);
    else if (r.level < 15) add(r.level < 9 ? 2 : 3, `${SLOT_NAMES[pos]}: subir de +${r.level} para +15.`);
    if (r.level >= 12 && subQ < 0.34 && r.subs.length) add(3, `${SLOT_NAMES[pos]}: substatus fracos (${useful}/${rolls} upgrades úteis). Farme uma substituta.`);
    // Qualidade da peça (0–1): raridade × nível × (principal + substatus úteis)
    const statQ = pos <= 2 ? subQ : 0.35 * (mainOk ? 1 : 0) + 0.65 * subQ;
    const q = (r.rarity < 5 ? 0.6 : 1) * (0.35 + 0.65 * (r.level / 15)) * statQ;
    pieceScores.push({ pos, q, useful, rolls, mainOk });
    total += q;
  }

  // Conjuntos (id = [raridade][conjunto 3 dígitos][posição])
  const setOf = (r) => Math.floor(r.id / 10) % 1000;
  if (c.relics.length === 4) {
    const counts = {};
    c.relics.forEach((r) => (counts[setOf(r)] = (counts[setOf(r)] || 0) + 1));
    const v = Object.values(counts);
    if (!v.some((n) => n >= 2)) add(1, "Relíquias sem nenhum bônus de conjunto ativo. Use 4 peças do mesmo conjunto (ou 2+2).");
    else if (v.filter((n) => n >= 2).length === 1 && Math.max(...v) < 4) add(3, "Só um bônus de 2 peças ativo; vale fechar 4 peças ou 2+2.");
  }
  if (c.ornaments.length === 2 && setOf(c.ornaments[0]) !== setOf(c.ornaments[1])) add(1, "Ornamentos de conjuntos diferentes: o bônus planar está desativado.");

  // Traços
  const main = (c.skills || []).filter((s) => s.type === 2 && /^Point0[1-4]$/.test(s.anchor || ""));
  if (c.level >= 70) for (const s of main) {
    const max = s.anchor === "Point01" ? 6 : 10;
    if (s.level <= max - 3) add(2, `Traço "${s.name || s.anchor}" no nível ${s.level}: subir (máx. ${max}).`);
  }
  const minorOff = (c.skills || []).filter((s) => s.type !== 2 && s.active === false).length;
  if (c.level >= 70 && minorOff >= 3) add(3, `${minorOff} traços menores ainda não desbloqueados.`);

  const score = Math.round((total / 6) * 100);
  const grade = score >= 70 ? ["Ótima", "good"] : score >= 50 ? ["Boa", "good"] : score >= 30 ? ["Média", "warn"] : ["Fraca", "bad"];
  issues.sort((a, b) => a.p - b.p);
  return { score, grade, issues, pieces: pieceScores };
}

/* ---------------- Renderização ---------------- */
const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "?");
const verdictPill = { high: ["Prioridade alta", "good"], mid: ["Considerar", "warn"], low: ["Pular", "bad"], skip: ["Já tem", "info"] };
const tierPill = (t) => (t ? `<span class="pill accent">Tier ${esc(t)}</span>` : `<span class="pill">sem tier</span>`);

function avatar(c, cls = "") {
  if (c && c.icon) return `<img class="av ${cls}" src="${esc(c.icon)}" alt="" loading="lazy">`;
  const label = c ? c.display : "?";
  return `<span class="av ${cls}" style="display:grid;place-items:center;font-weight:700">${esc(label.slice(0, 1))}</span>`;
}

function teamCard(r, opts = {}) {
  const status = r.missing ? `<span class="pill bad">Falta ${r.missing}</span>` : r.subs ? `<span class="pill warn">Montável com substitutos</span>` : `<span class="pill good">Completo</span>`;
  const slots = r.slots.map((s) => {
    if (!s.char) {
      const ban = bannerTag(s.wanted);
      return `<div class="slot">${avatar(null, "missing")}<span class="nm">${esc(s.wanted[0])}</span><span class="muted">${esc(s.slot.role)}</span>${ban}</div>`;
    }
    return `<div class="slot">${avatar(s.char, s.ideal ? "" : "sub")}<span class="nm">${esc(s.char.display)}</span><span class="muted">${s.ideal ? esc(s.slot.role) : "substituto"}</span></div>`;
  }).join("");
  const missingTxt = r.slots.filter((s) => !s.char).map((s) => `<li>${esc(s.slot.role)}: ${s.wanted.map(esc).join(" / ")}</li>`).join("");
  return `<article class="card">
    <div class="row between wrap"><h3>${opts.rank ? `${opts.rank}. ` : ""}${esc(r.team.name)}</h3><div class="row">${status}<span class="pill accent">${esc(r.team.tier)}</span></div></div>
    <div class="muted small">${r.team.modes.map((m) => MODE_NAMES[m]).join(" · ")}${r.missing ? "" : ` · build média ${Math.round(r.avgBuild)}/100`}</div>
    <div class="slots">${slots}</div>
    ${missingTxt ? `<ul class="list small">${missingTxt}</ul>` : ""}
    ${r.team.notes ? `<p class="small muted">${esc(r.team.notes)}</p>` : ""}
  </article>`;
}

function bannerTag(names) {
  for (const b of A.banners) if (names.some((n) => b.five.some((f) => norm(f) === norm(n)))) {
    return `<span class="pill ${b.status === "now" ? "good" : "info"}">${b.status === "now" ? "no banner" : "próx. banner"}</span>`;
  }
  if (A.free && names.some((n) => A.free.options.some((f) => norm(f) === norm(n)))) return `<span class="pill good">grátis</span>`;
  return "";
}

const RENDER = {
  home() {
    const nowBanners = A.banners.filter((b) => b.status === "now");
    const pulls = nowBanners.flatMap((b) => b.picks).filter((p) => !p.owned).sort((a, b) => ({ high: 0, mid: 1, low: 2 }[a.verdict] - { high: 0, mid: 1, low: 2 }[b.verdict]));
    const todo = [];
    if (A.free) todo.push(`<b>Resgate o 5★ grátis:</b> ${esc(A.free.best.name)}. ${esc(A.free.best.why)} <span class="muted">(até ${fmtDate(A.free.until)})</span>`);
    const top = pulls[0];
    if (top) todo.push(top.verdict === "high" ? `<b>Banner atual:</b> vale puxar ${esc(top.name)}. ${esc(top.why)}` :
      `<b>Banner atual:</b> nenhum personagem é prioridade para a sua conta agora. Melhor opção: ${esc(top.name)} (${verdictPill[top.verdict][0].toLowerCase()}). Considere guardar as jades.`);
    for (const { c } of A.invest.slice(0, 5)) {
      const i = c.build.issues[0];
      todo.push(`<b>${esc(c.display)}:</b> ${esc(i.text)}`);
    }
    const pair = A.pair;
    const eg = DATA.endgame || {};
    const egTxt = ["moc", "pf", "as"].map((k) => eg[k] && eg[k].has_data ? `<span class="pill">${{ moc: "MoC", pf: "PF", as: "AS" }[k]}: ${eg[k].stars}★</span>` : "").join(" ");
    return `
      <article class="card"><h2 style="margin-top:0">O que fazer agora</h2><ol class="todo">${todo.map((t) => `<li>${t}</li>`).join("")}</ol></article>
      ${pair ? `<h2>Seus 2 melhores times (sem repetir personagem)</h2><div class="grid two">${teamCard(pair.a)}${teamCard(pair.b)}</div>`
        : `<h2>Melhor time montável</h2>${A.teams[0] ? teamCard(A.teams[0]) : "<p>—</p>"}`}
      <article class="card"><div class="row between wrap"><h3>Sua conta</h3>${egTxt}</div>
        <p class="muted small">${A.chars.length} personagens · ${A.chars.filter((c) => c.rarity === 5).length} 5★ · build média ${Math.round(A.chars.reduce((a, c) => a + c.build.score, 0) / (A.chars.length || 1))}/100</p></article>
      <article class="card"><h3>Dicas F2P</h3><ul class="list small">${META.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></article>`;
  },

  teams() {
    const ready = A.teams.filter((t) => !t.missing), almost = A.teams.filter((t) => t.missing && !t.coreMissing), far = A.teams.filter((t) => t.coreMissing);
    let n = 0;
    const sec = (title, list, sub) => list.length ? `<h2>${title}</h2><p class="muted small">${sub}</p>${list.map((r) => teamCard(r, { rank: ++n })).join("")}` : "";
    return sec("Montáveis agora", ready, "Em ordem de prioridade: força no meta, quantos substitutos usa e a qualidade das suas builds.") +
      sec("Quase lá", almost, "Você tem o DPS principal; falta pouco.") +
      sec("Você ainda não tem o DPS", far, "Bom para planejar os próximos banners.");
  },

  chars() {
    return `<div class="filters"><label class="small muted">Ordenar <select id="sort">
        <option value="prio">Prioridade de investimento</option><option value="tier">Tier no meta</option><option value="score">Pior build primeiro</option><option value="name">Nome</option>
      </select></label><label class="check small"><input type="checkbox" id="onlyTeams"> Só quem está nos meus times</label></div>
      <div id="charList" class="grid"></div>`;
  },

  banners() {
    const st = { now: ["Ativo", "good"], next: ["Em breve", "info"] };
    const free = A.free ? `<article class="card"><div class="row between wrap"><h3>${esc(A.free.name)}</h3><span class="pill good">até ${fmtDate(A.free.until)}</span></div>
      <p class="small muted">${esc(A.free.note)}</p>
      ${A.free.opts.map((p) => pickRow(p, p === A.free.best)).join("")}</article>` : "";
    return free + A.banners.map((b) => `<article class="card">
      <div class="row between wrap"><h3>${esc(b.phase)}</h3><div class="row"><span class="pill ${st[b.status][1]}">${st[b.status][0]}</span>${b.confirmed ? "" : `<span class="pill warn">não confirmado</span>`}</div></div>
      <div class="muted small">${fmtDate(b.start)} → ${fmtDate(b.end)}${b.four.length ? ` · 4★: ${b.four.map(esc).join(", ")}` : ""}</div>
      ${b.picks.map((p) => pickRow(p)).join("")}
      ${b.note ? `<p class="small muted">${esc(b.note)}</p>` : ""}</article>`).join("") +
      `<p class="small muted">Lembrete: o pity de personagem (90, 50/50) é compartilhado entre os banners de personagem; o de cone de luz é separado (80, 75%).</p>`;
  },

  content() {
    return A.content.map((m) => `<article class="card">
      <div class="row between wrap"><h3>${esc(m.name)}</h3><span class="pill ${m.now ? "good" : "info"}">${m.now ? "ativo" : "em breve"}</span></div>
      <div class="muted small">${fmtDate(m.start)} → ${fmtDate(m.end)}</div><p class="small">${esc(m.desc)}</p>
      ${m.fits.length ? `<p class="small"><b>Seus times indicados:</b> ${m.fits.map((f) => `${esc(f.t.team.name)}${f.fav ? " ★" : ""}`).join(" · ")}</p>` : `<p class="small muted">Nenhum time completo seu está marcado para este modo.</p>`}
    </article>`).join("") + `<p class="small muted">★ = o time combina com o buff da temporada.</p>`;
  },
};

function pickRow(p, best = false) {
  const [label, cls] = verdictPill[p.verdict];
  return `<div class="row" style="margin-top:.6rem;align-items:flex-start">${avatar(p.char || null, p.owned ? "" : "missing")}
    <div><div class="row wrap"><b>${esc(p.name)}</b>${tierPill(p.tier)}<span class="pill ${cls}">${label}</span>${best ? `<span class="pill good">recomendado</span>` : ""}</div>
    <p class="small muted">${esc(p.why)}</p></div></div>`;
}

function charCard(c) {
  const g = c.build.grade;
  const relics = [...c.relics, ...c.ornaments].sort((a, b) => a.pos - b.pos).map((r) => `<div class="relic">
      <b>${SLOT_NAMES[r.pos]}</b> <span class="muted">+${r.level} ${r.rarity}★</span><br>
      <span class="${r.main.good ? "good" : ""}">${esc(r.main.name)} ${esc(r.main.value)}</span>
      <div class="muted">${r.subs.map((s) => `<span class="${s.good ? "good" : ""}">${esc(s.name)} ${esc(s.value)}${s.rolls ? ` (+${s.rolls})` : ""}</span>`).join("<br>")}</div></div>`).join("");
  const inTeam = A.teamUse.has(c.display);
  return `<details class="card"><summary><div class="char-head">${avatar(c)}
      <div class="grow"><div class="row wrap"><b>${esc(c.display)}</b><span class="muted small">Nv.${c.level} · E${c.eidolon}</span>${tierPill(c.tier)}${inTeam ? `<span class="pill info">nos times</span>` : ""}</div>
      <div class="row small"><span class="pill ${g[1]}">${g[0]} ${c.build.score}</span><span class="muted">${c.build.issues.length} sugest${c.build.issues.length === 1 ? "ão" : "ões"}</span></div>
      <div class="bar"><i style="width:${c.build.score}%"></i></div></div></div></summary>
    <p class="small muted" style="margin-top:.6rem">${esc(c.element)} · ${esc(c.path)} · Cone: ${c.lightcone ? `${esc(c.lightcone.name)} (Nv.${c.lightcone.level}, S${c.lightcone.superimposition})` : "nenhum"}</p>
    ${c.build.issues.length ? `<ol class="issues small">${c.build.issues.map((i) => `<li class="p${i.p}"><span style="color:var(--text)">${esc(i.text)}</span></li>`).join("")}</ol>` : `<p class="small good">Nada urgente para mudar.</p>`}
    <div class="relics">${relics}</div>
    <p class="small muted">Verde = status recomendado pela HoYoLAB para este personagem. (+n) = upgrades que caíram naquele substatus.</p></details>`;
}

function bindCharFilters() {
  const draw = () => {
    const sort = $("#sort").value, only = $("#onlyTeams").checked;
    let list = A.chars.filter((c) => !only || A.teamUse.has(c.display));
    const prio = new Map(A.invest.map((x, i) => [x.c.display, i]));
    const cmp = {
      prio: (a, b) => (prio.get(a.display) ?? 1e9) - (prio.get(b.display) ?? 1e9),
      tier: (a, b) => b.tierVal - a.tierVal || b.build.score - a.build.score,
      score: (a, b) => a.build.score - b.build.score,
      name: (a, b) => a.display.localeCompare(b.display),
    }[sort];
    $("#charList").innerHTML = list.sort(cmp).map(charCard).join("") || `<p class="muted">Nenhum personagem.</p>`;
  };
  $("#sort").addEventListener("change", draw);
  $("#onlyTeams").addEventListener("change", draw);
  draw();
}

boot();
