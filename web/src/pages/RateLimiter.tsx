// Faithful React conversion of pages/ratelimit.html: the live per-username
// failure-window demo. Five slots fill as wrong passwords land, the window
// countdown ticks, the sixth attempt is blocked with a 429 before hashing,
// a correct login clears the counter — and the whole thing runs itself in a
// loop, exactly like the original page's inline script (simulated locally;
// no live backend on GitHub Pages, no network calls).
import { useEffect, useMemo, useRef, useState } from 'react';
import Nav from '../components/Nav';
import '../styles/ratelimit.css';

const CAP = 5;
const WIN = 15;

type LogCls = 'ok' | 'warn' | 'err';
interface LogLine {
  id: number;
  code: string;
  cls: LogCls;
  txt: string;
}

type SlotFx = 'none' | 'blocked' | 'cleared';

export default function RateLimiter() {
  const reduce = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // Rendered state (mirrors the DOM the original script mutated).
  const [count, setCount] = useState(0);
  const [fx, setFx] = useState<SlotFx>('none');
  const [popIdx, setPopIdx] = useState(-1);
  const [resetText, setResetText] = useState('');
  const [logs, setLogs] = useState<LogLine[]>([]);

  // Mutable mirrors for the timer callbacks (the original used closures).
  const countRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const resetAtRef = useRef(0);
  const logIdRef = useRef(0);

  const setCountBoth = (n: number) => {
    countRef.current = n;
    setCount(n);
  };

  const log = (code: string, cls: LogCls, txt: string) => {
    const id = ++logIdRef.current;
    setLogs((prev) => [{ id, code, cls, txt }, ...prev].slice(0, 6));
  };

  const stopTick = () => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const startTimer = () => {
    if (tickRef.current !== null) return;
    resetAtRef.current = Date.now() + WIN * 1000;
    tickRef.current = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((resetAtRef.current - Date.now()) / 1000));
      setResetText(countRef.current > 0 ? 'window resets in ' + left + 's' : '');
      if (left <= 0) {
        stopTick();
        setCountBoth(0);
        setResetText('');
        log('↺', 'ok', 'window expired — counter cleared');
      }
    }, 250);
  };

  const pop = (i: number) => {
    if (i < 0 || i >= CAP || reduce) return;
    setPopIdx(i);
    window.setTimeout(() => setPopIdx((cur) => (cur === i ? -1 : cur)), 320);
  };

  const blockedFlash = () => {
    setFx('blocked');
    window.setTimeout(() => setFx((cur) => (cur === 'blocked' ? 'none' : cur)), 320);
  };

  const wrong = () => {
    if (countRef.current < CAP) {
      const n = countRef.current + 1;
      setCountBoth(n);
      pop(n - 1);
      startTimer();
      log('401', 'err', 'wrong password · slot ' + n + '/' + CAP + ' consumed · metric outcome=invalid +1');
    } else {
      blockedFlash();
      log('429', 'err', 'blocked before hashing · Retry-After sent · metric rate_limited +1');
    }
  };

  const right = () => {
    if (countRef.current >= CAP) {
      blockedFlash();
      log('429', 'err', "already locked — a correct password can't get through until reset");
      return;
    }
    setFx('cleared');
    window.setTimeout(() => {
      setCountBoth(0);
      stopTick();
      setResetText('');
      setFx((cur) => (cur === 'cleared' ? 'none' : cur));
    }, 380);
    log('200', 'ok', 'correct — window cleared · metric outcome=success +1');
  };

  const reset = () => {
    setCountBoth(0);
    stopTick();
    setResetText('');
    setFx('none');
  };

  // ---- self-running demo (loops forever), as in the original ----
  useEffect(() => {
    const steps: [delay: number, action: () => void][] = [
      [600, reset],
      [1000, wrong], [850, wrong], [850, wrong],
      [1200, right],
      [1100, wrong], [800, wrong], [800, wrong], [800, wrong], [800, wrong],
      [1000, wrong], [1300, wrong],
      [1700, () => { reset(); setLogs([]); }],
    ];
    let ai = 0;
    let auto: number;
    const tickAuto = () => {
      const step = steps[ai];
      auto = window.setTimeout(() => {
        step[1]();
        ai = (ai + 1) % steps.length;
        tickAuto();
      }, step[0]);
    };
    tickAuto();
    return () => {
      window.clearTimeout(auto);
      stopTick();
    };
    // The actions only touch refs and stable setState functions, so the
    // first-render closures stay correct for the lifetime of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const left = CAP - count;

  return (
    <>
      <Nav current="ratelimit" />
      <div className="wrap">
        <p className="eyebrow">Interactive · the real failure window</p>
        <h1>Watch the rate limiter work</h1>
        <p className="lede">The service caps failed logins per username. Hammer it with wrong passwords to fill the window, watch it block with <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>429</span> <em>before</em> it ever runs the expensive hash — then clear it with a correct login, or let the window expire.</p>

        <div className="card">
          <div className="card-h">login-failures window <span className="tag">cap 5 · 15s window · Redis-backed</span></div>
          <div style={{ padding: 18 }}>
            <div className="rl-slots">
              {Array.from({ length: CAP }, (_, i) => {
                let cls: string;
                if (fx === 'cleared') {
                  cls = 'slot cleared';
                } else {
                  cls = 'slot' + (i < count ? ' used' : '') + (fx === 'blocked' ? ' blocked' : '');
                }
                if (popIdx === i) cls += ' pop';
                return (
                  <div key={i} className={cls}>{i + 1}</div>
                );
              })}
            </div>
            <div className="rl-meta-row">
              <span className="rl-meta">{left} attempt{left === 1 ? '' : 's'} left</span>
              <span className="rl-reset">{resetText}</span>
            </div>
            <div className="rl-log">
              {logs.map((l) => (
                <div key={l.id} className="rl-line">
                  <span className={'code ' + l.cls}>{l.code}</span> <span>{l.txt}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="two">
          <div className="mini">
            <div className="lvl">Layer 1 · per IP</div>
            <h3>Coarse flood control</h3>
            <p>Every request first passes an <b style={{ color: 'var(--ink)' }}>INCR</b> against the caller's IP. A single address can't fire an unlimited storm at the API regardless of which account it targets. Health probes are exempt so a busy load balancer can't lock itself out.</p>
          </div>
          <div className="mini">
            <div className="lvl">Layer 2 · per username</div>
            <h3>Targeted lockout (this demo)</h3>
            <p>Login failures are counted <b style={{ color: 'var(--ink)' }}>per account</b>. The slot is consumed <em>before</em> Argon2id runs — a concurrent burst of guesses is serialized by Redis <b style={{ color: 'var(--ink)' }}>INCR</b>, so at most the cap can ever reach the hash. A correct password clears the counter.</p>
          </div>
        </div>

        <div className="hdrs">
          {'\n'}<span style={{ color: 'var(--faint)' }}># what a blocked response actually sends</span>
          {'\n'}<span className="hk">HTTP</span> <span className="hv">429 Too Many Requests</span>
          {'\n'}<span className="hk">ratelimit:</span> <span className="hv">"login-failures";r=0;t=900</span>
          {'\n'}<span className="hk">ratelimit-policy:</span> <span className="hv">"login-failures";q=5;w=900</span>
          {'\n'}<span className="hk">retry-after:</span> <span className="hv">900</span>
          {'\n'}<span className="hk">content-type:</span> <span className="hv">application/problem+json</span>
          {'\n'}
        </div>

        <p className="foot">The cap and window shown here are illustrative (5 / 15s) so it's quick to demo; the service defaults are configurable per environment. → back to the <a href="playground.html">Playground</a>.</p>
      </div>
    </>
  );
}
