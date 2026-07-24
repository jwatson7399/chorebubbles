import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as d3 from "d3";
import {
  getSharedRecord,
  compareAndSetShared,
  getPendingOperations,
  enqueueOperation,
  removePendingOperations,
  getAuthSession,
  onAuthSessionChange,
  sendMagicLink,
  verifyEmailOtp,
  signOut,
  getMe as loadMe,
  setMe as saveMe,
  isSynced,
} from "./storage.js";
import {
  bothStreak,
  effortZone,
  effortZoneThresholds,
  pausedDuration,
  pointsInActivePeriod,
  suggestCombo,
  weeklyPoints,
} from "./logModel.js";
import {
  choreHistoryFor,
  completionActor,
  completionImpact,
  lastDoneLabel,
} from "./choreHistory.js";
import { clampBubbleCenter, releaseBubbleNode } from "./bubblePhysics.js";
import { clampBubbleRadius, usesCompactBubbleLabel } from "./bubblePresentation.js";
import {
  advanceTwoStepChore,
  disableTwoStepChore,
  enableTwoStepChore,
  isTwoStepChore,
  materializeTwoStepChore,
  updateTwoStep,
} from "./twoStepChore.js";

// ChoreBubbles: a shared household chore ecosystem.
// Bubbles swell as chores go undone. Tap to complete, drag to rearrange.


// Soft pastel color spread evenly around the wheel via the golden angle, so
// each bubble gets a distinct hue and the range keeps widening with more chores.
// Returns 6-digit hex so the existing `${hue}AA` alpha suffixes keep working.
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
const bubbleHue = (i) => hslToHex((i * 137.508) % 360, 62, 68);

const STARTERS = [
  { name: "Dishes", importance: 4, difficulty: 1, freqDays: 1, service: false },
  { name: "Kitchen counters", importance: 4, difficulty: 1, freqDays: 2, service: true },
  { name: "Trash + recycling", importance: 3, difficulty: 1, freqDays: 3, service: false },
  { name: "Laundry", importance: 4, difficulty: 2, freqDays: 4, service: false },
  { name: "Vacuum floors", importance: 3, difficulty: 2, freqDays: 7, service: true },
  { name: "Bathroom clean", importance: 4, difficulty: 3, freqDays: 7, service: true },
  { name: "Change sheets", importance: 3, difficulty: 2, freqDays: 14, service: false },
  { name: "Mop floors", importance: 2, difficulty: 3, freqDays: 14, service: true },
  { name: "Fridge clean-out", importance: 2, difficulty: 2, freqDays: 14, service: false },
  { name: "Dust surfaces", importance: 2, difficulty: 2, freqDays: 14, service: true },
];

const uid = () => Math.random().toString(36).slice(2, 10);
const DAY = 86400000;
const INTRO_KEY = "chorebubbles:seenIntro:v1";
const realNow = () => Date.now();
// Simulation support: shifts the app's sense of "now" forward for testing
let TIME_OFFSET = 0;
const now = () => Date.now() + TIME_OFFSET;

const defaultData = () => ({
  chores: [],
  completions: [],
  pauses: [],
  settings: { nameA: "Julian", nameB: "Kristine", weeklyGoal: 14 },
  updatedAt: 0,
});

function normalizeData(value) {
  const defaults = defaultData();
  const source = value && typeof value === "object" ? value : {};
  return {
    ...defaults,
    ...source,
    chores: Array.isArray(source.chores) ? source.chores : [],
    completions: Array.isArray(source.completions) ? source.completions : [],
    pauses: Array.isArray(source.pauses) ? source.pauses : [],
    settings: { ...defaults.settings, ...(source.settings || {}) },
  };
}

// Operations are intentionally small and replayable. When two phones edit at
// once, each operation is applied to the newest server state instead of either
// phone replacing the other phone's entire snapshot.
function applyOperation(value, op) {
  const data = normalizeData(value);
  let next = data;

  switch (op.type) {
    case "completion:add": {
      if (data.completions.some((item) => item.id === op.completion.id)) break;
      next = { ...data, completions: [...data.completions, op.completion] };
      break;
    }
    case "completion:add-many": {
      const known = new Set(data.completions.map((item) => item.id));
      next = { ...data, completions: [...data.completions, ...(op.completions || []).filter((item) => !known.has(item.id))] };
      break;
    }
    case "completion:add-and-advance": {
      if (data.completions.some((item) => item.id === op.completion.id)) break;
      const chores = data.chores.map((item) =>
        item.id === op.choreId ? advanceTwoStepChore(item) : item
      );
      next = { ...data, chores, completions: [...data.completions, op.completion] };
      break;
    }
    case "completion:remove-and-restore": {
      const ids = new Set(op.ids || []);
      const chores = data.chores.map((item) =>
        item.id === op.chore?.id ? op.chore : item
      );
      next = { ...data, chores, completions: data.completions.filter((item) => !ids.has(item.id)) };
      break;
    }
    case "completion:remove": {
      const ids = new Set(op.ids || []);
      next = { ...data, completions: data.completions.filter((item) => !ids.has(item.id)) };
      break;
    }
    case "chore:upsert": {
      const exists = data.chores.some((item) => item.id === op.chore.id);
      const chores = exists
        ? data.chores.map((item) => (item.id === op.chore.id ? op.chore : item))
        : [...data.chores, op.chore];
      next = { ...data, chores };
      break;
    }
    case "chore:add-many": {
      const known = new Set(data.chores.map((item) => item.id));
      next = { ...data, chores: [...data.chores, ...(op.chores || []).filter((item) => !known.has(item.id))] };
      break;
    }
    case "chore:delete":
      next = { ...data, chores: data.chores.filter((item) => item.id !== op.choreId) };
      break;
    case "chore:clear":
      next = { ...data, chores: [] };
      break;
    case "pause:set": {
      let pauses = [...data.pauses];
      const active = pauses.filter((item) => item.scope === op.scope && item.end == null);
      if (op.active && active.length === 0) {
        pauses.push({ id: op.pauseId, scope: op.scope, start: op.at, end: null });
      } else if (!op.active && active.length > 0) {
        const activeIds = new Set(active.map((item) => item.id));
        pauses = pauses.map((item) => (activeIds.has(item.id) ? { ...item, end: op.at } : item));
      }
      next = { ...data, pauses };
      break;
    }
    case "settings:patch":
      next = { ...data, settings: { ...data.settings, ...op.patch } };
      break;
    default:
      break;
  }

  return { ...next, updatedAt: Math.max(next.updatedAt || 0, op.createdAt || 0) };
}

const activePause = (pauses, scope) => (pauses || []).find((p) => p.scope === scope && p.end == null);

function lastDone(chore, completions) {
  let t = chore.createdAt || 0;
  for (const c of completions) if (c.choreId === chore.id && c.ts > t) t = c.ts;
  return t;
}

function urgencyOf(chore, completions, pauses) {
  const last = lastDone(chore, completions);
  const elapsed = (now() - last - pausedDuration(pauses, ["house"], last, now())) / DAY;
  return elapsed / Math.max(chore.freqDays, 0.25);
}

// Weighted share of chores currently inside their frequency window
function healthScore(chores, completions, pauses) {
  if (!chores.length) return 1;
  let num = 0, den = 0;
  for (const ch of chores) {
    const u = urgencyOf(ch, completions, pauses);
    const s = Math.max(0, Math.min(2 - u, 1));
    num += s * ch.importance;
    den += ch.importance;
  }
  return den ? num / den : 1;
}

// The home's face: seven moods from loving bliss down to withering
function faceFor(pct) {
  if (pct >= 90) return "🥰🌱";
  if (pct >= 75) return "🙂";
  if (pct >= 60) return "😐";
  if (pct >= 45) return "😟";
  if (pct >= 30) return "😩";
  if (pct >= 15) return "😫";
  return "🥀";
}

