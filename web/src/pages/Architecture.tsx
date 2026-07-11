// Faithful React conversion of pages/index.html (the Architecture landing
// page). Markup structure, class names and text content are copied verbatim
// so the extracted CSS applies unchanged. Do not redesign.
import Nav from '../components/Nav';
import '../styles/architecture.css';

const ink = { color: 'var(--ink)' } as const;

export default function Architecture() {
  return (
    <div className="wrap">
      <Nav current="architecture" />
      <p className="eyebrow">Infrastructure validation · OpenTofu · applied on LocalStack (emulated AWS)</p>
      <h1>The auth API's cloud stack, provisioned and checked end to end</h1>
      <p className="lede">
        The Terraform for this service isn't just linted — it's{' '}
        <b style={ink}>
          applied on <a href="https://localstack.cloud">LocalStack</a>
        </b>
        , a local emulator that speaks the real AWS APIs. One <span className="mono">apply</span> brings up the entire
        resource graph: network, security, compute, data, identity, secrets, autoscaling, DNS, and the API gateway.
        Zero AWS spend, no live account — and the same apply runs in{' '}
        <a href="https://github.com/ArashM0z/auth-api/actions/workflows/localstack.yml">GitHub Actions</a>.
      </p>

      <div className="metrics">
        <div className="metric">
          <div className="n ok">56</div>
          <div className="l">resources provisioned</div>
        </div>
        <div className="metric">
          <div className="n accent">8</div>
          <div className="l">infra layers up</div>
        </div>
        <div className="metric">
          <div className="n">$0.00</div>
          <div className="l">cost to validate</div>
        </div>
        <div className="metric">
          <div className="n ok">0</div>
          <div className="l">apply errors</div>
        </div>
      </div>

      <section>
        <h2>Deployed architecture</h2>
        <div className="diagram">
          <div className="flow">
            <div className="tier">
              <div className="tier-label">DNS</div>
              <div className="node edge">
                <div className="t">Route 53</div>
                <div className="s">health-check failover</div>
              </div>
            </div>
            <div className="arrow">→</div>
            <div className="tier">
              <div className="tier-label">Edge</div>
              <div className="node edge">
                <div className="t">WAF + ALB</div>
                <div className="s">:443 · /readyz</div>
              </div>
            </div>
            <div className="arrow">→</div>
            <div className="tier">
              <div className="tier-label">Compute · autoscaled</div>
              <div className="node stack">
                <div className="t">ECS Fargate</div>
                <div className="s">task · :3000</div>
              </div>
            </div>
            <div className="arrow">→</div>
            <div className="tier">
              <div className="tier-label">Data · private</div>
              <div className="node">
                <div className="t">ElastiCache</div>
                <div className="s">Redis · TLS+AUTH</div>
              </div>
            </div>
          </div>
          <div className="side">
            <div className="chip-svc">
              <span className="dot"></span> API Gateway — throttle + keys (opt.)
            </div>
            <div className="chip-svc">
              <span className="dot"></span> CloudFront — edge cache (opt.)
            </div>
            <div className="chip-svc">
              <span className="dot"></span> ECR — scanned images
            </div>
            <div className="chip-svc">
              <span className="dot"></span> Secrets Manager — Redis creds
            </div>
            <div className="chip-svc">
              <span className="dot"></span> SSM — non-secret config
            </div>
            <div className="chip-svc">
              <span className="dot"></span> CloudWatch — logs + insights
            </div>
          </div>
          <p className="diag-note">
            <b style={ink}>Route 53</b> resolves the name (and does health-checked failover for multi-region); an
            optional <b style={ink}>API Gateway</b> HTTP API can front the ALB for throttling and per-consumer keys.
            Inside, traffic is admitted tier-to-tier by security-group reference only: edge →{' '}
            <span className="mono">alb</span> (:443) → <span className="mono">app</span> (:3000) →{' '}
            <span className="mono">redis</span> (:6379). The app tier is stateless; all state lives in Redis.
          </p>
        </div>
      </section>

      <section>
        <h2>The whole architecture — VPC layout</h2>
        <div className="diagram">
          <div className="region">
            <span className="region-tag">AWS · ca-central-1</span>
            <div className="edge-stack">
              <div className="aws-node edge">
                Route 53 · DNS<span className="sub">health-checked failover routing</span>
              </div>
              <div className="edge-conn acc"></div>
              <div className="aws-node edge">
                AWS WAF  +  API Gateway <span className="sub">optional · managed rules · throttling · per-consumer keys</span>
              </div>
              <div className="edge-conn"></div>
              <div className="aws-node">
                Internet Gateway<span className="sub">public ingress / egress</span>
              </div>
            </div>
            <div className="vpc">
              <span className="vpc-tag">VPC · 10.0.0.0/16</span>
              <div className="alb-row">
                <div className="aws-node edge">
                  Application Load Balancer<span className="sub">public · spans both AZs · health-checks /readyz</span>
                </div>
              </div>
              <div className="azs">
                <div className="az">
                  <span className="az-tag">AZ · ca-central-1a</span>
                  <div className="subnet pub">
                    <span className="subnet-tag">public subnet · 10.0.0.0/24</span>
                    <div className="aws-node">
                      ECS Fargate task<span className="sub">:3000 · sg&nbsp;app</span>
                    </div>
                  </div>
                  <div className="subnet priv">
                    <span className="subnet-tag">private subnet · 10.0.10.0/24</span>
                    <div className="aws-node">
                      ElastiCache · primary<span className="sub">Redis · read/write · TLS+AUTH</span>
                    </div>
                  </div>
                </div>
                <div className="az">
                  <span className="az-tag">AZ · ca-central-1b</span>
                  <div className="subnet pub">
                    <span className="subnet-tag">public subnet · 10.0.1.0/24</span>
                    <div className="aws-node">
                      ECS Fargate task<span className="sub">:3000 · sg&nbsp;app</span>
                    </div>
                  </div>
                  <div className="subnet priv">
                    <span className="subnet-tag">private subnet · 10.0.11.0/24</span>
                    <div className="aws-node">
                      ElastiCache · replica<span className="sub">read-only copy · promotes on failover</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="rail">
              <div className="aws-node">
                ECR<span className="sub">scanned images</span>
              </div>
              <div className="aws-node">
                Secrets Manager<span className="sub">redis creds</span>
              </div>
              <div className="aws-node">
                SSM<span className="sub">config</span>
              </div>
              <div className="aws-node">
                CloudWatch<span className="sub">logs + insights</span>
              </div>
              <div className="aws-node">
                IAM<span className="sub">task roles</span>
              </div>
            </div>
          </div>
          <p className="diag-note">
            Fargate runs in <b style={ink}>public</b> subnets, locked to the ALB's security group, to skip ~$65/mo
            of NAT gateway. Redis sits in <b style={ink}>private</b> subnets, reachable only from the app tier. The
            bottom rail is regional AWS services, reached over the AWS network with scoped IAM — the task execution
            role can read exactly its two secrets and four SSM params, nothing else.
          </p>
        </div>
      </section>

      <section>
        <h2>How a login request flows</h2>
        <div className="diagram">
          <div className="lifecycle">
            <div className="step">
              <div className="num">01 · edge</div>
              <div className="st">ALB → task</div>
              <div className="sd">
                Routed to a healthy Fargate task. <span className="mono">/readyz</span> gates on Redis, so a task that
                lost its cache is drained.
              </div>
            </div>
            <div className="step">
              <div className="num">02 · gate</div>
              <div className="st">Rate-limit check</div>
              <div className="sd">
                Atomic Redis <span className="mono">INCR</span> per username <em>before</em> any hashing — a concurrent
                burst can't slip past the cap.
              </div>
            </div>
            <div className="step">
              <div className="num">03 · verify</div>
              <div className="st">Argon2id</div>
              <div className="sd">
                Verify against the stored hash — or a dummy one for unknown users, at identical cost. No timing tell.
              </div>
            </div>
            <div className="step">
              <div className="num">04 · respond</div>
              <div className="st">Audit &amp; reply</div>
              <div className="sd">
                Structured audit event, then <span className="mono">200</span> or a byte-identical{' '}
                <span className="mono">401</span>. Never reveals which half failed.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2>How it ships — the delivery pipeline</h2>
        <div className="diagram">
          <div style={{ overflowX: 'auto' }}>
            <svg
              className="shipsvg"
              viewBox="0 0 700 478"
              role="img"
              aria-label="Delivery pipeline: push, CI checks, image build, LocalStack apply, assert, green"
            >
              <defs>
                <marker id="s-ink" markerWidth="7.5" markerHeight="7.5" refX="6" refY="3" orient="auto">
                  <path className="mk-ink" d="M0,0 L7,3 L0,6 Z"></path>
                </marker>
                <marker id="s-indigo" markerWidth="7.5" markerHeight="7.5" refX="6" refY="3" orient="auto">
                  <path className="mk-indigo" d="M0,0 L7,3 L0,6 Z"></path>
                </marker>
                <marker id="s-acc" markerWidth="7.5" markerHeight="7.5" refX="6" refY="3" orient="auto">
                  <path className="mk-acc" d="M0,0 L7,3 L0,6 Z"></path>
                </marker>
                <marker id="s-ok" markerWidth="7.5" markerHeight="7.5" refX="6" refY="3" orient="auto">
                  <path className="mk-ok" d="M0,0 L7,3 L0,6 Z"></path>
                </marker>
              </defs>
              <rect className="frame" x="6" y="6" width="688" height="466" rx="13"></rect>
              <rect className="act" x="355" y="103" width="10" height="326" rx="3"></rect>
              <rect className="act ls" x="600" y="279" width="10" height="62" rx="3"></rect>
              <line className="life" x1="115" y1="74" x2="115" y2="464"></line>
              <line className="life" x1="360" y1="74" x2="360" y2="464"></line>
              <line className="life" x1="605" y1="74" x2="605" y2="464"></line>
              <rect className="box" x="55" y="18" width="120" height="48" rx="10"></rect>
              <line className="top dev" x1="71" y1="18" x2="159" y2="18"></line>
              <text className="nm" x="115" y="40" textAnchor="middle">
                Developer
              </text>
              <text className="sub" x="115" y="54" textAnchor="middle">
                git · pull request
              </text>
              <rect className="box" x="300" y="18" width="120" height="48" rx="10"></rect>
              <line className="top gh" x1="316" y1="18" x2="404" y2="18"></line>
              <text className="nm" x="360" y="40" textAnchor="middle">
                GitHub Actions
              </text>
              <text className="sub" x="360" y="54" textAnchor="middle">
                CI runner
              </text>
              <rect className="box" x="545" y="18" width="120" height="48" rx="10"></rect>
              <line className="top ls" x1="561" y1="18" x2="649" y2="18"></line>
              <text className="nm" x="605" y="40" textAnchor="middle">
                LocalStack
              </text>
              <text className="sub" x="605" y="54" textAnchor="middle">
                emulated AWS
              </text>
              <g className="pa" style={{ animationDelay: '0s' }}>
                <text className="num" x="26" y="115" textAnchor="middle">
                  1
                </text>
                <line className="ln ink" x1="115" y1="112" x2="355" y2="112" markerEnd="url(#s-ink)"></line>
                <text className="lab ink" x="235" y="105" textAnchor="middle">
                  git push · open PR
                </text>
              </g>
              <g className="pa" style={{ animationDelay: '.75s' }}>
                <text className="num" x="26" y="159" textAnchor="middle">
                  2
                </text>
                <path className="ln indigo" d="M365,151 h34 v11 h-30" markerEnd="url(#s-indigo)"></path>
                <text className="lab indigo" x="411" y="159" textAnchor="start">
                  lint · typecheck · API contract
                </text>
              </g>
              <g className="pa" style={{ animationDelay: '1.5s' }}>
                <text className="num" x="26" y="203" textAnchor="middle">
                  3
                </text>
                <path className="ln indigo" d="M365,195 h34 v11 h-30" markerEnd="url(#s-indigo)"></path>
                <text className="lab indigo" x="411" y="203" textAnchor="start">
                  79 tests vs real Redis · mutation · CodeQL
                </text>
              </g>
              <g className="pa" style={{ animationDelay: '2.25s' }}>
                <text className="num" x="26" y="247" textAnchor="middle">
                  4
                </text>
                <path className="ln indigo" d="M365,239 h34 v11 h-30" markerEnd="url(#s-indigo)"></path>
                <text className="lab indigo" x="411" y="247" textAnchor="start">
                  docker build · runs as non-root
                </text>
              </g>
              <g className="pa" style={{ animationDelay: '3s' }}>
                <text className="num" x="26" y="291" textAnchor="middle">
                  5
                </text>
                <line className="ln acc" x1="365" y1="288" x2="600" y2="288" markerEnd="url(#s-acc)"></line>
                <text className="lab acc" x="482" y="281" textAnchor="middle">
                  tflocal apply → boot AWS
                </text>
              </g>
              <g className="pa" style={{ animationDelay: '3.75s' }}>
                <text className="num" x="26" y="335" textAnchor="middle">
                  6
                </text>
                <line className="ln acc" x1="600" y1="332" x2="365" y2="332" markerEnd="url(#s-acc)"></line>
                <text className="lab acc" x="482" y="325" textAnchor="middle">
                  56 resources up · 0 errors
                </text>
              </g>
              <g className="pa" style={{ animationDelay: '4.5s' }}>
                <text className="num" x="26" y="379" textAnchor="middle">
                  7
                </text>
                <path className="ln indigo" d="M365,371 h34 v11 h-30" markerEnd="url(#s-indigo)"></path>
                <text className="lab indigo" x="411" y="379" textAnchor="start">
                  assert VPC · ECS · Redis · Route 53 · API GW
                </text>
              </g>
              <g className="pa" style={{ animationDelay: '5.25s' }}>
                <text className="num" x="26" y="423" textAnchor="middle">
                  8
                </text>
                <line className="ln ok" x1="355" y1="420" x2="115" y2="420" markerEnd="url(#s-ok)"></line>
                <text className="lab ok" x="235" y="413" textAnchor="middle">
                  ✓ all checks green
                </text>
              </g>
            </svg>
          </div>
          <p className="diag-note">
            The checks gate every pull request; the{' '}
            <a href="https://github.com/ArashM0z/auth-api/actions/workflows/localstack.yml">LocalStack apply</a> boots
            the emulated AWS inside the runner and asserts all <b style={ink}>56 resources</b> — the same{' '}
            <span className="mono">tflocal apply</span> shown below, replayed on demand in CI. No AWS account, no cost.
          </p>
        </div>
      </section>

      <section>
        <h2>What came up in the apply</h2>

        <div className="layer">
          <div className="layer-head">
            <span className="name">Network</span>
            <span className="count">12 · all up</span>
          </div>
          <div className="res">
            <span className="r">aws_vpc.main</span>
            <span className="r">subnet.public[0]</span>
            <span className="r">subnet.public[1]</span>
            <span className="r">subnet.private[0]</span>
            <span className="r">subnet.private[1]</span>
            <span className="r">internet_gateway.main</span>
            <span className="r">route_table.public</span>
            <span className="r">route_table.private</span>
            <span className="r">route.public_internet</span>
            <span className="r">rt_assoc ×4</span>
          </div>
        </div>

        <div className="layer">
          <div className="layer-head">
            <span className="name">Security groups</span>
            <span className="count">9 · all up</span>
          </div>
          <div className="res">
            <span className="r">sg.alb</span>
            <span className="r">sg.app</span>
            <span className="r">sg.redis</span>
            <span className="r">default_sg (locked)</span>
            <span className="r">ingress.alb_http</span>
            <span className="r">ingress.app_from_alb</span>
            <span className="r">ingress.redis_from_app</span>
            <span className="r">egress.alb_to_app</span>
            <span className="r">egress.app_all</span>
          </div>
        </div>

        <div className="layer">
          <div className="layer-head">
            <span className="name">Compute &amp; load balancing</span>
            <span className="count">6 · all up</span>
          </div>
          <div className="res">
            <span className="r">ecs_cluster.main</span>
            <span className="r">ecs_task_definition.app</span>
            <span className="r">ecs_service.app</span>
            <span className="r">lb.app</span>
            <span className="r">lb_listener.http</span>
            <span className="r">lb_target_group.app</span>
          </div>
        </div>

        <div className="layer">
          <div className="layer-head">
            <span className="name">Data · Redis</span>
            <span className="count">2 · all up</span>
          </div>
          <div className="res">
            <span className="r">elasticache_replication_group.redis</span>
            <span className="r">elasticache_subnet_group.redis</span>
          </div>
        </div>

        <div className="layer">
          <div className="layer-head">
            <span className="name">Identity, secrets &amp; config</span>
            <span className="count">12 · all up</span>
          </div>
          <div className="res">
            <span className="r">iam_role.task</span>
            <span className="r">iam_role.task_execution</span>
            <span className="r">iam_role_policy.exec_secrets</span>
            <span className="r">secret.redis_auth_token</span>
            <span className="r">secret.redis_url</span>
            <span className="r">secret_version ×2</span>
            <span className="r">random_password.redis_auth</span>
            <span className="r">ssm.log_level</span>
            <span className="r">ssm.trust_proxy</span>
            <span className="r">ssm.password_min_length</span>
            <span className="r">ssm.redis_port</span>
          </div>
        </div>

        <div className="layer">
          <div className="layer-head">
            <span className="name">Registry &amp; observability</span>
            <span className="count">3 · all up</span>
          </div>
          <div className="res">
            <span className="r">ecr_repository.app</span>
            <span className="r">ecr_lifecycle_policy.app</span>
            <span className="r">cloudwatch_log_group.app</span>
          </div>
        </div>

        <div className="layer">
          <div className="layer-head">
            <span className="name">Autoscaling</span>
            <span className="count">2 · up</span>
          </div>
          <div className="res">
            <span className="r">appautoscaling_target.ecs</span>
            <span className="r">appautoscaling_policy.cpu</span>
          </div>
        </div>

        <div className="layer">
          <div className="layer-head">
            <span className="name">Edge · DNS &amp; API Gateway</span>
            <span className="count">7 · all up</span>
          </div>
          <div className="res">
            <span className="r">route53_zone.internal</span>
            <span className="r">route53_record.api</span>
            <span className="r">apigatewayv2_api.http</span>
            <span className="r">apigatewayv2_vpc_link.alb</span>
            <span className="r">apigatewayv2_integration.alb</span>
            <span className="r">apigatewayv2_route.proxy</span>
            <span className="r">apigatewayv2_stage.default</span>
          </div>
        </div>

        <div
          className="callout"
          style={{ marginTop: '14px', borderLeftColor: 'var(--accent)', background: 'var(--accent-bg)' }}
        >
          <b style={{ color: 'var(--accent)' }}>Applied, not just linted.</b> LocalStack (Pro trial) applies the full{' '}
          <b style={ink}>
            56 resources — VPC, ECS, ElastiCache, ALB, Route&nbsp;53, and API&nbsp;Gateway included — with zero errors
          </b>
          , locally and again in{' '}
          <a href="https://github.com/ArashM0z/auth-api/actions/workflows/localstack.yml">GitHub Actions</a>. The free{' '}
          <span className="mono">Moto</span> mock is a lighter fallback (it skips Application Auto Scaling). Either way
          it's $0 and no live AWS account; and the committed <span className="mono">tofu&nbsp;test</span> +{' '}
          <span className="mono">tflint</span> + <span className="mono">checkov</span> gate every resource regardless.
        </div>
      </section>

      <section>
        <h2>How it scales</h2>
        <div className="grid2">
          <div className="card">
            <h3>Design for horizontal scale</h3>
            <ul>
              <li>
                <b>Stateless app tier.</b> Users and rate-limit windows live in Redis, so Fargate tasks hold no session
                state — add tasks, no coordination.
              </li>
              <li>
                <b>Autoscaling on CPU.</b> Target-tracking at 60% CPU, min 1 (dev) → up to 20 tasks (prod), behind the
                ALB.
              </li>
              <li>
                <b>Limits that survive scale-out.</b> Rate limiting is Redis-backed, so the cap holds across every
                replica — an in-memory limiter would multiply by task count.
              </li>
              <li>
                <b>Fails predictably.</b> Load shedding (503 + Retry-After) and readiness draining keep a saturated
                instance from taking traffic.
              </li>
            </ul>
          </div>
          <div className="card">
            <h3>Measured capacity budget</h3>
            <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--muted)' }}>
              The login ceiling is the security cost working — Argon2id is deliberately expensive. From the benchmark:
            </p>
            <div className="math">
              <div className="row">
                <span>Argon2id verify</span>
                <b>~37 ms</b>
              </div>
              <div className="row">
                <span>hash concurrency / task</span>
                <b>8</b>
              </div>
              <div className="row">
                <span>logins/sec / task</span>
                <b>≈ 216</b>
              </div>
              <div className="row">
                <span>measured</span>
                <b>208</b>
              </div>
              <div className="row tot">
                <span>10 tasks →</span>
                <b>~2,000 logins/sec</b>
              </div>
            </div>
            <p style={{ margin: '12px 0 0', fontSize: '12.5px', color: 'var(--faint)' }}>
              Health checks hit ~25,000 req/s/task — the framework isn't the bottleneck, the hash is, by design.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2>Production hardening &amp; scale-out</h2>
        <div className="grid2">
          <div className="card">
            <h3>Security — past the demo</h3>
            <ul>
              <li>
                <b>Private subnets + VPC endpoints.</b> The demo puts Fargate in <em>public</em> subnets (locked to the
                ALB's SG, no inbound from the internet) only to skip ~$65/mo of NAT. Production moves tasks to{' '}
                <b>private</b> subnets and reaches ECR / S3 / Secrets / CloudWatch over VPC endpoints — no public IPs at
                all.
              </li>
              <li>
                <b>AWS WAF</b> on the edge: managed OWASP / bad-bot / IP-reputation rules and a coarse rate rule, in
                front of the app's own per-account limiter.
              </li>
              <li>
                <b>API Gateway (HTTP API)</b> as the front door: throttling, usage plans, per-consumer keys, one audited
                entry point — VPC Link → ALB.
              </li>
              <li>
                <b>Security logging.</b> CloudTrail (API audit), GuardDuty (threat detection), VPC Flow Logs, plus the
                app's structured audit trail shipped to a SIEM.
              </li>
            </ul>
          </div>
          <div className="card">
            <h3>Scale — where the headroom is</h3>
            <ul>
              <li>
                <b>Redis: primary + replicas.</b> ElastiCache runs a read/write <em>primary</em> with <em>replicas</em>{' '}
                in other AZs that promote on failover; read replicas absorb read load, Cluster Mode shards past one
                node.
              </li>
              <li>
                <b>Caching.</b> CloudFront in front of the ALB for cacheable reads; a read-through cache layer for hot
                lookups. The auth paths stay uncached by design (write-heavy, security-sensitive).
              </li>
              <li>
                <b>Stateless tasks + CPU autoscaling</b> behind the ALB — the app tier grows horizontally with zero
                coordination.
              </li>
              <li>
                <b>Multi-region</b> active-passive: Route 53 health-check failover + ElastiCache Global Datastore when
                one region's availability isn't enough.
              </li>
            </ul>
          </div>
        </div>
        <p className="diag-note">
          All of this is deliberately out of scope for a two-endpoint take-home —{' '}
          <b style={ink}>written down, not silently skipped</b>. The point is knowing the next three moves, not building
          them prematurely.
        </p>
      </section>

      <section>
        <h2>Method &amp; what's next</h2>
        <div className="split">
          <div>
            <div className="card">
              <h3>Simulated on LocalStack</h3>
              <p className="rm" style={{ margin: 0 }}>
                <a href="https://localstack.cloud">LocalStack</a> is a local emulator that speaks the real AWS APIs from
                one Docker container. <span className="mono">tflocal</span> — a thin OpenTofu wrapper — points every
                provider call at it, so <span className="mono">apply</span> genuinely creates the stack (VPC, ECS,
                ElastiCache, Route&nbsp;53, API&nbsp;Gateway) in real dependency order, into real state. I use it to{' '}
                <b style={ink}>simulate the whole AWS deploy</b> at $0, with no account:
              </p>
              <div className="cmd">
                <span className="c"># a local AWS in one container, then apply for real</span>
                {'\n'}localstack start -d{'\n'}
                <span className="g">tflocal apply</span> -var-file=environments/dev.tfvars{'\n'}
                <span className="c"># → Apply complete! Resources: 56 added, 0 changed, 0 destroyed.</span>
              </div>
              <p className="rm" style={{ margin: '10px 0 0', fontSize: '13px' }}>
                It also runs in{' '}
                <a href="https://github.com/ArashM0z/auth-api/actions/workflows/localstack.yml">GitHub Actions</a>:
                LocalStack boots in the runner, the stack applies, and the key resources are asserted live. The same
                config also passes <span className="mono">tofu&nbsp;test</span> (plan-time security assertions),{' '}
                <span className="mono">tflint</span>, and <span className="mono">checkov</span>.
              </p>
            </div>
          </div>
          <div>
            <div className="card">
              <h3>Delivery pipeline &amp; roadmap</h3>
              <div className="rm">
                <div className="item">
                  <span className="k">GitHub Actions CI</span>
                  <span className="tag done">live</span>
                  <br />
                  lint · type · 79 tests vs real Redis · mutation testing · audit · CodeQL · image build
                </div>
                <div className="item">
                  <span className="k">AWS CodePipeline → CodeBuild</span>
                  <span className="tag next">designed</span>
                  <br />
                  native path: source → build/test in CodeBuild → push ECR → rolling ECS deploy
                </div>
                <div className="item">
                  <span className="k">API Gateway (HTTP API) fronting the ALB</span>
                  <span className="tag next">optional</span>
                  <br />
                  adds throttling, WAF, usage plans, and per-consumer keys for an internal service mesh
                </div>
                <div className="item">
                  <span className="k">ECS Fargate — deliberate, not default</span>
                  <span className="tag done">built</span>
                  <br />
                  chosen for full control of the VPC, subnets, security-group chain, and Redis placement — the parts
                  worth showing in an infra review. It's a plain Docker image with a health check, so the target
                  is portable: EKS if Kubernetes is the org standard, App Runner or a PaaS (Fly / Render) if the goal is
                  minimal ops over infra control, or beside Amplify when there's a full-stack front-end
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <span className="mono">ArashM0z/auth-api</span>
        <span>·</span>
        <span>OpenTofu 1.12 · aws provider v6</span>
        <span>·</span>
        <span>
          region <span className="mono">ca-central-1</span>
        </span>
        <span>·</span>
        <span>applied on LocalStack (emulated AWS) · local + CI · no live account</span>
      </footer>
    </div>
  );
}
