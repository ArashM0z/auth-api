# ---------------------------------------------------------------------------
# Application Load Balancer (~USD 22/mo + LCU) — the only piece of this
# stack that is supposed to be reachable from the internet.
# ---------------------------------------------------------------------------

resource "aws_lb" "app" {
  #checkov:skip=CKV2_AWS_20:Redirect-to-HTTPS requires the :443 listener this demo omits (no domain, so no ACM certificate can be issued).
  #checkov:skip=CKV2_AWS_76:The attached WAF carries Common + KnownBadInputs (which covers the Log4j/JNDI probes); the also-required AnonymousIpList would block legitimate VPN users of an auth API — a product decision, not a gap.
  name               = "${local.name_prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  # Free hardening: reject requests with malformed/smuggled headers at the
  # edge before they reach the app.
  drop_invalid_header_fields = true

  # On by default; only dev opts out (environments/dev.tfvars) so its
  # `tofu destroy` stays one command.
  enable_deletion_protection = var.alb_deletion_protection

  # Access logs to the private, SSE-S3 bucket in logging.tf — per-request
  # forensics (client IP, target, latency, status) independent of the app.
  access_logs {
    bucket  = aws_s3_bucket.alb_logs.id
    enabled = true
  }

  # ALB validates it can write to the bucket when logging is enabled, so the
  # bucket policy must exist first.
  depends_on = [aws_s3_bucket_policy.alb_logs]
}

# --- WAF ----------------------------------------------------------------------
# AWS-managed Common Rule Set (generic exploit patterns: SQLi in headers,
# oversized bodies, known-bad paths) in front of the ALB. The app still
# rate-limits per-IP in Redis at the application layer; WAF is the layer that
# sheds obviously-hostile traffic before it costs app CPU.

resource "aws_wafv2_web_acl" "alb" {
  name        = "${local.name_prefix}-waf"
  description = "Managed common rule set in front of the ${local.name_prefix} ALB"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "aws-managed-common"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-waf-common"
      sampled_requests_enabled   = true
    }
  }

  # Known-bad request payloads, including the Log4j/log4shell JNDI lookups
  # (CVE-2021-44228). The app is Node.js, but blocking the probes at the edge
  # is free and keeps them out of the logs.
  rule {
    name     = "aws-managed-known-bad-inputs"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-waf-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name_prefix}-waf"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.app.arn
  web_acl_arn  = aws_wafv2_web_acl.alb.arn
}

# WAF logs (matched-rule detail per request) to CloudWatch. The group name
# MUST start with aws-waf-logs- — a WAF service requirement.
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${local.name_prefix}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.main.arn
}

resource "aws_wafv2_web_acl_logging_configuration" "alb" {
  resource_arn            = aws_wafv2_web_acl.alb.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
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
