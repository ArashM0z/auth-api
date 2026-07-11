// Faithful React conversion of pages/playground.html: scenario buttons on
// the left, and on the right the simulated HTTP exchange this service
// produces — request, per-scenario client⇄app⇄Redis sequence diagram,
// server pipeline animation, and the captured response with telemetry.
//
// The responses were captured from the running app and are replayed here
// client-side (there is no live backend on GitHub Pages) — the original
// page's inline JS simulation is ported to typed React state; no real
// network calls are made.
import { useEffect, useMemo, useState } from 'react';
import Nav from '../components/Nav';
import type {
  CreateUserRequest,
  CreateUserSuccess,
  LoginRequest,
  LoginSuccess,
  ProblemDetails,
} from '../lib/api';
import '../styles/playground.css';

const RID = 'req-3f9c…a71b';

type Kind = 'ok' | 'warn' | 'err';
type Actor = 'client' | 'app' | 'redis';
type FlowKind = 'req' | 'redis' | 'redis-stop' | 'self' | 'self-stop' | 'ok' | 'warn' | 'err';

/** One arrow (or self-call) in the client⇄app⇄Redis round trip. */
type FlowStep = { f: Actor; l: string; k: FlowKind } & (
  | { self: true; t?: never }
  | { self?: never; t: Actor }
);

interface ScenarioRequest {
  m: string;
  p: string;
  /** JSON body (typed by the generated OpenAPI client)… */
  body?: CreateUserRequest | LoginRequest;
  /** …or a raw (intentionally broken) body for the malformed-JSON case. */
  raw?: string;
}

interface ScenarioResponse {
  status: number;
  text: string;
  cls: Kind;
  headers: [name: string, value: string][];
  body: CreateUserSuccess | LoginSuccess | ProblemDetails;
}

interface Scenario {
  id: string;
  kind: Kind;
  code: string;
  t: string;
  s: string;
  why: string;
  req: ScenarioRequest;
  flow: FlowStep[];
  cap: string;
  res: ScenarioResponse;
  tel: [type: 'audit' | 'metric', label: string, value: string][];
}

