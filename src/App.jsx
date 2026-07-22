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

// ChoreBubbles: a shared household chore ecosystem.
// Bubbles swell as chores go undone. Tap to complete, drag to rearrange.


const HUES = ["#FF8B7B", "#FFC65E", "#5FE0BB", "#C7A5F7", "#6FC3FF", "#FF9FC0", "#9BE087", "#FFB38A"];

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
const realNow = () => Date.now();
// Simulation support: shifts the app's sense of "now" forward for testing
let TIME_OFFSET = 0;
const now = () => Date.now() + TIME_OFFSET;

const defaultData = () => ({
  chores: [],
  completions: [],
  pauses: [],
  settings: { nameA: "Julian", nameB: "Kristine", weeklyGoal: 14, halfLifeDays: 7 },
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

// Total milliseconds within [from, to] covered by pauses matching the given scopes
function pausedMs(pauses, scopes, from, to) {
  const intervals = [];
  for (const p of pauses || []) {
    if (!scopes.includes(p.scope)) continue;
    const s = Math.max(p.start, from);
    const e = Math.min(p.end == null ? to : p.end, to);
    if (e > s) intervals.push([s, e]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let sum = 0;
  let start = null;
  let end = null;
  for (const [s, e] of intervals) {
    if (start == null) {
      start = s;
      end = e;
    } else if (s <= end) {
      end = Math.max(end, e);
    } else {
      sum += end - start;
      start = s;
      end = e;
    }
  }
  return sum + (start == null ? 0 : end - start);
}

const activePause = (pauses, scope) => (pauses || []).find((p) => p.scope === scope && p.end == null);

function lastDone(chore, completions) {
  let t = chore.createdAt || 0;
  for (const c of completions) if (c.choreId === chore.id && c.ts > t) t = c.ts;
  return t;
}

function urgencyOf(chore, completions, pauses) {
  const last = lastDone(chore, completions);
  const elapsed = (now() - last - pausedMs(pauses, ["house"], last, now())) / DAY;
  return elapsed / Math.max(chore.freqDays, 0.25);
}

function decayedPoints(completions, who, halfLifeDays, pauses) {
  const cutoff = now() - 28 * DAY;
  let sum = 0;
  for (const c of completions) {
    if (c.ts < cutoff) continue;
    let credit = 0;
    if (c.by === who) credit = c.difficulty;
    else if (c.by === "joint") credit = c.difficulty / 2;
    else continue;
    const ageDays = (now() - c.ts - pausedMs(pauses, ["house", who], c.ts, now())) / DAY;
    sum += credit * Math.pow(0.5, Math.max(ageDays, 0) / halfLifeDays);
  }
  return sum;
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

// ---------- Bubble field ----------
function BubbleField({ chores, completions, pauses, onTap, popId, simDays }) {
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
      const r = Math.max(Math.min(baseR * impW * growth, 100), 17);
      return { id: ch.id, chore: ch, r, urgency: urgencyOf(ch, completions, pauses), hue: HUES[i % HUES.length] };
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
      .force("x", d3.forceX(size.w / 2).strength(0.02))
      .force("y", d3.forceY(size.h / 2).strength(0.026))
      .force("collide", d3.forceCollide((d) => d.r + 7).strength(1).iterations(3))
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
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: node.id, startX: e.clientX, startY: e.clientY, moved: false };
  };

  const onPointerMove = (e, node) => {
    const d = dragRef.current;
    if (!d || d.id !== node.id) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > 8) {
      d.moved = true;
      if (simRef.current) simRef.current.alphaTarget(0.12).restart();
    }
    if (d.moved) {
      const rect = wrapRef.current.getBoundingClientRect();
      node.fx = e.clientX - rect.left;
      node.fy = e.clientY - rect.top;
    }
  };

  const onPointerUp = (e, node) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.id !== node.id) return;
    node.fx = null;
    node.fy = null;
    if (simRef.current) simRef.current.alphaTarget(0);
    if (!d.moved) onTap(node.chore);
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
        return (
          <div
            key={n.id}
            onPointerDown={(e) => onPointerDown(e, n)}
            onPointerMove={(e) => onPointerMove(e, n)}
            onPointerUp={(e) => onPointerUp(e, n)}
            style={{
              position: "absolute",
              left: n.x - n.r,
              top: n.y - n.r,
              width: n.r * 2,
              height: n.r * 2,
              borderRadius: "50%",
              background: `radial-gradient(circle at 32% 30%, ${n.hue}F5, ${n.hue}AA 60%, ${n.hue}66)`,
              boxShadow: due
                ? `0 0 ${overdue ? 26 : 14}px ${n.hue}${overdue ? "AA" : "66"}, inset 0 0 12px rgba(255,255,255,0.25)`
                : `inset 0 0 10px rgba(255,255,255,0.18)`,
              border: due ? `2px solid ${n.hue}` : `1.5px solid ${n.hue}66`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "grab",
              userSelect: "none",
              WebkitTapHighlightColor: "transparent",
              animation: popId === n.id ? `pop 0.65s ease-out` : `breathe ${overdue ? 2.2 : 3.6}s ease-in-out infinite`,
              transition: "width 0.7s cubic-bezier(0.34, 1.4, 0.5, 1), height 0.7s cubic-bezier(0.34, 1.4, 0.5, 1)",
              zIndex: dragRef.current && dragRef.current.id === n.id ? 5 : 1,
            }}
          >
            {popId === n.id && (
              <span style={{ position: "absolute", top: -14, right: -6, fontSize: 20, animation: "sparkleUp 0.9s ease-out forwards", pointerEvents: "none" }}>✨</span>
            )}
            <span
              style={{
                fontFamily: "'Baloo 2', sans-serif",
                fontWeight: 600,
                fontSize: Math.max(9, Math.min(n.r * 0.3, 16)),
                color: "#0C1B26",
                textAlign: "center",
                lineHeight: 1.12,
                padding: 5,
                overflow: "hidden",
                pointerEvents: "none",
              }}
            >
              {n.chore.name}
            </span>
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
        style={{ background: "#16303C", borderRadius: "22px 22px 0 0", padding: "22px 20px 34px", width: "100%", maxWidth: 480, boxShadow: "0 -8px 40px rgba(0,0,0,0.5)" }}
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
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceSel, setServiceSel] = useState({});
  const [editChore, setEditChore] = useState(null);
  const [toast, setToast] = useState(null);
  const [popId, setPopId] = useState(null);
  const [syncState, setSyncState] = useState("");
  const [simDays, setSimDays] = useState(0);
  const [simOpen, setSimOpen] = useState(false);
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
    if (simDaysRef.current > 0) {
      showToast("Return to today before making changes.");
      return false;
    }
    const stamped = { ...operation, id: operation.id || uid(), createdAt: realNow() };
    enqueueOperation(stamped);
    setData((current) => applyOperation(current, stamped));
    flushQueue();
    return true;
  }, [flushQueue, showToast]);

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

  const setSim = (days) => {
    const d = Math.max(0, days);
    TIME_OFFSET = d * DAY;
    setSimDays(d);
  };

  const resetActivity = () => {
    commit({ type: "completion:remove", ids: data.completions.map((item) => item.id) });
  };

  const togglePause = (scope) => {
    const active = !!activePause(data.pauses || [], scope);
    commit({ type: "pause:set", scope, active: !active, at: realNow(), pauseId: uid() });
  };

  const logCompletion = (chore, by) => {
    const comp = { id: uid(), choreId: chore.id, choreName: chore.name, difficulty: chore.difficulty, by, ts: realNow() };
    if (!commit({ type: "completion:add", completion: comp })) return;
    setTapChore(null);
    setPopId(chore.id);
    if (popTimer.current) clearTimeout(popTimer.current);
    popTimer.current = setTimeout(() => setPopId(null), 1000);
    const who = by === "joint" ? "together" : by === "a" ? data.settings.nameA : data.settings.nameB;
    showToast(`${chore.name} done ${by === "joint" ? "" : "by "}${who}`, () => {
      commit({ type: "completion:remove", ids: [comp.id] });
      setToast(null);
    });
  };

  const openService = () => {
    if (simDays > 0) {
      showToast("Return to today before making changes.");
      return;
    }
    const sel = {};
    for (const ch of data.chores) sel[ch.id] = !!ch.service;
    setServiceSel(sel);
    setServiceOpen(true);
  };

  const confirmService = () => {
    const ts = realNow();
    const comps = data.chores
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
    const chore = ch.id ? ch : { ...ch, id: uid(), createdAt: realNow() };
    if (commit({ type: "chore:upsert", chore })) setEditChore(null);
  };

  const deleteChore = (id) => {
    if (commit({ type: "chore:delete", choreId: id })) setEditChore(null);
  };

  const addStarters = () => {
    const chores = STARTERS.map((s) => ({ ...s, id: uid(), createdAt: realNow() }));
    commit({ type: "chore:add-many", chores });
  };

  // Pulse the health bar green whenever the score rises
  useEffect(() => {
    if (!data) return;
    const pct = Math.round(healthScore(data.chores, data.completions, data.pauses || []) * 100);
    if (prevHealthRef.current != null && pct > prevHealthRef.current) {
      setHealthPulse(true);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setHealthPulse(false), 1400);
    }
    prevHealthRef.current = pct;
  }, [data]);

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

  const { settings } = data;
  const pauses = data.pauses || [];
  const housePaused = !!activePause(pauses, "house");
  const aPaused = !!activePause(pauses, "a");
  const bPaused = !!activePause(pauses, "b");
  const ptsA = decayedPoints(data.completions, "a", settings.halfLifeDays, pauses);
  const ptsB = decayedPoints(data.completions, "b", settings.halfLifeDays, pauses);
  const health = healthScore(data.chores, data.completions, pauses);
  const healthPct = Math.round(health * 100);
  const healthColor = healthPct >= 80 ? "#5FE0BB" : healthPct >= 50 ? "#FFC65E" : "#FF8B7B";
  const goal = settings.weeklyGoal;
  const recent = [...data.completions].sort((a, b) => b.ts - a.ts).slice(0, 30);

  const Column = ({ label, pts, hue }) => {
    const pct = Math.min(pts / goal, 1.35);
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 17, color: "#E8F3F4", fontWeight: 600 }}>{label}</div>
        <div style={{ position: "relative", width: 74, height: 260, borderRadius: 18, background: "#0F2530", overflow: "hidden", border: "1px solid #1E4152" }}>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(1 / 1.35) * 100}%`, borderTop: "2px dashed #5FE0BB88" }} />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: `${(pct / 1.35) * 100}%`,
              background: `linear-gradient(to top, ${hue}, ${hue}88)`,
              borderRadius: "0 0 18px 18px",
              transition: "height 0.8s ease",
              boxShadow: pts >= goal ? `0 0 18px ${hue}AA` : "none",
            }}
          />
        </div>
        <div style={{ fontSize: 14, color: pts >= goal ? "#5FE0BB" : "#7FA3AC", fontWeight: 700 }}>
          {pts.toFixed(1)} / {goal}
          {pts >= goal ? " 🎉" : ""}
        </div>
      </div>
    );
  };

  const impLabel = (v) => ["", "Low", "Mild", "Medium", "High", "Critical"][v];

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "radial-gradient(120% 100% at 50% 0%, #123240 0%, #0C1B26 70%)", fontFamily: "'Nunito Sans', sans-serif", color: "#E8F3F4", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700&family=Nunito+Sans:wght@400;600;700&display=swap');
        @keyframes breathe { 0%,100%{transform:scale(1)} 50%{transform:scale(1.045)} }
        @keyframes pop { 0%{transform:scale(1.15)} 45%{transform:scale(0.82)} 100%{transform:scale(1)} }
        @keyframes sparkleUp { 0%{opacity:1; transform:translateY(0) scale(0.7)} 100%{opacity:0; transform:translateY(-26px) scale(1.25)} }
        @keyframes barSwell { 0%{transform:scaleY(1)} 25%{transform:scaleY(1.9)} 55%{transform:scaleY(1.25)} 100%{transform:scaleY(1)} }
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
      {data.chores.length > 0 && (
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
          {simDays > 0 && (
            <div style={{ margin: "4px 20px 0", padding: "9px 14px", background: "#3B3215", border: "1px solid #6E5C21", borderRadius: 12, fontSize: 13, color: "#FFC65E", textAlign: "center" }}>
              🧪 Preview only. Return to today to log or edit anything.
            </div>
          )}
          {housePaused && (
            <div style={{ margin: "4px 20px 0", padding: "9px 14px", background: "#12384A", border: "1px solid #1E5A73", borderRadius: 12, fontSize: 13, color: "#9FD4EA", textAlign: "center" }}>
              🏖 Household paused. Bubbles are frozen until you resume.
            </div>
          )}
          <BubbleField chores={data.chores} completions={data.completions} pauses={pauses} onTap={simDays > 0 ? () => showToast("Return to today before logging a chore.") : setTapChore} popId={popId} simDays={simDays} />
          <div style={{ padding: "0 20px 10px" }}>
            <button disabled={simDays > 0} onClick={openService} style={{ ...btnStyle("#0F2530", "#5FE0BB"), width: "100%", border: "1px solid #1E4152", opacity: simDays > 0 ? 0.45 : 1 }}>
              🧹 Cleaning service came
            </button>
          </div>
        </div>
      )}

      {tab === "log" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px 20px" }}>
          <div style={{ display: "flex", gap: 20, justifyContent: "center", padding: "12px 0 4px" }}>
            <Column label={`${settings.nameA}${aPaused || housePaused ? " 🏖" : ""}`} pts={ptsA} hue="#6FC3FF" />
            <Column label={`${settings.nameB}${bPaused || housePaused ? " 🏖" : ""}`} pts={ptsB} hue="#FF9FC0" />
          </div>
          <div style={{ fontSize: 12, color: "#7FA3AC", textAlign: "center", marginBottom: 18 }}>
            Effort decays with a {settings.halfLifeDays} day half-life. Dashed line is the goal. Joint chores split credit.
          </div>
          <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Recent activity</div>
          {recent.length === 0 && <div style={{ color: "#7FA3AC", fontSize: 14 }}>Nothing logged yet. Tap a bubble to get started.</div>}
          {recent.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid #1A3542" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {c.by === "service" ? "🧹 " : ""}{c.choreName}
                </div>
                <div style={{ fontSize: 12, color: "#7FA3AC" }}>
                  {c.by === "a" ? settings.nameA : c.by === "b" ? settings.nameB : c.by === "joint" ? "Together" : "Cleaning service"} · {timeAgo(c.ts)}
                </div>
              </div>
              <div style={{ fontSize: 13, color: c.by === "service" ? "#7FA3AC" : "#5FE0BB", fontWeight: 700 }}>
                {c.by === "service" ? "reset" : `+${c.by === "joint" ? (c.difficulty / 2).toFixed(1) + " each" : c.difficulty}`}
              </div>
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
          {data.chores.length === 0 && (
            <button disabled={simDays > 0} onClick={addStarters} style={{ ...btnStyle("#0F2530", "#B9D2D8"), width: "100%", marginBottom: 10, border: "1px solid #1E4152", opacity: simDays > 0 ? 0.45 : 1 }}>
              Load a starter list of common chores
            </button>
          )}
          {data.chores.map((ch, i) => (
            <div key={ch.id} onClick={() => setEditChore(ch)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #1A3542", cursor: "pointer" }}>
              <div style={{ width: 14, height: 14, borderRadius: "50%", background: HUES[i % HUES.length], flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{ch.name}</div>
                <div style={{ fontSize: 12, color: "#7FA3AC" }}>
                  {impLabel(ch.importance)} importance · effort {ch.difficulty} · every {ch.freqDays}d{ch.service ? " · 🧹 service" : ""}
                </div>
              </div>
              <div style={{ color: "#7FA3AC" }}>›</div>
            </div>
          ))}

          <div style={{ marginTop: 26, fontFamily: "'Baloo 2', sans-serif", fontSize: 16, fontWeight: 600 }}>Vacation mode</div>
          <div style={{ fontSize: 12, color: "#7FA3AC", margin: "4px 0 10px" }}>
            Household pause freezes all bubble growth and both columns. A solo pause protects one person's column during a trip or a rough week while bubbles keep growing for whoever is home.
          </div>
          <button onClick={() => togglePause("house")} style={{ ...btnStyle(housePaused ? "#6FC3FF" : "#0F2530", housePaused ? "#0C1B26" : "#9FD4EA"), width: "100%", marginBottom: 8, border: housePaused ? "none" : "1px solid #1E4152" }}>
            {housePaused ? "🏖 Resume household" : "🏖 Pause whole household"}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => togglePause("a")} style={{ ...btnStyle(aPaused ? "#6FC3FF" : "#0F2530", aPaused ? "#0C1B26" : "#B9D2D8"), flex: 1, fontSize: 13, border: aPaused ? "none" : "1px solid #1E4152" }}>
              {aPaused ? `Resume ${settings.nameA}` : `Pause ${settings.nameA}`}
            </button>
            <button onClick={() => togglePause("b")} style={{ ...btnStyle(bPaused ? "#6FC3FF" : "#0F2530", bPaused ? "#0C1B26" : "#B9D2D8"), flex: 1, fontSize: 13, border: bPaused ? "none" : "1px solid #1E4152" }}>
              {bPaused ? `Resume ${settings.nameB}` : `Pause ${settings.nameB}`}
            </button>
          </div>

          <div style={{ marginTop: 26, fontFamily: "'Baloo 2', sans-serif", fontSize: 16, fontWeight: 600 }}>Household settings</div>
          <Stepper label="Weekly effort goal (points)" value={settings.weeklyGoal} min={4} max={40} onChange={(v) => commit({ type: "settings:patch", patch: { weeklyGoal: v } })} />
          <Stepper label="Decay half-life (days)" value={settings.halfLifeDays} min={3} max={21} onChange={(v) => commit({ type: "settings:patch", patch: { halfLifeDays: v } })} />
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
            Fast-forward this phone's clock to preview how bubbles grow and columns decay. Preview mode is read-only and never changes shared data or timestamps.
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

      {/* Complete chore */}
      {tapChore && (
        <Modal onClose={() => setTapChore(null)}>
          <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 19, fontWeight: 700 }}>{tapChore.name}</div>
          <div style={{ fontSize: 13, color: "#7FA3AC", margin: "4px 0 18px" }}>
            Last done {timeAgo(lastDone(tapChore, data.completions))} · worth {tapChore.difficulty} pts
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
          <div style={{ fontSize: 13, color: "#7FA3AC", marginBottom: 14 }}>Check off what they handled. These bubbles reset without crediting either column.</div>
          <div style={{ maxHeight: 300, overflowY: "auto", marginBottom: 16 }}>
            {data.chores.map((ch) => (
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
          <input
            value={editChore.name}
            placeholder="Chore name"
            onChange={(e) => setEditChore({ ...editChore, name: e.target.value })}
            style={{ width: "100%", background: "#0F2530", border: "1px solid #1E4152", borderRadius: 12, padding: "12px 14px", color: "#E8F3F4", fontSize: 15, fontFamily: "inherit", marginBottom: 6 }}
          />
          <Stepper label="Importance" value={editChore.importance} min={1} max={5} onChange={(v) => setEditChore({ ...editChore, importance: v })} format={impLabel} />
          <Stepper label="Effort points" value={editChore.difficulty} min={1} max={5} onChange={(v) => setEditChore({ ...editChore, difficulty: v })} />
          <Stepper label="Goal frequency" value={editChore.freqDays} min={1} max={60} onChange={(v) => setEditChore({ ...editChore, freqDays: v })} format={(v) => `every ${v}d`} />
          <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!editChore.service}
              onChange={(e) => setEditChore({ ...editChore, service: e.target.checked })}
              style={{ width: 19, height: 19, accentColor: "#5FE0BB" }}
            />
            <span style={{ fontSize: 14, color: "#B9D2D8" }}>Cleaning service usually handles this</span>
          </label>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            {editChore.id && (
              <button onClick={() => deleteChore(editChore.id)} style={{ ...btnStyle("#0F2530", "#FF8B7B"), flex: 1, border: "1px solid #1E4152" }}>Delete</button>
            )}
            <button onClick={() => editChore.name.trim() && saveChore(editChore)} style={{ ...btnStyle("#5FE0BB"), flex: 2, opacity: editChore.name.trim() ? 1 : 0.5 }}>
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