function timeAgo(ts) {
  const m = Math.floor((now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  return d + "d ago";
}

function historyDate(ts) {
  const date = new Date(Number(ts));
  if (!Number.isFinite(date.getTime())) return "Unknown date";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---------- Bubble field ----------
function BubbleField({ chores, completions, pauses, onTap, popId, simDays, suggestedIds }) {
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 360, h: 480 });
  const [nodes, setNodes] = useState([]);
  const simRef = useRef(null);
  const nodesRef = useRef([]);
  const dragRef = useRef(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const targets = useMemo(() => {
    const n = Math.max(chores.length, 1);
    // Size bubbles so the set comfortably fills ~55% of the container area
    const areaBudget = (size.w * size.h * 0.55) / n;
    const baseR = Math.sqrt(areaBudget / Math.PI);
    return chores.map((ch, i) => {
      const u = Math.min(urgencyOf(ch, completions, pauses), 2.2);
      // Importance sets the baseline footprint: a Critical chore starts about
      // twice the diameter of a Low one (imp 1 -> 0.66, imp 5 -> 1.30)
      const impW = 0.5 + 0.16 * ch.importance;
      // Urgency swells the bubble from its fresh size toward overdue
      const growth = 0.5 + 0.8 * (u / 2.2);
      const r = clampBubbleRadius(baseR * impW * growth);
      return { id: ch.id, chore: ch, r, urgency: urgencyOf(ch, completions, pauses), hue: bubbleHue(i) };
    });
  }, [chores, completions, pauses, size, simDays]);

  useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const count = targets.length;
    const ring = Math.min(size.w, size.h) * 0.32;
    const next = targets.map((t, i) => {
      const p = prev.get(t.id);
      if (p) return Object.assign(p, { r: t.r, chore: t.chore, urgency: t.urgency, hue: t.hue });
      // New bubbles enter spread around a ring, not stacked at the center
      const angle = (i / Math.max(count, 1)) * Math.PI * 2;
      return { ...t, x: size.w / 2 + Math.cos(angle) * ring, y: size.h / 2 + Math.sin(angle) * ring };
    });
    nodesRef.current = next;
    if (simRef.current) simRef.current.stop();
    const sim = d3
      .forceSimulation(next)
      .force("x", d3.forceX(size.w / 2).strength(0.035))
      .force("y", d3.forceY(size.h / 2).strength(0.042))
      .force("collide", d3.forceCollide((d) => d.r + 7).strength(1).iterations(3))
      .velocityDecay(0.28)
      .alpha(0.9)
      .alphaDecay(0.012)
      .alphaMin(0.001)
      .on("tick", () => {
        for (const n of next) {
          n.x = Math.max(n.r + 4, Math.min(size.w - n.r - 4, n.x));
          n.y = Math.max(n.r + 4, Math.min(size.h - n.r - 4, n.y));
        }
        setNodes([...next]);
      });
    simRef.current = sim;
    return () => sim.stop();
  }, [targets, size.w, size.h]);

  const onPointerDown = (e, node) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    node.vx = 0;
    node.vy = 0;
    dragRef.current = {
      id: node.id,
      pointerId: e.pointerId,
      startX: x,
      startY: y,
      lastX: x,
      lastY: y,
      lastTime: e.timeStamp,
      velocityX: 0,
      velocityY: 0,
      offsetX: node.x - x,
      offsetY: node.y - y,
      moved: false,
    };
  };

  const onPointerMove = (e, node) => {
    const d = dragRef.current;
    if (!d || d.id !== node.id || d.pointerId !== e.pointerId) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - d.startX;
    const dy = y - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > 8) {
      d.moved = true;
      if (simRef.current) simRef.current.alphaTarget(0.18).restart();
    }
    if (d.moved) {
      const elapsed = Math.max(e.timeStamp - d.lastTime, 8);
      const sampleVelocityX = ((x - d.lastX) / elapsed) * 16;
      const sampleVelocityY = ((y - d.lastY) / elapsed) * 16;
      d.velocityX = d.velocityX * 0.65 + sampleVelocityX * 0.35;
      d.velocityY = d.velocityY * 0.65 + sampleVelocityY * 0.35;
      d.lastX = x;
      d.lastY = y;
      d.lastTime = e.timeStamp;
      node.fx = clampBubbleCenter(x + d.offsetX, size.w, node.r);
      node.fy = clampBubbleCenter(y + d.offsetY, size.h, node.r);
    }
  };

  const finishDrag = (node, pointerId, allowTap) => {
    const d = dragRef.current;
    if (!d || d.id !== node.id || (pointerId != null && d.pointerId !== pointerId)) return;
    dragRef.current = null;
    // Blend the user's release velocity with a gentle inward pull. Reheating
    // is essential here: alphaTarget(0) alone can leave a cooled simulation
    // parked exactly where the pointer was released.
    releaseBubbleNode(node, d, size, simRef.current);

    setNodes([...nodesRef.current]);
    if (allowTap && !d.moved) onTap(node.chore);
  };

  const onPointerUp = (e, node) => {
    finishDrag(node, e.pointerId, true);
  };

  const onPointerCancel = (e, node) => {
    finishDrag(node, e.pointerId, false);
  };

  const onLostPointerCapture = (e, node) => {
    // iOS can end a gesture via lost capture without delivering pointerup.
    // Always release the fixed coordinates so the bubble cannot remain pinned.
    finishDrag(node, e.pointerId, false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: 1, overflow: "hidden", touchAction: "none" }}>
      {chores.length === 0 && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#7FA3AC", fontSize: 15, textAlign: "center", padding: 32 }}>
          No chores yet. Head to the Chores tab to add your list.
        </div>
      )}
      {nodes.map((n) => {
        const due = n.urgency >= 1;
        const overdue = n.urgency >= 1.5;
        const suggested = suggestedIds?.has(n.id);
        const compactLabel = usesCompactBubbleLabel(n.r);
        const bubbleShadow = due
          ? `0 0 ${overdue ? 26 : 14}px ${n.hue}${overdue ? "AA" : "66"}, inset 0 0 12px rgba(255,255,255,0.25)`
          : "inset 0 0 10px rgba(255,255,255,0.18)";
        return (
          <div
            key={n.id}
            aria-label={`${n.chore.name}, ${n.chore.difficulty} point${n.chore.difficulty === 1 ? "" : "s"}${suggested ? ", suggested chore" : ""}`}
            data-label-mode={compactLabel ? "compact" : "full"}
            onPointerDown={(e) => onPointerDown(e, n)}
            onPointerMove={(e) => onPointerMove(e, n)}
            onPointerUp={(e) => onPointerUp(e, n)}
            onPointerCancel={(e) => onPointerCancel(e, n)}
            onLostPointerCapture={(e) => onLostPointerCapture(e, n)}
            style={{
              position: "absolute",
              left: n.x - n.r,
              top: n.y - n.r,
              width: n.r * 2,
              height: n.r * 2,
              borderRadius: "50%",
              background: `radial-gradient(circle at 32% 30%, ${n.hue}F5, ${n.hue}AA 60%, ${n.hue}66)`,
              boxShadow: suggested
                ? `${bubbleShadow}, 0 0 0 3px #FFD95A, 0 0 22px #FFD95ADD, 0 0 42px #FFD95A88`
                : bubbleShadow,
              outline: suggested ? "2px solid #FFF0A6" : "none",
              outlineOffset: suggested ? 3 : 0,
              border: due ? `2px solid ${n.hue}` : `1.5px solid ${n.hue}66`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: dragRef.current && dragRef.current.id === n.id ? "grabbing" : "grab",
              userSelect: "none",
              WebkitTapHighlightColor: "transparent",
              animation: popId === n.id ? `pop 0.65s ease-out` : `breathe ${overdue ? 2.2 : 3.6}s ease-in-out infinite`,
              transition: "width 0.7s cubic-bezier(0.34, 1.4, 0.5, 1), height 0.7s cubic-bezier(0.34, 1.4, 0.5, 1), box-shadow 0.35s ease, outline-color 0.35s ease",
              zIndex: dragRef.current && dragRef.current.id === n.id ? 5 : suggested ? 3 : 1,
            }}
          >
            {popId === n.id && (
              <span style={{ position: "absolute", top: -14, right: -6, fontSize: 20, animation: "sparkleUp 0.9s ease-out forwards", pointerEvents: "none" }}>✨</span>
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 1,
                width: compactLabel ? "96%" : "82%",
                padding: compactLabel ? 2 : 4,
                overflow: "hidden",
                pointerEvents: "none",
                transform: compactLabel ? "translateY(-2px)" : "none",
              }}
            >
              <span
                style={{
                  fontFamily: "'Baloo 2', sans-serif",
                  fontWeight: 700,
                  fontSize: Math.max(10.5, Math.min(n.r * 0.28, 16)),
                  color: "#0C1B26",
                  textAlign: "center",
                  lineHeight: 1.06,
                  width: "100%",
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: compactLabel ? 2 : 3,
                  overflow: "hidden",
                  overflowWrap: "break-word",
                }}
              >
                {n.chore.name}
              </span>
              {!compactLabel && (
                <span
                  style={{
                    fontFamily: "'Baloo 2', sans-serif",
                    fontWeight: 800,
                    fontSize: Math.max(9, Math.min(n.r * 0.22, 12)),
                    color: "#0C1B26",
                    opacity: 0.62,
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {n.chore.difficulty} pt{n.chore.difficulty === 1 ? "" : "s"}
                </span>
              )}
            </div>
            {compactLabel && (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  right: "7%",
                  bottom: "6%",
                  width: Math.max(16, Math.min(n.r * 0.56, 20)),
                  height: Math.max(16, Math.min(n.r * 0.56, 20)),
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  background: "rgba(12,27,38,0.88)",
                  color: "#E8F3F4",
                  border: "1px solid rgba(255,255,255,0.4)",
                  fontFamily: "'Baloo 2', sans-serif",
                  fontWeight: 800,
                  fontSize: 10,
                  lineHeight: 1,
                  pointerEvents: "none",
                }}
              >
                {n.chore.difficulty}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Shared UI bits ----------
const btnStyle = (bg, color = "#0C1B26") => ({
  background: bg,
  color,
  border: "none",
  borderRadius: 14,
  padding: "13px 18px",
  fontSize: 15,
  fontFamily: "'Baloo 2', sans-serif",
  fontWeight: 600,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
});

function Modal({ children, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(6,14,20,0.72)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#16303C", borderRadius: "22px 22px 0 0", padding: "22px 20px 34px", width: "100%", maxWidth: 480, maxHeight: "92dvh", overflowY: "auto", boxShadow: "0 -8px 40px rgba(0,0,0,0.5)" }}
      >
        {children}
      </div>
    </div>
  );
}

function Stepper({ label, value, min, max, onChange, format }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
      <span style={{ color: "#B9D2D8", fontSize: 14 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => onChange(Math.max(min, value - 1))} style={{ ...btnStyle("#0F2530", "#5FE0BB"), padding: "6px 14px", fontSize: 18 }}>-</button>
        <span style={{ color: "#E8F3F4", fontSize: 15, minWidth: 56, textAlign: "center", fontWeight: 600 }}>{format ? format(value) : value}</span>
        <button onClick={() => onChange(Math.min(max, value + 1))} style={{ ...btnStyle("#0F2530", "#5FE0BB"), padding: "6px 14px", fontSize: 18 }}>+</button>
      </div>
    </div>
  );
}

// A full 1-N scale where every step is visible and tappable, so you can see
// where your choice sits on the whole range instead of clicking a dial.
function ScaleSelector({ label, hint, value, min, max, onChange, valueLabel, endLabels }) {
  const options = [];
  for (let i = min; i <= max; i++) options.push(i);
  return (
    <div style={{ padding: "12px 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ color: "#E8F3F4", fontSize: 14, fontWeight: 600 }}>{label}</span>
        {valueLabel && <span style={{ color: "#5FE0BB", fontSize: 13, fontWeight: 700 }}>{valueLabel(value)}</span>}
      </div>
      {hint && <div style={{ color: "#7FA3AC", fontSize: 11.5, marginTop: 2 }}>{hint}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
        {options.map((n) => {
          const active = n === value;
          return (
            <button
              key={n}
              onClick={() => onChange(n)}
              aria-pressed={active}
              style={{
                flex: 1,
                padding: "11px 0",
                borderRadius: 10,
                border: active ? "none" : "1px solid #1E4152",
                background: active ? "#5FE0BB" : "#0F2530",
                color: active ? "#0C1B26" : "#B9D2D8",
                fontFamily: "'Baloo 2', sans-serif",
                fontWeight: 700,
                fontSize: 15,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
                transition: "background 0.15s ease, color 0.15s ease",
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
      {endLabels && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, color: "#7FA3AC", fontSize: 10.5 }}>
          <span>{endLabels[0]}</span>
          <span>{endLabels[1]}</span>
        </div>
      )}
    </div>
  );
}

function ChoreFields({ title, value, onChange }) {
  const importanceText = (level) => ["", "Low", "Mild", "Medium", "High", "Critical"][level];
  const effortText = (level) => ["", "Very easy", "Easy", "Moderate", "Hard", "Very hard"][level];
  return (
    <section style={title ? { marginTop: 12, padding: "12px 12px 4px", background: "#102733", border: "1px solid #1A3B49", borderRadius: 14 } : undefined}>
      {title && <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 15, fontWeight: 700, color: "#5FE0BB", marginBottom: 8 }}>{title}</div>}
      <input
        value={value.name}
        placeholder={`${title || "Chore"} name`}
        onChange={(event) => onChange({ name: event.target.value })}
        style={{ width: "100%", background: "#0F2530", border: "1px solid #1E4152", borderRadius: 12, padding: "12px 14px", color: "#E8F3F4", fontSize: 15, fontFamily: "inherit", marginBottom: 6 }}
      />
      <ScaleSelector label="Importance" hint="How much does it matter if this slips?" value={value.importance} min={1} max={5} onChange={(importance) => onChange({ importance })} valueLabel={importanceText} endLabels={["Low", "Critical"]} />
      <ScaleSelector label="Effort" hint="How hard is this step?" value={value.difficulty} min={1} max={5} onChange={(difficulty) => onChange({ difficulty })} valueLabel={effortText} endLabels={["Very easy", "Very hard"]} />
      <Stepper label="Goal frequency" value={value.freqDays} min={1} max={60} onChange={(freqDays) => onChange({ freqDays })} format={(days) => `every ${days}d`} />
    </section>
  );
}

// Slim zoned bar for the Bubbles tab, so popping a bubble shows your tally move
// without leaving the screen. The full breakdown still lives on the Log tab.
function CompactBar({ name, points, goal, greenStart, paused = false }) {
  const safeGoal = Math.max(Number(goal) || 0, 1);
  const zone = effortZone(points, safeGoal, greenStart);
  const percent = Math.max(0, Math.min((points / safeGoal) * 100, 100));
  const buildingPct = Math.round((zone.buildingMin / zone.fullScale) * 100);
  const greenPct = Math.round((zone.greenMin / zone.fullScale) * 100);
  return (
    <div style={{ flex: 1, minWidth: 0, opacity: paused ? 0.62 : 1 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#E8F3F4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name}{paused ? " 🏖" : ""}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: zone.color, whiteSpace: "nowrap" }}>{points}/{goal}</span>
      </div>
      <div aria-hidden="true" style={{ textAlign: "center", fontSize: 11, lineHeight: 1, marginBottom: 2 }}>{zone.emoji}</div>
      <div style={{ position: "relative", height: 7, borderRadius: 5, background: `linear-gradient(to right, #FF8B7B30 0 ${buildingPct}%, #FFC65E30 ${buildingPct}% ${greenPct}%, #5FE0BB30 ${greenPct}% 100%)`, border: "1px solid #1E4152", overflow: "hidden" }}>
        <div style={{ width: `${percent}%`, height: "100%", borderRadius: 5, background: zone.color, transition: "width 0.6s ease, background 0.3s ease" }} />
        <div aria-hidden="true" style={{ position: "absolute", inset: `0 auto 0 ${buildingPct}%`, width: 1, background: "#D8E9EC55" }} />
        <div aria-hidden="true" style={{ position: "absolute", inset: `0 auto 0 ${greenPct}%`, width: 1, background: "#D8E9EC88" }} />
      </div>
    </div>
  );
}

function ProgressRow({ label, points, goal, hue, paused = false, prominent = false, zoned = false, greenStart }) {
  const safeGoal = Math.max(Number(goal) || 0, 1);
  const percent = Math.max(0, Math.min((points / safeGoal) * 100, 100));
  const zone = zoned ? effortZone(points, safeGoal, greenStart) : null;
  const complete = zoned ? zone.key === "green" : points >= safeGoal;
  const fillColor = zone?.color || hue;
  // Place the visual zone bands at the actual thresholds (green start is configurable)
  const buildingPct = zone ? Math.round((zone.buildingMin / zone.fullScale) * 100) : 40;
  const greenPct = zone ? Math.round((zone.greenMin / zone.fullScale) * 100) : 80;

  return (
    <div style={{ padding: prominent ? "14px 0 12px" : "12px 0", opacity: paused ? 0.72 : 1 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: prominent ? 18 : 16, fontWeight: 700, color: "#E8F3F4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label}
          </span>
          {paused && <span style={{ color: "#9FD4EA", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>🏖 away</span>}
          {zone && (
            <span
              key={zone.key}
              style={{
                color: zone.color,
                background: `${zone.color}18`,
                border: `1px solid ${zone.color}66`,
                borderRadius: 999,
                padding: "2px 7px",
                fontSize: 10.5,
                lineHeight: 1.2,
                fontWeight: 800,
                whiteSpace: "nowrap",
                animation: zone.key === "green" ? "greenArrival 0.7s ease-out" : "none",
              }}
            >
              {zone.label}
            </span>
          )}
        </div>
        <span style={{ color: complete ? "#5FE0BB" : paused ? "#9FD4EA" : "#B9D2D8", fontSize: prominent ? 16 : 14, fontWeight: 700, whiteSpace: "nowrap" }}>
          {points} / {goal}{zoned && complete ? " 🌱" : !zoned && complete ? " ✓" : ""}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label}: ${points} of ${goal} points${zone ? `, ${zone.label} zone` : ""}${paused ? ", away" : ""}`}
        aria-valuemin={0}
        aria-valuemax={safeGoal}
        aria-valuenow={Math.min(points, safeGoal)}
        style={{
          position: "relative",
          height: prominent ? 13 : 12,
          borderRadius: 8,
          background: zoned
            ? `linear-gradient(to right, #FF8B7B30 0 ${buildingPct}%, #FFC65E30 ${buildingPct}% ${greenPct}%, #5FE0BB30 ${greenPct}% 100%)`
            : "#0F2530",
          border: "1px solid #1E4152",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            borderRadius: 8,
            background: `linear-gradient(to right, ${fillColor}99, ${fillColor})`,
            boxShadow: complete ? `0 0 12px ${fillColor}88` : "none",
            transition: "width 0.7s ease, background 0.35s ease",
          }}
        />
        {zoned && (
          <>
            <div aria-hidden="true" style={{ position: "absolute", inset: `0 auto 0 ${buildingPct}%`, width: 1, background: "#D8E9EC55" }} />
            <div aria-hidden="true" style={{ position: "absolute", inset: `0 auto 0 ${greenPct}%`, width: 1, background: "#D8E9EC88" }} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Main app ----------
export default function ChoreBubbles() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!isSynced());
  const [authEmail, setAuthEmail] = useState("");
  const [authSent, setAuthSent] = useState(false);
  const [authCode, setAuthCode] = useState("");
  const [authError, setAuthError] = useState("");
  const [data, setData] = useState(null);
  const [me, setMe] = useState(null);
  const [askWho, setAskWho] = useState(false);
  const [tab, setTab] = useState("bubbles");
  const [tapChore, setTapChore] = useState(null);
  const [tapWhenDays, setTapWhenDays] = useState(0);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceSel, setServiceSel] = useState({});
  const [editChore, setEditChore] = useState(null);
  const [toast, setToast] = useState(null);
  const [popId, setPopId] = useState(null);
  const [syncState, setSyncState] = useState("");
  const [simDays, setSimDays] = useState(0);
  const [simData, setSimData] = useState(null);
  const [simOpen, setSimOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [suggestionSeed, setSuggestionSeed] = useState(0);
  const [bubbleSuggestionsVisible, setBubbleSuggestionsVisible] = useState(false);
  const [healthPulse, setHealthPulse] = useState(false);
  const prevHealthRef = useRef(null);
  const pulseTimer = useRef(null);
  const toastTimer = useRef(null);
  const popTimer = useRef(null);
  const dataRef = useRef(null);
  const busyRef = useRef(false);
  const flushPromiseRef = useRef(null);
  const simDaysRef = useRef(0);
  dataRef.current = data;
  simDaysRef.current = simDays;

  // While the time machine is running, edits (popping bubbles, service, pauses)
  // apply to a local sandbox copy that is never synced and is discarded on
  // returning to today. This keeps simulated play out of the shared household.
  const view = simDays > 0 && simData ? simData : data;

  const logStats = useMemo(() => {
    if (!view) return null;
    const at = now();
    const pauses = view.pauses || [];
    const goal = Number(view.settings?.weeklyGoal) || 14;
    const housePaused = !!activePause(pauses, "house");
    const soloAPaused = !!activePause(pauses, "a");
    const soloBPaused = !!activePause(pauses, "b");
    const aPaused = housePaused || soloAPaused;
    const bPaused = housePaused || soloBPaused;
    const pointsA = weeklyPoints(view.completions, "a", pauses, at);
    const pointsB = weeklyPoints(view.completions, "b", pauses, at);
    const { greenMin } = effortZoneThresholds(goal, view.settings?.greenStart);
    const previousA = pointsInActivePeriod(view.completions, "a", pauses, at, 1);
    const previousB = pointsInActivePeriod(view.completions, "b", pauses, at, 1);
    const streak = bothStreak(view.completions, greenMin, pauses, at);
    const urgencyById = Object.fromEntries(
      view.chores.map((chore) => [chore.id, urgencyOf(chore, view.completions, pauses)])
    );
    const myPoints = me === "b" ? pointsB : pointsA;
    const myPaused = me === "b" ? bPaused : aPaused;
    const gap = Math.max(0, greenMin - myPoints);
    const suggestion = me && !myPaused && gap > 0
      ? suggestCombo(view.chores, gap, urgencyById, suggestionSeed)
      : null;

    return {
      pauses,
      goal,
      greenMin,
      housePaused,
      soloAPaused,
      soloBPaused,
      aPaused,
      bPaused,
      pointsA,
      pointsB,
      previousA,
      previousB,
      previousHasActivity: previousA + previousB > 0,
      streak,
      myPaused,
      gap,
      suggestion,
    };
  }, [view, me, suggestionSeed, simDays]);

  const showToast = useCallback((msg, undoFn = null) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, undoFn });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  useEffect(() => {
    if (!isSynced()) return;
    let active = true;
    let unsubscribe = () => {};
    (async () => {
      try {
        const current = await getAuthSession();
        if (active) setSession(current);
        unsubscribe = onAuthSessionChange((nextSession) => {
          setSession(nextSession);
          if (!nextSession) setData(null);
        });
      } catch (error) {
        if (active) setAuthError(error.message || "Could not check sign-in status.");
      } finally {
        if (active) setAuthReady(true);
      }
    })();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const flushQueue = useCallback(async () => {
    if (flushPromiseRef.current) return flushPromiseRef.current;

    const task = (async () => {
      busyRef.current = true;
      try {
        for (let attempt = 0; attempt < 8; attempt++) {
          const pending = getPendingOperations();
          if (pending.length === 0) {
            setSyncState("");
            return true;
          }

          setSyncState("syncing...");
          const remote = await getSharedRecord();
          const merged = pending.reduce(applyOperation, normalizeData(remote.value));
          const saved = await compareAndSetShared(merged, remote.revision);
          if (!saved.ok) continue;

          const remaining = removePendingOperations(pending.map((item) => item.id));
          const visible = remaining.reduce(applyOperation, normalizeData(saved.value));
          setData(visible);
        }
        throw new Error("The household changed repeatedly while saving.");
      } catch (error) {
        setSyncState(isSynced() ? "offline — changes queued" : "saved locally");
        return false;
      } finally {
        busyRef.current = false;
        flushPromiseRef.current = null;
      }
    })();

    flushPromiseRef.current = task;
    return task;
  }, []);

  const load = useCallback(async () => {
    if (busyRef.current) return;
    try {
      const remote = await getSharedRecord();
      const pending = getPendingOperations();
      const visible = pending.reduce(applyOperation, normalizeData(remote.value));
      setData(visible);
      setSyncState("");
      if (pending.length > 0) flushQueue();
    } catch (error) {
      setSyncState(error.message || "Unable to load this household.");
      if (!isSynced() && !dataRef.current) setData(defaultData());
    }
  }, [flushQueue]);

  useEffect(() => {
    if (!authReady || (isSynced() && !session)) return;
    (async () => {
      await load();
      const saved = loadMe();
      if (saved) setMe(saved);
      else setAskWho(true);
    })();
  }, [authReady, session, load]);

  useEffect(() => {
    if (!data || !me || askWho || simDays > 0) return;
    try {
      if (!localStorage.getItem(INTRO_KEY)) setIntroOpen(true);
    } catch {}
  }, [data, me, askWho, simDays]);

  useEffect(() => {
    if (!authReady || (isSynced() && !session)) return;
    const refresh = () => {
      load();
      flushQueue();
    };
    const iv = setInterval(refresh, 20000);
    const onVis = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [authReady, session, load, flushQueue]);

  const commit = useCallback((operation) => {
    // In the time machine, stamp with simulated "now" and keep edits local.
    if (simDaysRef.current > 0) {
      const simStamped = { ...operation, id: operation.id || uid(), createdAt: now() };
      setSimData((current) => applyOperation(current || dataRef.current, simStamped));
      return true;
    }
    const stamped = { ...operation, id: operation.id || uid(), createdAt: realNow() };
    enqueueOperation(stamped);
    setData((current) => applyOperation(current, stamped));
    flushQueue();
    return true;
  }, [flushQueue]);

  const requestMagicLink = async () => {
    const email = authEmail.trim().toLowerCase();
    if (!email) return;
    setAuthError("");
    try {
      await sendMagicLink(email);
      setAuthSent(true);
    } catch (error) {
      setAuthError(error.message || "Could not send the sign-in code.");
    }
  };

  const verifyCode = async () => {
    const email = authEmail.trim().toLowerCase();
    const token = authCode.replace(/\s/g, "");
    if (!email || !token) return;
    setAuthError("");
    try {
      const nextSession = await verifyEmailOtp(email, token);
      if (nextSession) setSession(nextSession);
    } catch (error) {
      setAuthError(error.message || "That code didn't work. Check it and try again.");
    }
  };

  const chooseMe = async (who) => {
    setMe(who);
    setAskWho(false);
    try { saveMe(who); } catch {}
  };

  const dismissIntro = () => {
    try { localStorage.setItem(INTRO_KEY, "1"); } catch {}
    setIntroOpen(false);
  };

  const setSim = (days) => {
    const d = Math.max(0, days);
    TIME_OFFSET = d * DAY;
    simDaysRef.current = d;
    // Seed the sandbox from real data when entering; drop it when back to today.
    if (d === 0) setSimData(null);
    else setSimData((current) => current || dataRef.current);
    setSimDays(d);
  };

  const resetActivity = () => {
    commit({ type: "completion:remove", ids: view.completions.map((item) => item.id) });
  };

  // Remove a single logged completion: drops it from the activity log, takes its
  // effort points back off, and regrows that chore's bubble. Undoable.
  const removeCompletion = (entry) => {
    if (!commit({ type: "completion:remove", ids: [entry.id] })) return;
    showToast(`Removed ${entry.choreName}`, () => {
      commit({ type: "completion:add", completion: entry });
      setToast(null);
    });
  };

  const togglePause = (scope) => {
    const active = !!activePause(view.pauses || [], scope);
    commit({ type: "pause:set", scope, active: !active, at: now(), pauseId: uid() });
  };

  const logCompletion = (chore, by) => {
    // "when" lets you backdate a chore you forgot to log (e.g. done yesterday).
    const ts = now() - tapWhenDays * DAY;
    const twoStep = isTwoStepChore(chore);
    const comp = {
      id: uid(),
      choreId: chore.id,
      choreName: chore.name,
      difficulty: chore.difficulty,
      by,
      ts,
      ...(twoStep ? { twoStepIndex: chore.twoStep.active } : {}),
    };
    const operation = twoStep
      ? { type: "completion:add-and-advance", completion: comp, choreId: chore.id }
      : { type: "completion:add", completion: comp };
    if (!commit(operation)) return;
    setTapChore(null);
    setTapWhenDays(0);
    setPopId(chore.id);
    if (popTimer.current) clearTimeout(popTimer.current);
    popTimer.current = setTimeout(() => setPopId(null), 1000);
    const who = by === "joint" ? "together" : by === "a" ? view.settings.nameA : view.settings.nameB;
    const when = tapWhenDays === 0 ? "" : tapWhenDays === 1 ? " (yesterday)" : ` (${tapWhenDays}d ago)`;
    const nextStep = twoStep ? advanceTwoStepChore(chore).name : "";
    showToast(`${chore.name} done ${by === "joint" ? "" : "by "}${who}${when}${nextStep ? ` · ${nextStep} is up next` : ""}`, () => {
      commit(twoStep
        ? { type: "completion:remove-and-restore", ids: [comp.id], chore }
        : { type: "completion:remove", ids: [comp.id] });
      setToast(null);
    });
  };

  const openService = () => {
    const sel = {};
    for (const ch of view.chores) sel[ch.id] = !!ch.service;
    setServiceSel(sel);
    setServiceOpen(true);
  };

  const confirmService = () => {
    const ts = now();
    const comps = view.chores
      .filter((ch) => serviceSel[ch.id])
      .map((ch) => ({ id: uid(), choreId: ch.id, choreName: ch.name, difficulty: ch.difficulty, by: "service", ts }));
    if (!commit({ type: "completion:add-many", completions: comps })) return;
    setServiceOpen(false);
    showToast(`Cleaning service logged: ${comps.length} chores reset`, () => {
      commit({ type: "completion:remove", ids: comps.map((c) => c.id) });
      setToast(null);
    });
  };

  const saveChore = (ch) => {
    const normalized = isTwoStepChore(ch) ? materializeTwoStepChore(ch) : ch;
    const chore = normalized.id ? normalized : { ...normalized, id: uid(), createdAt: realNow() };
    if (commit({ type: "chore:upsert", chore })) setEditChore(null);
  };

  const deleteChore = (id) => {
    if (commit({ type: "chore:delete", choreId: id })) setEditChore(null);
  };

  const addStarters = () => {
    const chores = STARTERS.map((s) => ({ ...s, id: uid(), createdAt: realNow() }));
    commit({ type: "chore:add-many", chores });
  };

  const clearChores = () => {
    commit({ type: "chore:clear" });
    setEditChore(null);
    showToast("All chores cleared");
  };

  // Mark every chore as just done (no points) — for coming back after time away
  // without having paused. Resets bubble sizes and health without crediting anyone.
  const resetBubbles = () => {
    const ts = realNow();
    const comps = view.chores.map((ch) => ({ id: uid(), choreId: ch.id, choreName: ch.name, difficulty: ch.difficulty, by: "reset", ts }));
    if (comps.length === 0) return;
    commit({ type: "completion:add-many", completions: comps });
    showToast("Board reset — every chore marked fresh");
  };

  // Pulse the health bar green whenever the score rises
  useEffect(() => {
    if (!view) return;
    const pct = Math.round(healthScore(view.chores, view.completions, view.pauses || []) * 100);
    if (prevHealthRef.current != null && pct > prevHealthRef.current) {
      setHealthPulse(true);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setHealthPulse(false), 1400);
    }
    prevHealthRef.current = pct;
  }, [view]);

  if (!authReady) {
    return (
      <div style={{ height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0C1B26", color: "#7FA3AC", fontFamily: "'Nunito Sans', sans-serif" }}>
        Checking your session...
      </div>
    );
  }

  if (isSynced() && !session) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(120% 100% at 50% 0%, #123240 0%, #0C1B26 70%)", color: "#E8F3F4", fontFamily: "'Nunito Sans', sans-serif", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 420, background: "#16303C", border: "1px solid #1E4152", borderRadius: 22, padding: 24 }}>
          <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Chore<span style={{ color: "#5FE0BB" }}>Bubbles</span></div>
          <div style={{ color: "#B9D2D8", fontSize: 14, marginBottom: 18 }}>Sign in with an approved household email. We’ll email you a 6-digit code to enter below.</div>
          <input
            type="email"
            autoComplete="email"
            value={authEmail}
            placeholder="you@example.com"
            onChange={(event) => { setAuthEmail(event.target.value); setAuthSent(false); }}
            onKeyDown={(event) => { if (event.key === "Enter") requestMagicLink(); }}
            style={{ width: "100%", background: "#0F2530", border: "1px solid #1E4152", borderRadius: 12, padding: "12px 14px", color: "#E8F3F4", fontSize: 15, marginBottom: 10 }}
          />
          <button onClick={requestMagicLink} style={{ ...btnStyle("#5FE0BB"), width: "100%" }}>
            {authSent ? "Resend code" : "Email me a sign-in code"}
          </button>
          {authSent && (
            <>
              <div style={{ color: "#B9D2D8", fontSize: 13, margin: "16px 0 8px" }}>
                Enter the 6-digit code from the email. This works even when the app is installed to your home screen.
              </div>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={authCode}
                placeholder="123456"
                onChange={(event) => setAuthCode(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") verifyCode(); }}
                style={{ width: "100%", background: "#0F2530", border: "1px solid #1E4152", borderRadius: 12, padding: "12px 14px", color: "#E8F3F4", fontSize: 20, letterSpacing: 6, textAlign: "center", marginBottom: 10 }}
              />
              <button onClick={verifyCode} style={{ ...btnStyle("#5FE0BB"), width: "100%" }}>Verify code</button>
            </>
          )}
          {authError && <div style={{ color: "#FF8B7B", fontSize: 13, marginTop: 12 }}>{authError}</div>}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ height: "100dvh", display: "flex", flexDirection: "column", gap: 10, alignItems: "center", justifyContent: "center", textAlign: "center", padding: 28, background: "#0C1B26", color: "#7FA3AC", fontFamily: "'Nunito Sans', sans-serif" }}>
        <div>Loading your household...</div>
        {syncState && <div style={{ color: "#FF8B7B", fontSize: 13, maxWidth: 380 }}>{syncState}</div>}
      </div>
    );
  }

  const { settings } = view;
  const {
    pauses,
    goal,
    greenMin,
    housePaused,
    soloAPaused,
    soloBPaused,
    aPaused,
    bPaused,
    pointsA,
    pointsB,
    previousA,
    previousB,
    previousHasActivity,
    streak,
    myPaused,
    gap,
    suggestion,
  } = logStats;
  const health = healthScore(view.chores, view.completions, pauses);
  const healthPct = Math.round(health * 100);
  const healthColor = healthPct >= 80 ? "#5FE0BB" : healthPct >= 50 ? "#FFC65E" : "#FF8B7B";
  const recent = [...view.completions].sort((a, b) => b.ts - a.ts).slice(0, 30);
  const choreHistories = new Map(
    view.chores.map((chore) => [chore.id, choreHistoryFor(view.completions, chore.id)])
  );
  const editChoreHistory = editChore?.id ? choreHistories.get(editChore.id) || [] : [];
  const suggestedBubbleIds = new Set(
    bubbleSuggestionsVisible && suggestion ? suggestion.chores.map((chore) => chore.id) : []
  );
  const canShuffleSuggestions = !!suggestion && !myPaused && view.chores.length > 0;
  const shuffleSuggestions = () => {
    if (!canShuffleSuggestions) return;
    setBubbleSuggestionsVisible(true);
    setSuggestionSeed((seed) => seed + 1);
  };
  const hideBubbleSuggestions = () => setBubbleSuggestionsVisible(false);
  const togetherPoints = pointsA + pointsB;
  const togetherGoal = goal * 2;
  const previousRecap = !previousHasActivity
    ? ""
    : previousA >= greenMin && previousB >= greenMin
    ? "Previous 7 days: both stayed green 🌱"
    : previousA >= greenMin
    ? `Previous 7 days: ${settings.nameA} was green`
    : previousB >= greenMin
    ? `Previous 7 days: ${settings.nameB} was green`
    : `Previous 7 days: ${previousA + previousB} points together`;

  const impLabel = (v) => ["", "Low", "Mild", "Medium", "High", "Critical"][v];

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "radial-gradient(120% 100% at 50% 0%, #123240 0%, #0C1B26 70%)", fontFamily: "'Nunito Sans', sans-serif", color: "#E8F3F4", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700&family=Nunito+Sans:wght@400;600;700&display=swap');
        @keyframes breathe { 0%,100%{transform:scale(1)} 50%{transform:scale(1.045)} }
        @keyframes pop { 0%{transform:scale(1.15)} 45%{transform:scale(0.82)} 100%{transform:scale(1)} }
        @keyframes sparkleUp { 0%{opacity:1; transform:translateY(0) scale(0.7)} 100%{opacity:0; transform:translateY(-26px) scale(1.25)} }
        @keyframes barSwell { 0%{transform:scaleY(1)} 25%{transform:scaleY(1.9)} 55%{transform:scaleY(1.25)} 100%{transform:scaleY(1)} }
        @keyframes greenArrival { 0%{transform:scale(0.82); box-shadow:0 0 0 #5FE0BB00} 55%{transform:scale(1.08); box-shadow:0 0 14px #5FE0BB66} 100%{transform:scale(1); box-shadow:0 0 0 #5FE0BB00} }
        @keyframes wilt { 0%,100%{transform:rotate(-6deg) translateY(1px)} 50%{transform:rotate(-10deg) translateY(3px)} }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
        * { box-sizing: border-box; margin: 0; }
        button:active { transform: scale(0.96); }
        input { outline: none; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "calc(env(safe-area-inset-top) + 14px) 20px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: 0.3 }}>
          Chore<span style={{ color: "#5FE0BB" }}>Bubbles</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 12, color: simDays > 0 ? "#FFC65E" : housePaused || aPaused || bPaused ? "#6FC3FF" : "#7FA3AC", fontWeight: simDays > 0 || housePaused ? 700 : 400 }}>
            {simDays > 0
              ? `⏩ +${simDays}d`
              : housePaused
              ? "🏖 paused"
              : aPaused || bPaused
              ? `🏖 ${[aPaused && settings.nameA, bPaused && settings.nameB].filter(Boolean).join(" + ")}`
              : syncState || (!isSynced() ? "local only" : me ? (me === "a" ? settings.nameA : settings.nameB) : "")}
          </div>
          <button onClick={() => setSimOpen(true)} style={{ background: "none", border: "none", fontSize: 17, cursor: "pointer", padding: 2, WebkitTapHighlightColor: "transparent", opacity: 0.75 }}>
            🧪
          </button>
        </div>
      </div>

      {/* Our home's health bar */}
      {view.chores.length > 0 && (
        <div style={{ padding: "2px 20px 10px" }}>
          <div style={{ textAlign: "center", marginBottom: 2 }}>
            <span
              key={faceFor(healthPct)}
              style={{
                fontSize: 30,
                display: "inline-block",
                animation: healthPct >= 90 ? "breathe 4s ease-in-out infinite" : healthPct < 15 ? "wilt 3.5s ease-in-out infinite" : "none",
                transition: "transform 0.5s ease",
              }}
            >
              {faceFor(healthPct)}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 13, fontWeight: 600, color: "#B9D2D8", letterSpacing: 0.4 }}>Our home's health</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: healthPulse ? "#5FE0BB" : healthColor, transition: "color 0.5s ease" }}>
              {healthPct}%
            </span>
          </div>
          <div style={{ position: "relative", height: 10, borderRadius: 6, background: "#0F2530", border: "1px solid #1E4152", overflow: "visible" }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${healthPct}%`,
                borderRadius: 6,
                background: healthPulse
                  ? "linear-gradient(to right, #5FE0BB99, #5FE0BB)"
                  : `linear-gradient(to right, ${healthColor}99, ${healthColor})`,
                boxShadow: healthPulse
                  ? "0 0 20px #5FE0BBCC"
                  : healthPct >= 80
                  ? `0 0 10px ${healthColor}88`
                  : "none",
                animation: healthPulse ? "barSwell 1.4s ease-out" : "none",
                transformOrigin: "left center",
                transition: "width 0.8s ease, background 0.5s ease, box-shadow 0.5s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* Body */}
      {tab === "bubbles" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {view.chores.length > 0 && (
            <div style={{ display: "flex", gap: 16, alignItems: "flex-end", padding: "2px 20px 8px" }}>
              <CompactBar name={settings.nameA} points={pointsA} goal={goal} greenStart={settings.greenStart} paused={aPaused} />
              <CompactBar name={settings.nameB} points={pointsB} goal={goal} greenStart={settings.greenStart} paused={bPaused} />
            </div>
          )}
          {simDays > 0 && (
            <div style={{ margin: "4px 20px 0", padding: "9px 14px", background: "#3B3215", border: "1px solid #6E5C21", borderRadius: 12, fontSize: 13, color: "#FFC65E", textAlign: "center" }}>
              🧪 Time machine — tap bubbles to test. Nothing here is saved or shared.
            </div>
          )}
          {housePaused && (
            <div style={{ margin: "4px 20px 0", padding: "9px 14px", background: "#12384A", border: "1px solid #1E5A73", borderRadius: 12, fontSize: 13, color: "#9FD4EA", textAlign: "center" }}>
              🏖 Household paused. Bubbles are frozen until you resume.
            </div>
          )}
          <BubbleField chores={view.chores} completions={view.completions} pauses={pauses} onTap={(ch) => { setTapWhenDays(0); setTapChore(ch); }} popId={popId} simDays={simDays} suggestedIds={suggestedBubbleIds} />
          <div style={{ padding: "0 20px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                disabled={!canShuffleSuggestions}
                onClick={shuffleSuggestions}
                aria-pressed={bubbleSuggestionsVisible && suggestedBubbleIds.size > 0}
                aria-label="Shuffle chore suggestions to reach the green zone"
                style={{
                  ...btnStyle(bubbleSuggestionsVisible && suggestedBubbleIds.size > 0 ? "#3B3415" : "#0F2530", "#FFE27A"),
                  flex: 1,
                  border: `1px solid ${bubbleSuggestionsVisible && suggestedBubbleIds.size > 0 ? "#C9A92C" : "#554B25"}`,
                  opacity: canShuffleSuggestions ? 1 : 0.45,
                }}
              >
                🎲 Shuffle chore suggestions
              </button>
              {bubbleSuggestionsVisible && suggestedBubbleIds.size > 0 && (
                <button
                  onClick={hideBubbleSuggestions}
                  aria-label="Hide chore suggestions"
                  style={{ ...btnStyle("#2B2417", "#FFE27A"), width: 52, padding: 0, border: "1px solid #8A722A", fontSize: 18 }}
                >
                  ✕
                </button>
              )}
            </div>
            <button onClick={openService} style={{ ...btnStyle("#0F2530", "#5FE0BB"), width: "100%", border: "1px solid #1E4152" }}>
              🧹 Cleaning service came
            </button>
          </div>
        </div>
      )}

      {tab === "log" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px 26px" }}>
          <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 23, fontWeight: 700, marginTop: 4 }}>Last 7 days</div>
          <div style={{ color: "#7FA3AC", fontSize: 13, lineHeight: 1.4, marginBottom: 12 }}>
            What you&apos;ve each done over your last 7 active days. Keep it in the green.
          </div>

          <div style={{ background: "linear-gradient(145deg, #173746, #122B37)", border: "1px solid #245064", borderRadius: 18, padding: "0 16px 12px", marginBottom: 12 }}>
            <ProgressRow label="Together 🤝" points={togetherPoints} goal={togetherGoal} hue="#5FE0BB" prominent />
            {(previousRecap || streak >= 2) && (
              <div style={{ color: "#9FBCC4", fontSize: 12, lineHeight: 1.45, borderTop: "1px solid #244653", paddingTop: 10 }}>
                {previousRecap}
                {previousRecap && streak >= 2 ? " · " : ""}
                {streak >= 2 ? `🔥 ${streak}-period streak` : ""}
              </div>
            )}
          </div>

          <div style={{ background: "#102733", border: "1px solid #1A3B49", borderRadius: 18, padding: "2px 16px", marginBottom: 12 }}>
            <ProgressRow label={settings.nameA} points={pointsA} goal={goal} hue="#6FC3FF" paused={aPaused} zoned greenStart={settings.greenStart} />
            <div style={{ height: 1, background: "#1A3B49" }} />
            <ProgressRow label={settings.nameB} points={pointsB} goal={goal} hue="#FF9FC0" paused={bPaused} zoned greenStart={settings.greenStart} />
            <div style={{ color: "#7FA3AC", fontSize: 11.5, textAlign: "center", padding: "2px 0 12px" }}>
              Full scale: {goal} points · Green starts at {greenMin}
            </div>
          </div>

          {me && !myPaused && (
            <div style={{ background: gap === 0 ? "#153D35" : "#2B2A19", border: `1px solid ${gap === 0 ? "#297261" : "#5B5327"}`, borderRadius: 18, padding: 16, marginBottom: 16 }}>
              {gap === 0 ? (
                <>
                  <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 17, fontWeight: 700, color: "#5FE0BB" }}>Your tally is in the green! 🌱</div>
                  <div style={{ fontSize: 12, color: "#A8CFC5", marginTop: 3 }}>Nice work keeping the household moving.</div>
                </>
              ) : (
                <>
                  <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 17, fontWeight: 700, color: "#FFC65E" }}>
                    You&apos;re {gap} point{gap === 1 ? "" : "s"} from green 🎯
                  </div>
                  {suggestion ? (
                    <>
                      <div style={{ color: "#E8F3F4", fontSize: 14, lineHeight: 1.5, marginTop: 8 }}>
                        Try: {suggestion.chores.map((chore) => `${chore.name} (${chore.difficulty})`).join(" + ")}
                      </div>
                      <div style={{ color: "#B9D2D8", fontSize: 12, marginTop: 3 }}>
                        {suggestion.reachesGap
                          ? `= ${suggestion.total} points`
                          : `This gets you ${suggestion.total} points closer`}
                      </div>
                      <button
                        onClick={shuffleSuggestions}
                        style={{ ...btnStyle("transparent", "#FFC65E"), padding: "8px 0 0", fontSize: 13 }}
                      >
                        🎲 Shuffle ideas
                      </button>
                    </>
                  ) : (
                    <div style={{ color: "#B9D2D8", fontSize: 13, marginTop: 6 }}>Pick any chore that needs attention to move closer.</div>
                  )}
                </>
              )}
            </div>
          )}

          <div style={{ color: "#7FA3AC", fontSize: 11.5, lineHeight: 1.45, textAlign: "center", margin: "2px 4px 20px" }}>
            Chores you do together count full for both of you.<br />
            Vacation mode freezes your tally while you&apos;re away.
          </div>

          <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Recent activity</div>
          {recent.length === 0 && <div style={{ color: "#7FA3AC", fontSize: 14 }}>Nothing logged yet. Tap a bubble to get started.</div>}
          {recent.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #1A3542" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {c.by === "service" ? "🧹 " : c.by === "reset" ? "🔄 " : ""}{c.choreName}
                </div>
                <div style={{ fontSize: 12, color: "#7FA3AC" }}>
                  {c.by === "a" ? settings.nameA : c.by === "b" ? settings.nameB : c.by === "joint" ? "Together" : c.by === "reset" ? "Caught up" : "Cleaning service"} · {timeAgo(c.ts)}
                </div>
              </div>
              <div style={{ fontSize: 13, color: c.by === "service" || c.by === "reset" ? "#7FA3AC" : "#5FE0BB", fontWeight: 700, whiteSpace: "nowrap" }}>
                {c.by === "service" || c.by === "reset" ? "reset" : `+${c.difficulty}${c.by === "joint" ? " each" : ""}`}
              </div>
              <button
                onClick={() => removeCompletion(c)}
                aria-label={`Delete ${c.choreName}`}
                style={{ ...btnStyle("#0F2530", "#FF8B7B"), padding: "5px 10px", fontSize: 13, border: "1px solid #1E4152", lineHeight: 1, flexShrink: 0 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "chores" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px 20px" }}>
          {simDays > 0 && <div style={{ color: "#FFC65E", fontSize: 13, textAlign: "center", marginBottom: 10 }}>Preview mode is read-only.</div>}
          <button disabled={simDays > 0} onClick={() => setEditChore({ name: "", importance: 3, difficulty: 2, freqDays: 7, service: false })} style={{ ...btnStyle("#5FE0BB"), width: "100%", marginBottom: 10, opacity: simDays > 0 ? 0.45 : 1 }}>
            + Add chore
          </button>
          {view.chores.length === 0 && (
            <button disabled={simDays > 0} onClick={addStarters} style={{ ...btnStyle("#0F2530", "#B9D2D8"), width: "100%", marginBottom: 10, border: "1px solid #1E4152", opacity: simDays > 0 ? 0.45 : 1 }}>
              Load a starter list of common chores
            </button>
          )}
          {view.chores.map((ch, i) => {
            const latest = choreHistories.get(ch.id)?.[0];
            const resetEntry = latest?.by === "service" || latest?.by === "reset";
            return (
              <div
                key={ch.id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${ch.name} details and history`}
                onClick={() => setEditChore(ch)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setEditChore(ch);
                  }
                }}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #1A3542", cursor: "pointer" }}
              >
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: bubbleHue(i), flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{ch.name}</div>
                  <div style={{ fontSize: 12, color: "#7FA3AC" }}>
                    {impLabel(ch.importance)} importance · effort {ch.difficulty} · every {ch.freqDays}d{ch.service ? " · 🧹 service" : ""}
                  </div>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      maxWidth: "100%",
                      marginTop: 6,
                      padding: "4px 8px",
                      borderRadius: 8,
                      background: latest ? (resetEntry ? "#23313A" : "#14372F") : "#142A35",
                      color: latest ? (resetEntry ? "#9FB6BC" : "#8EDCC5") : "#7FA3AC",
                      fontSize: 11.5,
                      lineHeight: 1.2,
                    }}
                  >
                    <span aria-hidden="true">{latest ? (resetEntry ? "↻" : "✓") : "○"}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {lastDoneLabel(latest, settings)}{latest ? ` · ${timeAgo(latest.ts)}` : ""}
                    </span>
                  </div>
                </div>
                <div style={{ color: "#7FA3AC" }}>›</div>
              </div>
            );
          })}

          {view.chores.length > 0 && (
            <>
              <div style={{ marginTop: 26, fontFamily: "'Baloo 2', sans-serif", fontSize: 16, fontWeight: 600 }}>Board maintenance</div>
              <div style={{ fontSize: 12, color: "#7FA3AC", margin: "4px 0 10px" }}>
                Reset marks every chore as just done (no points) — handy if you were away without pausing. Clear removes all chores so you can build a fresh list together.
              </div>
              <button disabled={simDays > 0} onClick={() => window.confirm("Reset all bubbles to fresh? Every chore is marked as just done — no points are awarded.") && resetBubbles()} style={{ ...btnStyle("#0F2530", "#5FE0BB"), width: "100%", marginBottom: 8, border: "1px solid #1E4152", opacity: simDays > 0 ? 0.45 : 1 }}>
                🔄 Reset all bubbles to fresh
              </button>
              <button disabled={simDays > 0} onClick={() => window.confirm("Clear all chores for both of you? This removes every chore and cannot be undone.") && clearChores()} style={{ ...btnStyle("#0F2530", "#FF8B7B"), width: "100%", border: "1px solid #1E4152", opacity: simDays > 0 ? 0.45 : 1 }}>
                🗑 Clear all chores
              </button>
            </>
          )}

          <div style={{ marginTop: 26, fontFamily: "'Baloo 2', sans-serif", fontSize: 16, fontWeight: 600 }}>Vacation mode</div>
          <div style={{ fontSize: 12, color: "#7FA3AC", margin: "4px 0 10px" }}>
            Household pause freezes all bubble growth and both tallies. A solo pause protects one person&apos;s tally during a trip or a rough week while bubbles keep growing for whoever is home.
          </div>
          <button onClick={() => togglePause("house")} style={{ ...btnStyle(housePaused ? "#6FC3FF" : "#0F2530", housePaused ? "#0C1B26" : "#9FD4EA"), width: "100%", marginBottom: 8, border: housePaused ? "none" : "1px solid #1E4152" }}>
            {housePaused ? "🏖 Resume household" : "🏖 Pause whole household"}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => togglePause("a")} style={{ ...btnStyle(soloAPaused ? "#6FC3FF" : "#0F2530", soloAPaused ? "#0C1B26" : "#B9D2D8"), flex: 1, fontSize: 13, border: soloAPaused ? "none" : "1px solid #1E4152" }}>
              {soloAPaused ? `Resume ${settings.nameA}` : `Pause ${settings.nameA}`}
            </button>
            <button onClick={() => togglePause("b")} style={{ ...btnStyle(soloBPaused ? "#6FC3FF" : "#0F2530", soloBPaused ? "#0C1B26" : "#B9D2D8"), flex: 1, fontSize: 13, border: soloBPaused ? "none" : "1px solid #1E4152" }}>
              {soloBPaused ? `Resume ${settings.nameB}` : `Pause ${settings.nameB}`}
            </button>
          </div>

          <div style={{ marginTop: 26, fontFamily: "'Baloo 2', sans-serif", fontSize: 16, fontWeight: 600 }}>Household settings</div>
          <Stepper label="Effort scale (full bar)" value={settings.weeklyGoal} min={4} max={40} onChange={(v) => commit({ type: "settings:patch", patch: { weeklyGoal: v, greenStart: Math.min(greenMin, v) } })} />
          <Stepper label="Green zone starts at" value={greenMin} min={2} max={settings.weeklyGoal} onChange={(v) => commit({ type: "settings:patch", patch: { greenStart: v } })} format={(v) => `${v} pts`} />
          <div style={{ color: "#7FA3AC", fontSize: 11.5, margin: "-4px 0 8px" }}>
            Land in the green by reaching {greenMin} of {settings.weeklyGoal} points. The full bar is a reference, not a cutoff.
          </div>
          <NameEditor settings={settings} onSave={(nameA, nameB) => commit({ type: "settings:patch", patch: { nameA, nameB } })} />
          <button onClick={() => setAskWho(true)} style={{ ...btnStyle("#0F2530", "#B9D2D8"), width: "100%", marginTop: 12, border: "1px solid #1E4152", fontSize: 13 }}>
            This phone belongs to: {me === "a" ? settings.nameA : me === "b" ? settings.nameB : "?"} (change)
          </button>
          <button onClick={() => window.confirm("Clear the shared activity log? This cannot be undone.") && resetActivity()} style={{ ...btnStyle("#0F2530", "#FF8B7B"), width: "100%", marginTop: 8, border: "1px solid #1E4152", fontSize: 13 }}>
            Clear shared activity log
          </button>
          {isSynced() && (
            <button onClick={() => signOut().catch((error) => showToast(error.message || "Could not sign out."))} style={{ ...btnStyle("#0F2530", "#B9D2D8"), width: "100%", marginTop: 8, border: "1px solid #1E4152", fontSize: 13 }}>
              Sign out {session?.user?.email ? `(${session.user.email})` : ""}
            </button>
          )}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: "flex", borderTop: "1px solid #1A3542", background: "#0E2230", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {[
          { id: "bubbles", label: "Bubbles", icon: "🫧" },
          { id: "log", label: "The Log", icon: "📊" },
          { id: "chores", label: "Chores", icon: "📝" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{ flex: 1, background: "none", border: "none", padding: "12px 0 14px", cursor: "pointer", color: tab === t.id ? "#5FE0BB" : "#7FA3AC", fontFamily: "'Baloo 2', sans-serif", fontSize: 13, fontWeight: 600, WebkitTapHighlightColor: "transparent" }}
          >
            <div style={{ fontSize: 19 }}>{t.icon}</div>
            {t.label}
          </button>
        ))}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 92, left: "50%", transform: "translateX(-50%)", background: "#1E4152", borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 6px 24px rgba(0,0,0,0.45)", zIndex: 60, maxWidth: "92%" }}>
          <span style={{ fontSize: 14 }}>{toast.msg}</span>
          {toast.undoFn && <button onClick={toast.undoFn} style={{ background: "none", border: "none", color: "#5FE0BB", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Undo</button>}
        </div>
      )}

      {/* Simulation panel */}
      {simOpen && (
        <Modal onClose={() => setSimOpen(false)}>
          <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 19, fontWeight: 700, marginBottom: 4 }}>Time machine 🧪</div>
          <div style={{ fontSize: 13, color: "#7FA3AC", marginBottom: 16 }}>
            Fast-forward this phone&apos;s clock to preview bubble growth and seven-day tallies. Test completions and pauses stay in a local sandbox and disappear when you return to today.
          </div>
          <div style={{ textAlign: "center", fontFamily: "'Baloo 2', sans-serif", fontSize: 26, fontWeight: 700, color: simDays > 0 ? "#FFC65E" : "#E8F3F4", marginBottom: 14 }}>
            {simDays === 0 ? "Today" : `Today + ${simDays} day${simDays === 1 ? "" : "s"}`}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button onClick={() => setSim(simDays + 1)} style={{ ...btnStyle("#0F2530", "#E8F3F4"), flex: 1, border: "1px solid #1E4152" }}>+1 day</button>
            <button onClick={() => setSim(simDays + 3)} style={{ ...btnStyle("#0F2530", "#E8F3F4"), flex: 1, border: "1px solid #1E4152" }}>+3 days</button>
            <button onClick={() => setSim(simDays + 7)} style={{ ...btnStyle("#0F2530", "#E8F3F4"), flex: 1, border: "1px solid #1E4152" }}>+1 week</button>
          </div>
          <button onClick={() => setSim(0)} style={{ ...btnStyle("#5FE0BB"), width: "100%", marginBottom: 10 }}>Back to today</button>
        </Modal>
      )}

      {/* Who are you */}
      {askWho && (
        <Modal onClose={() => me && setAskWho(false)}>
          <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 19, fontWeight: 700, marginBottom: 16 }}>Whose phone is this?</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => chooseMe("a")} style={{ ...btnStyle("#6FC3FF"), flex: 1 }}>{settings.nameA}</button>
            <button onClick={() => chooseMe("b")} style={{ ...btnStyle("#FF9FC0"), flex: 1 }}>{settings.nameB}</button>
          </div>
        </Modal>
      )}

      {/* One-time explanation, shown only after device identity is known */}
      {introOpen && !askWho && (
        <Modal onClose={dismissIntro}>
          <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 21, fontWeight: 700, marginBottom: 14 }}>How ChoreBubbles works 🫧</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, color: "#D7E7EA", fontSize: 14, lineHeight: 1.45, marginBottom: 20 }}>
            <div><strong style={{ color: "#5FE0BB" }}>1.</strong> Bubbles grow as chores become due.</div>
            <div><strong style={{ color: "#5FE0BB" }}>2.</strong> Tap a bubble when a chore is done.</div>
            <div><strong style={{ color: "#5FE0BB" }}>3.</strong> What you do stays in your tally for seven active days. Keep your effort in the green.</div>
          </div>
          <button onClick={dismissIntro} style={{ ...btnStyle("#5FE0BB"), width: "100%" }}>Got it</button>
        </Modal>
      )}

      {/* Complete chore */}
      {tapChore && (
        <Modal onClose={() => { setTapChore(null); setTapWhenDays(0); }}>
          <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 19, fontWeight: 700 }}>{tapChore.name}</div>
          <div style={{ fontSize: 13, color: "#7FA3AC", margin: "4px 0 16px" }}>
            Last done {timeAgo(lastDone(tapChore, view.completions))} · worth {tapChore.difficulty} pts
          </div>
          <div style={{ fontSize: 12, color: "#7FA3AC", marginBottom: 7 }}>When was it done?</div>
          <div style={{ display: "flex", gap: 7, marginBottom: 18, flexWrap: "wrap" }}>
            {[{ d: 0, l: "Just now" }, { d: 1, l: "Yesterday" }, { d: 2, l: "2 days ago" }, { d: 3, l: "3 days ago" }].map((o) => (
              <button
                key={o.d}
                onClick={() => setTapWhenDays(o.d)}
                style={{ ...btnStyle(tapWhenDays === o.d ? "#5FE0BB" : "#0F2530", tapWhenDays === o.d ? "#0C1B26" : "#B9D2D8"), padding: "7px 12px", fontSize: 13, border: tapWhenDays === o.d ? "none" : "1px solid #1E4152" }}
              >
                {o.l}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={() => logCompletion(tapChore, me || "a")} style={btnStyle("#5FE0BB")}>
              Done by me ({me === "b" ? settings.nameB : settings.nameA})
            </button>
            <button onClick={() => logCompletion(tapChore, me === "b" ? "a" : "b")} style={btnStyle("#0F2530", "#E8F3F4")}>
              Done by {me === "b" ? settings.nameA : settings.nameB}
            </button>
            <button onClick={() => logCompletion(tapChore, "joint")} style={btnStyle("#C7A5F7")}>
              We did it together
            </button>
          </div>
        </Modal>
      )}

      {/* Cleaning service */}
      {serviceOpen && (
        <Modal onClose={() => setServiceOpen(false)}>
          <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 19, fontWeight: 700, marginBottom: 4 }}>Cleaning service visit</div>
          <div style={{ fontSize: 13, color: "#7FA3AC", marginBottom: 14 }}>Check off what they handled. These bubbles reset without crediting either tally.</div>
          <div style={{ maxHeight: 300, overflowY: "auto", marginBottom: 16 }}>
            {view.chores.map((ch) => (
              <label key={ch.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid #1A3542", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!!serviceSel[ch.id]}
                  onChange={(e) => setServiceSel({ ...serviceSel, [ch.id]: e.target.checked })}
                  style={{ width: 19, height: 19, accentColor: "#5FE0BB" }}
                />
                <span style={{ fontSize: 15 }}>{ch.name}</span>
              </label>
            ))}
          </div>
          <button onClick={confirmService} style={{ ...btnStyle("#5FE0BB"), width: "100%" }}>
            Log service visit ({Object.values(serviceSel).filter(Boolean).length} chores)
          </button>
        </Modal>
      )}

      {/* Edit / add chore */}
      {editChore && (
        <Modal onClose={() => setEditChore(null)}>
          <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 19, fontWeight: 700, marginBottom: 14 }}>
            {editChore.id ? "Edit chore" : "New chore"}
          </div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0 12px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={isTwoStepChore(editChore)}
              onChange={(event) => setEditChore(event.target.checked ? enableTwoStepChore(editChore) : disableTwoStepChore(editChore))}
              style={{ width: 19, height: 19, marginTop: 1, accentColor: "#5FE0BB" }}
            />
            <span>
              <span style={{ display: "block", fontSize: 14, color: "#E8F3F4", fontWeight: 700 }}>Two-step chore</span>
              <span style={{ display: "block", fontSize: 11.5, color: "#7FA3AC", lineHeight: 1.35, marginTop: 2 }}>
                Completing either step swaps its bubble to the other. Only one step is visible at a time.
              </span>
            </span>
          </label>
          {isTwoStepChore(editChore) ? (
            <>
              <ChoreFields title={`Step 1${editChore.twoStep.active === 0 ? " · visible now" : ""}`} value={editChore.twoStep.steps[0]} onChange={(patch) => setEditChore(updateTwoStep(editChore, 0, patch))} />
              <ChoreFields title={`Step 2${editChore.twoStep.active === 1 ? " · visible now" : ""}`} value={editChore.twoStep.steps[1]} onChange={(patch) => setEditChore(updateTwoStep(editChore, 1, patch))} />
            </>
          ) : (
            <ChoreFields value={editChore} onChange={(patch) => setEditChore({ ...editChore, ...patch })} />
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!editChore.service}
              onChange={(e) => setEditChore({ ...editChore, service: e.target.checked })}
              style={{ width: 19, height: 19, accentColor: "#5FE0BB" }}
            />
            <span style={{ fontSize: 14, color: "#B9D2D8" }}>Cleaning service usually handles this</span>
          </label>
          {editChore.id && (
            <section style={{ marginTop: 10, paddingTop: 14, borderTop: "1px solid #244653" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 16, fontWeight: 700 }}>Chore history</div>
                <div style={{ color: "#7FA3AC", fontSize: 11.5 }}>
                  {editChoreHistory.length} entr{editChoreHistory.length === 1 ? "y" : "ies"}
                </div>
              </div>
              {editChoreHistory.length === 0 ? (
                <div style={{ background: "#102733", border: "1px solid #1A3B49", borderRadius: 12, padding: "12px 14px", color: "#7FA3AC", fontSize: 13 }}>
                  No one has logged this chore yet.
                </div>
              ) : (
                <div style={{ maxHeight: 220, overflowY: "auto", background: "#102733", border: "1px solid #1A3B49", borderRadius: 12, padding: "0 12px" }}>
                  {editChoreHistory.map((entry) => {
                    const resetEntry = entry.by === "service" || entry.by === "reset";
                    return (
                      <div key={entry.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid #1A3542" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: "#E8F3F4", fontSize: 13.5, fontWeight: 700 }}>
                            {completionActor(entry, settings)}
                          </div>
                          <div style={{ color: "#7FA3AC", fontSize: 11.5, marginTop: 1 }}>
                            {historyDate(entry.ts)} · {timeAgo(entry.ts)}
                          </div>
                        </div>
                        <div style={{ color: resetEntry ? "#9FB6BC" : "#5FE0BB", fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap" }}>
                          {completionImpact(entry)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            {editChore.id && (
              <button onClick={() => deleteChore(editChore.id)} style={{ ...btnStyle("#0F2530", "#FF8B7B"), flex: 1, border: "1px solid #1E4152" }}>Delete</button>
            )}
            <button
              onClick={() => {
                const namesReady = isTwoStepChore(editChore)
                  ? editChore.twoStep.steps.every((step) => step.name.trim())
                  : editChore.name.trim();
                if (namesReady) saveChore(editChore);
              }}
              style={{
                ...btnStyle("#5FE0BB"),
                flex: 2,
                opacity: (isTwoStepChore(editChore)
                  ? editChore.twoStep.steps.every((step) => step.name.trim())
                  : editChore.name.trim()) ? 1 : 0.5,
              }}
            >
              Save chore
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Name fields buffer locally and save on blur so typing does not spam storage writes
function NameEditor({ settings, onSave }) {
  const [a, setA] = useState(settings.nameA);
  const [b, setB] = useState(settings.nameB);
  useEffect(() => { setA(settings.nameA); setB(settings.nameB); }, [settings.nameA, settings.nameB]);
  const commit = () => {
    if (a.trim() && b.trim() && (a !== settings.nameA || b !== settings.nameB)) onSave(a.trim(), b.trim());
  };
  const inputStyle = { flex: 1, background: "#0F2530", border: "1px solid #1E4152", borderRadius: 12, padding: "10px 12px", color: "#E8F3F4", fontSize: 14, fontFamily: "inherit" };
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
      <input value={a} onChange={(e) => setA(e.target.value)} onBlur={commit} style={inputStyle} />
      <input value={b} onChange={(e) => setB(e.target.value)} onBlur={commit} style={inputStyle} />
    </div>
  );
}