const S: Scenario[] = [
  {
    id: 'create', kind: 'ok', code: '201', t: 'Create a user', s: 'valid signup',
    why: 'Unique username created atomically; the hash is stored, never returned.',
    req: { m: 'POST', p: '/v1/users', body: { username: 'alice', password: 'correct horse battery staple' } },
    flow: [
      { f: 'client', t: 'app', l: 'POST /v1/users', k: 'req' },
      { f: 'app', self: true, l: 'validate policy ✓', k: 'self' },
      { f: 'app', t: 'redis', l: 'SET NX user:alice', k: 'redis' },
      { f: 'redis', t: 'app', l: 'OK · created', k: 'redis' },
      { f: 'app', t: 'client', l: '201 Created', k: 'ok' }],
    cap: 'Uniqueness is a single atomic SET NX in Redis — no read-then-write race.',
    res: {
      status: 201, text: 'Created', cls: 'ok',
      headers: [['location', '/v1/users/alice'], ['content-type', 'application/json; charset=utf-8'], ['x-request-id', RID]],
      body: { user: { username: 'alice', createdAt: '2026-07-07T19:42:07.033Z' } },
    },
    tel: [['audit', 'event', 'user.created'], ['metric', '+1', 'authapi_users_created_total']],
  },

  {
    id: 'login', kind: 'ok', code: '200', t: 'Log in', s: 'correct password',
    why: 'Argon2id verify passes; the failure window is cleared.',
    req: { m: 'POST', p: '/v1/auth/login', body: { username: 'alice', password: 'correct horse battery staple' } },
    flow: [
      { f: 'client', t: 'app', l: 'POST /v1/auth/login', k: 'req' },
      { f: 'app', t: 'redis', l: 'INCR login-failures:alice', k: 'redis' },
      { f: 'redis', t: 'app', l: '1 · under cap', k: 'redis' },
      { f: 'app', t: 'redis', l: 'GET user:alice', k: 'redis' },
      { f: 'redis', t: 'app', l: 'stored hash', k: 'redis' },
      { f: 'app', self: true, l: 'Argon2id verify ✓', k: 'self' },
      { f: 'app', t: 'redis', l: 'DEL login-failures:alice', k: 'redis' },
      { f: 'app', t: 'client', l: '200 authenticated', k: 'ok' }],
    cap: 'The failure counter is consumed BEFORE the hash, then cleared on success.',
    res: {
      status: 200, text: 'OK', cls: 'ok',
      headers: [['content-type', 'application/json; charset=utf-8'], ['x-request-id', RID]],
      body: { authenticated: true, user: { username: 'alice' } },
    },
    tel: [['audit', 'event', 'auth.success'], ['metric', '+1', 'authapi_auth_attempts_total{outcome="success"}']],
  },

  {
    id: 'weak', kind: 'warn', code: '422', t: 'Weak password', s: 'policy violation',
    why: 'NIST 800-63B-4: min 15 chars + blocklist. All violations returned at once.',
    req: { m: 'POST', p: '/v1/users', body: { username: 'bob', password: 'password' } },
    flow: [
      { f: 'client', t: 'app', l: 'POST /v1/users', k: 'req' },
      { f: 'app', self: true, l: 'password policy → 2 violations ✕', k: 'self-stop' },
      { f: 'app', t: 'client', l: '422 · never touches Redis', k: 'warn' }],
    cap: 'Policy fails in-process, so the request is rejected before Redis is ever consulted.',
    res: {
      status: 422, text: 'Unprocessable Entity', cls: 'warn',
      headers: [['content-type', 'application/problem+json; charset=utf-8'], ['x-request-id', RID]],
      body: {
        type: '/problems/weak-password', title: 'Password does not meet policy', status: 422, code: 'WEAK_PASSWORD',
        detail: 'The supplied password does not meet the password policy.', instance: '/v1/users', requestId: RID,
        errors: [
          { field: 'password', rule: 'min_length', message: 'must be at least 15 characters — a long passphrase (spaces allowed) is ideal' },
          { field: 'password', rule: 'blocklist', message: 'is on the list of commonly used passwords' },
        ],
      },
    },
    tel: [['metric', '+1', 'authapi_http_requests_total{route="/v1/users",status="422"}']],
  },

  {
    id: 'dup', kind: 'err', code: '409', t: 'Duplicate username', s: 'already taken',
    why: 'Rejected by Redis SET NX — no check-then-set race, even under concurrency.',
    req: { m: 'POST', p: '/v1/users', body: { username: 'alice', password: 'correct horse battery staple' } },
    flow: [
      { f: 'client', t: 'app', l: 'POST /v1/users', k: 'req' },
      { f: 'app', self: true, l: 'validate policy ✓', k: 'self' },
      { f: 'app', t: 'redis', l: 'SET NX user:alice', k: 'redis' },
      { f: 'redis', t: 'app', l: 'nil · key already exists', k: 'redis-stop' },
      { f: 'app', t: 'client', l: '409 Conflict', k: 'err' }],
    cap: 'SET NX returns nil when the key exists — the conflict is decided by Redis, atomically.',
    res: {
      status: 409, text: 'Conflict', cls: 'err',
      headers: [['content-type', 'application/problem+json; charset=utf-8'], ['x-request-id', RID]],
      body: {
        type: '/problems/username-taken', title: 'Username already exists', status: 409, code: 'USERNAME_TAKEN',
        detail: 'A user with this username already exists.', instance: '/v1/users', requestId: RID,
      },
    },
    tel: [['audit', 'event', 'user.create_conflict'], ['metric', '+1', 'authapi_http_requests_total{status="409"}']],
  },

  {
    id: 'wrong', kind: 'err', code: '401', t: 'Wrong password', s: 'bad credentials',
    why: 'Same 401, same body, same timing as an unknown user — no enumeration.',
    req: { m: 'POST', p: '/v1/auth/login', body: { username: 'alice', password: 'nope nope nope nope' } },
    flow: [
      { f: 'client', t: 'app', l: 'POST /v1/auth/login', k: 'req' },
      { f: 'app', t: 'redis', l: 'INCR login-failures:alice', k: 'redis' },
      { f: 'redis', t: 'app', l: '2 · under cap', k: 'redis' },
      { f: 'app', t: 'redis', l: 'GET user:alice', k: 'redis' },
      { f: 'redis', t: 'app', l: 'stored hash', k: 'redis' },
      { f: 'app', self: true, l: 'Argon2id verify ✕', k: 'self-stop' },
      { f: 'app', t: 'client', l: '401 · identical to unknown user', k: 'err' }],
    cap: 'An unknown username runs a dummy Argon2id verify at the same cost — no timing tell.',
    res: {
      status: 401, text: 'Unauthorized', cls: 'err',
      headers: [['ratelimit', '"login-failures";r=2;t=900'], ['ratelimit-policy', '"login-failures";q=3;w=900'], ['content-type', 'application/problem+json; charset=utf-8'], ['x-request-id', RID]],
      body: {
        type: '/problems/invalid-credentials', title: 'Invalid credentials', status: 401, code: 'INVALID_CREDENTIALS',
        detail: 'Username or password is incorrect.', instance: '/v1/auth/login', requestId: RID,
      },
    },
    tel: [['audit', 'event', 'auth.failure'], ['metric', '+1', 'authapi_auth_attempts_total{outcome="invalid"}']],
  },

  {
    id: 'ratelimit', kind: 'err', code: '429', t: 'Rate limited', s: 'too many failures',
    why: 'After the per-username cap, requests are refused before hashing — Retry-After tells you when.',
    req: { m: 'POST', p: '/v1/auth/login', body: { username: 'carol', password: 'nope nope nope nope' } },
    flow: [
      { f: 'client', t: 'app', l: 'POST /v1/auth/login', k: 'req' },
      { f: 'app', t: 'redis', l: 'INCR login-failures:carol', k: 'redis' },
      { f: 'redis', t: 'app', l: '6 · over the cap', k: 'redis-stop' },
      { f: 'app', self: true, l: 'refuse before hashing — no Argon2', k: 'self-stop' },
      { f: 'app', t: 'client', l: '429 · Retry-After: 900', k: 'err' }],
    cap: 'The gate is consumed first, so a flood is refused before the expensive hash runs.',
    res: {
      status: 429, text: 'Too Many Requests', cls: 'err',
      headers: [['ratelimit', '"login-failures";r=0;t=900'], ['ratelimit-policy', '"login-failures";q=3;w=900'], ['retry-after', '900'], ['content-type', 'application/problem+json; charset=utf-8'], ['x-request-id', RID]],
      body: {
        type: '/problems/rate-limited', title: 'Too many requests', status: 429, code: 'RATE_LIMITED',
        detail: 'Too many failed attempts for this account. Retry later.', instance: '/v1/auth/login', requestId: RID,
      },
    },
    tel: [['audit', 'event', 'auth.rate_limited'], ['metric', '+1', 'authapi_rate_limited_total{scope="username"}']],
  },

  {
    id: 'malformed', kind: 'err', code: '400', t: 'Malformed JSON', s: 'broken body',
    why: 'Caught at the edge and turned into a clean problem+json, never a stack trace.',
    req: { m: 'POST', p: '/v1/users', raw: '{bad json' },
    flow: [
      { f: 'client', t: 'app', l: 'POST /v1/users  {bad json', k: 'req' },
      { f: 'app', self: true, l: 'JSON parse fails at the edge ✕', k: 'self-stop' },
      { f: 'app', t: 'client', l: '400 · never reaches the handler', k: 'err' }],
    cap: 'The body parser rejects it before routing — the route handler never runs.',
    res: {
      status: 400, text: 'Bad Request', cls: 'err',
      headers: [['content-type', 'application/problem+json; charset=utf-8'], ['x-request-id', RID]],
      body: {
        type: '/problems/malformed-body', title: 'Request body is not valid JSON', status: 400, code: 'MALFORMED_BODY',
        detail: 'Request body must be valid JSON.', instance: '/v1/users', requestId: RID,
      },
    },
    tel: [['metric', '+1', 'authapi_http_requests_total{status="400"}']],
  },
];

