# ---------------------------------------------------------------------------
# Application Load Balancer (~USD 22/mo + LCU) — the only piece of this
# stack that is supposed to be reachable from the internet.
# ---------------------------------------------------------------------------

resource "aws_lb" "app" {
  #checkov:skip=CKV_AWS_91:Access logs need an S3 bucket + policy that would outlive the demo's usefulness; production enables them for traffic forensics.
  #checkov:skip=CKV2_AWS_20:Redirect-to-HTTPS requires the :443 listener this demo omits (no domain, so no ACM certificate can be issued).
  #checkov:skip=CKV_AWS_150:Deletion protection would block the demo's `tofu destroy`; enable in production.
  #checkov:skip=CKV2_AWS_28:WAF (~USD 5/mo + per-request) is production hardening; the app also rate-limits per-IP in Redis at the application layer.
  name               = "${local.name_prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  # Free hardening: reject requests with malformed/smuggled headers at the
  # edge before they reach the app.
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "app" {
  #checkov:skip=CKV_AWS_378:ALB-to-task traffic is plain HTTP inside the VPC, restricted by security groups; production terminates TLS at the ALB (and could re-encrypt to targets if required).
  name        = "${local.name_prefix}-tg"
  vpc_id      = aws_vpc.main.id
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip" # awsvpc/Fargate tasks register by ENI IP, not instance ID

  # /readyz (not /healthz) on purpose: readiness includes the Redis
  # dependency, so if a task loses Redis the ALB drains it and routes to
  # tasks that can actually serve, while ECS leaves the (live) process
  # running to reconnect.
  health_check {
    path                = "/readyz"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # The API's requests are short-lived; 30s (down from 300s default) makes
  # deploys and scale-in brisk without cutting off in-flight work.
  deregistration_delay = 30
}

# Plain HTTP for the demo — there is no domain to issue a certificate for.
# Production: an aws_acm_certificate + :443 HTTPS listener (TLS 1.2+ policy),
# and this :80 listener becomes a fixed 301 redirect to HTTPS.
resource "aws_lb_listener" "http" {
  #checkov:skip=CKV_AWS_2:No domain/ACM cert exists for this demo; production terminates TLS at :443.
  #checkov:skip=CKV_AWS_103:TLS policy applies to HTTPS listeners; this HTTP listener exists only because the demo has no certificate.
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