const esc = (s: unknown): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Syntax-highlighted JSON, as an HTML string (same output as the original page). */
function jsonHTML(obj: unknown, ind = 0): string {
  const pad = '  '.repeat(ind), pad1 = '  '.repeat(ind + 1);
  if (obj === null) return '<span class="num">null</span>';
  if (typeof obj === 'boolean') return '<span class="num">' + obj + '</span>';
  if (typeof obj === 'number') return '<span class="num">' + obj + '</span>';
  if (typeof obj === 'string') return '<span class="str">"' + esc(obj) + '"</span>';
  if (Array.isArray(obj)) {
    if (!obj.length) return '[]';
    return '[\n' + obj.map((v) => pad1 + jsonHTML(v, ind + 1)).join(',\n') + '\n' + pad + ']';
  }
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (!keys.length) return '{}';
  return '{\n' + keys.map((k) => pad1 + '<span class="k">"' + esc(k) + '"</span>: ' + jsonHTML(rec[k], ind + 1)).join(',\n') + '\n' + pad + '}';
}

function reqHTML(r: ScenarioRequest): string {
  const body = r.raw !== undefined ? esc(r.raw) : jsonHTML(r.body, 0);
  return '<span class="m">' + r.m + '</span> <span class="p">' + esc(r.p) + '</span> <span class="h">HTTP/1.1</span>\n'
    + '<span class="h">host:</span> auth-api\n<span class="h">content-type:</span> application/json\n\n' + body;
}

function respHTML(res: ScenarioResponse): string {
  const hdrs = res.headers.map(([k, v]) => '<span class="h">' + esc(k) + ':</span> ' + esc(v)).join('\n');
  return hdrs + '\n\n' + jsonHTML(res.body, 0);
}

// ---- per-scenario sequence diagram (SVG built as a string, like the original) ----
const SEQ_X: Record<Actor, number> = { client: 110, app: 360, redis: 610 };
const SEQ_ACTOR: Record<Actor, [name: string, sub: string]> = {
  client: ['Client', 'browser / caller'],
  app: ['App · Fastify', 'behind the ALB'],
  redis: ['Redis', 'ElastiCache'],
};
const KCOLOR: Record<FlowKind, string> = {
  req: 'ink', redis: 'indigo', 'redis-stop': 'err', self: 'ink', 'self-stop': 'err',
  ok: 'ok', warn: 'warn', err: 'err',
};
const SEQ_BAR = 5;
const ACTORS = Object.keys(SEQ_X) as Actor[];

function seqEdge(actor: Actor, dir: number, rActive: boolean): number {
  const x = SEQ_X[actor];
  if (actor === 'client') return x;
  if (actor === 'redis' && !rActive) return x;
  return x + dir * SEQ_BAR;
}

function seqSVG(flow: FlowStep[], reduce: boolean): { g: string; h: number } {
  const rowH = 46, top = 104, N = flow.length, h = top + N * rowH + 10, bottom = h - 12;
  const firstY = top, lastY = top + (N - 1) * rowH;
  const rIdx: number[] = [];
  flow.forEach((st, i) => { if (st.f === 'redis' || st.t === 'redis') rIdx.push(i); });
  const rActive = rIdx.length > 0;
  const STEP = 850, PAUSE = 900, GLOW = 650, TOTAL = N * STEP + PAUSE;
  const pB = (GLOW / TOTAL * 100).toFixed(2), pD = ((GLOW + 250) / TOTAL * 100).toFixed(2);
  const pM = (STEP * 0.8 / TOTAL * 100).toFixed(2), pME = (STEP * 0.9 / TOTAL * 100).toFixed(2);
  let g = '<defs>' + ['ink', 'indigo', 'ok', 'warn', 'err'].map((c) =>
    '<marker id="mk-' + c + '" markerWidth="7.5" markerHeight="7.5" refX="6" refY="3" orient="auto"><path class="mh-' + c + '" d="M0,0 L7,3 L0,6 Z"/></marker>').join('') + '</defs>';
  if (!reduce) {
    g += '<style>'
      + '.seqsvg .ln{animation:seqline ' + TOTAL + 'ms linear infinite;}'
      + '.seqsvg .pkt{animation:seqpkt ' + TOTAL + 'ms linear infinite;}'
      + '@keyframes seqline{0%{stroke-width:2;}2%{stroke-width:3.4;}' + pB + '%{stroke-width:3.4;}' + pD + '%{stroke-width:2;}100%{stroke-width:2;}}'
      + '@keyframes seqpkt{0%{opacity:0;transform:translateX(0);}3%{opacity:1;}' + pM + '%{opacity:1;transform:translateX(var(--dx));}' + pME + '%{opacity:0;transform:translateX(var(--dx));}100%{opacity:0;transform:translateX(var(--dx));}}'
      + '</style>';
  }
  g += '<rect class="frame" x="6" y="6" width="688" height="' + (h - 12) + '" rx="13"/>';
  // activation bars (drawn behind the arrows)
  g += '<rect class="act" x="' + (SEQ_X.app - SEQ_BAR) + '" y="' + (firstY - 9) + '" width="' + (SEQ_BAR * 2) + '" height="' + ((lastY - firstY) + 18) + '" rx="3"/>';
  if (rActive) {
    const ry0 = top + rIdx[0] * rowH, ry1 = top + rIdx[rIdx.length - 1] * rowH;
    g += '<rect class="act redis" x="' + (SEQ_X.redis - SEQ_BAR) + '" y="' + (ry0 - 9) + '" width="' + (SEQ_BAR * 2) + '" height="' + ((ry1 - ry0) + 18) + '" rx="3"/>';
  }
  for (const key of ACTORS) { const x = SEQ_X[key]; g += '<line class="life" x1="' + x + '" y1="70" x2="' + x + '" y2="' + bottom + '"/>'; }
  for (const key of ACTORS) {
    const x = SEQ_X[key], a = SEQ_ACTOR[key];
    g += '<rect class="actorbox" x="' + (x - 60) + '" y="18" width="120" height="46" rx="10"/>';
    g += '<line class="actop ' + key + '" x1="' + (x - 44) + '" y1="18" x2="' + (x + 44) + '" y2="18"/>';
    g += '<text class="aname" x="' + x + '" y="40" text-anchor="middle">' + esc(a[0]) + '</text>';
    g += '<text class="asub" x="' + x + '" y="53" text-anchor="middle">' + esc(a[1]) + '</text>';
  }
  flow.forEach((st, i) => {
    const y = top + i * rowH, col = KCOLOR[st.k], mk = 'mk-' + col;
    const sd = reduce ? '' : ' style="animation-delay:' + (i * STEP) + 'ms"';
    g += '<text class="stepn" x="26" y="' + (y + 3) + '" text-anchor="middle">' + (i + 1) + '</text>';
    if (st.self) {
      const x = SEQ_X.app + SEQ_BAR;
      g += '<path class="ln ' + col + '"' + sd + ' d="M' + x + ',' + (y - 5) + ' h34 v11 h-30" marker-end="url(#' + mk + ')"/>';
      g += '<text class="msg ' + col + '" x="' + (x + 46) + '" y="' + (y + 3) + '" text-anchor="start">' + esc(st.l) + '</text>';
    } else {
      const dir = SEQ_X[st.t] > SEQ_X[st.f] ? 1 : -1;
      const x1 = seqEdge(st.f, dir, rActive), x2 = seqEdge(st.t, -dir, rActive);
      g += '<line class="ln ' + col + '"' + sd + ' x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '" marker-end="url(#' + mk + ')"/>';
      g += '<text class="msg ' + col + '" x="' + ((x1 + x2) / 2) + '" y="' + (y - 7) + '" text-anchor="middle">' + esc(st.l) + '</text>';
      if (!reduce) {
        g += '<circle class="pkt pkt-' + col + '" r="3.8" cx="' + x1 + '" cy="' + y + '" style="animation-delay:' + (i * STEP) + 'ms;--dx:' + (x2 - x1) + 'px"/>';
      }
    }
  });
  return { g, h };
}

const STAGES = ['Parse JSON', 'Validate', 'Rate gate', 'Verify / store', 'Respond'];
function stopIndex(st: number): number {
  if (st === 400) return 0;
  if (st === 422) return 1;
  if (st === 429) return 2;
  if (st === 409 || st === 401) return 3;
  return 4;
}

export default function Playground() {
  const reduce = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const [active, setActive] = useState(0);
  // Bumped on every click so re-selecting the active scenario replays it,
  // exactly like the original run(i).
  const [runId, setRunId] = useState(0);
  const [shown, setShown] = useState(0); // pipeline chips revealed so far
  const [done, setDone] = useState(false); // response card visible

  const sc = S[active];
  const stop = stopIndex(sc.res.status);
  const success = sc.res.status < 400;
  const reached = success ? 4 : stop;

  const seq = useMemo(() => seqSVG(sc.flow, reduce), [sc, reduce]);

  useEffect(() => {
    setShown(0);
    setDone(false);
    const step = reduce ? 70 : 190;
    let n = 0;
    const timer = window.setInterval(() => {
      if (n <= reached) { n++; setShown(n); return; }
      window.clearInterval(timer);
      setDone(true);
    }, step);
    return () => window.clearInterval(timer);
  }, [active, runId, reached, reduce]);

  const run = (i: number) => {
    setActive(i);
    setRunId((id) => id + 1);
  };

  return (
    <>
      <Nav current="playground" />
      <div className="wrap">
        <p className="eyebrow">Interactive · real captured responses</p>
        <h1>See exactly how the API answers — every case</h1>
        <p className="lede">Pick a scenario and fire the request. You get the real HTTP exchange this service produces: the status, the headers that matter, the RFC{' '}9457 body — and the exact round trip between the client, the app, and Redis that produced it.</p>
        <div className="disclaimer">Responses were captured from the running app, then replayed here client-side. No live backend needed.</div>

        <div className="app">
          <div className="scenarios">
            {S.map((s, i) => (
              <button
                key={s.id}
                className={'scn' + (i === active ? ' active' : '')}
                onClick={() => run(i)}
              >
                <span className={'badge ' + s.kind}>{s.code}</span>
                <span className="txt">
                  <span className="t">{s.t}</span>
                  <span className="s">{s.s}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="stage">
            <div className="card">
              <div className="card-h">
                Request{' '}
                <span className="send">
                  {done ? '↳ 200 ms' : <>sending <span className="cursor"></span></>}
                </span>
              </div>
              <pre className="block" dangerouslySetInnerHTML={{ __html: reqHTML(sc.req) }} />
            </div>
            <div className="card">
              <div className="card-h">This request's round trip <span className="tag">client ⇄ app ⇄ Redis</span></div>
              <div className="seqwrap">
                <svg
                  className={'seqsvg' + (reduce ? ' noanim' : '')}
                  viewBox={'0 0 700 ' + seq.h}
                  role="img"
                  aria-label="Per-scenario sequence diagram of the request"
                  dangerouslySetInnerHTML={{ __html: seq.g }}
                />
              </div>
              <div className="seqcap">{sc.cap}</div>
            </div>
            <div className="card">
              <div className="card-h">How the request flows through the server</div>
              <div className="pipe">
                {STAGES.map((s, idx) => {
                  let cls = 'stg', icon = '·';
                  if (idx < stop || (idx === stop && success)) { cls += ' pass'; icon = '✓'; }
                  else if (idx === stop) { cls += ' stop ' + sc.res.cls; icon = '✕'; }
                  if (idx < shown) cls += ' shown';
                  return (
                    <div key={s} className={cls}>
                      <div className="dot">{icon}</div>
                      <div className="lbl">{s}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            {done && (
              <div className="card">
                <div className="statusline">
                  <span className={'pill ' + sc.res.cls}>{sc.res.status} {sc.res.text}</span>
                  <span className="why">{sc.why}</span>
                </div>
                <div className="card-h">Response body</div>
                <pre className="block" dangerouslySetInnerHTML={{ __html: respHTML(sc.res) }} />
                <div className="telemetry">
                  {sc.tel.map(([type, , val]) => (
                    <span key={val} className={'tchip ' + type}>
                      <span className="lab">{type === 'audit' ? 'audit log' : 'metric'}</span> <b>{val}</b>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="foot">Want to hammer the failure limiter yourself? → <a href="ratelimit.html">Rate limiter demo</a> · Base URL in a real deploy: <span style={{ color: 'var(--muted)' }}>{'https://<host>'}</span> · every error is <span style={{ color: 'var(--muted)' }}>application/problem+json</span> (RFC 9457).</p>
      </div>
    </>
  );
}
