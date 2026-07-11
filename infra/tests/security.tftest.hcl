# ---------------------------------------------------------------------------
# Security-posture tests (native `tofu test`).
#
# Everything runs with `command = plan` against MOCK providers, so it needs
# ZERO AWS credentials and creates nothing — ideal for CI. mock_provider "aws"
# and mock_provider "random" satisfy every data source / computed attribute;
# the one data source that feeds a `slice()` (availability zones) is given an
# explicit mock value so the plan can compute subnet CIDRs.
#
# Run:  tofu -chdir=infra init -backend=false   # once, to install providers
#       tofu -chdir=infra test
# ---------------------------------------------------------------------------

mock_provider "aws" {
  # slice(data.aws_availability_zones.available.names, 0, 2) needs a real list.
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["ca-central-1a", "ca-central-1b", "ca-central-1d"]
    }
  }

  # aws_iam_policy_document is rendered provider-side; the mock must return
  # valid JSON or the IAM role/policy resources reject it during plan.
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }

  # Several resources validate ARN-shaped inputs at plan time (ALB listener,
  # ECS task definition, IAM), so the mocked ARNs need a valid shape.
  mock_resource "aws_lb" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:ca-central-1:123456789012:loadbalancer/app/mock-alb/0123456789abcdef"
    }
  }
  mock_resource "aws_lb_target_group" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:ca-central-1:123456789012:targetgroup/mock-tg/0123456789abcdef"
    }
  }
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/mock"
    }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = {
      arn = "arn:aws:secretsmanager:ca-central-1:123456789012:secret:mock-000000"
    }
  }
  mock_resource "aws_ssm_parameter" {
    defaults = {
      arn = "arn:aws:ssm:ca-central-1:123456789012:parameter/mock"
    }
  }
  mock_resource "aws_kms_key" {
    defaults = {
      arn = "arn:aws:kms:ca-central-1:123456789012:key/00000000-0000-0000-0000-000000000000"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:ca-central-1:123456789012:log-group:mock"
    }
  }
  mock_resource "aws_wafv2_web_acl" {
    defaults = {
      arn = "arn:aws:wafv2:ca-central-1:123456789012:regional/webacl/mock/00000000-0000-0000-0000-000000000000"
    }
  }
}

mock_provider "random" {
  # The mocked token must satisfy the ElastiCache AUTH charset/length rule.
  mock_resource "random_password" {
    defaults = {
      result = "abcdefghijklmnopqrstuvwxyz012345"
    }
  }
}

run "security_posture" {
  command = plan

  variables {
    environment        = "dev"
    log_retention_days = 7
  }

  # --- ECR: images are scanned and tags cannot be overwritten ---------------
  assert {
    condition     = aws_ecr_repository.app.image_scanning_configuration[0].scan_on_push == true
    error_message = "ECR must scan images on push (scan_on_push = true)."
  }

  assert {
    condition     = aws_ecr_repository.app.image_tag_mutability == "IMMUTABLE"
    error_message = "ECR tags must be IMMUTABLE so a tag can never point at different bytes."
  }

  # --- ECR: images encrypted with the customer-managed KMS key --------------
  assert {
    condition     = aws_ecr_repository.app.encryption_configuration[0].encryption_type == "KMS"
    error_message = "ECR must use KMS encryption with the project CMK (kms.tf)."
  }

  # --- VPC flow logs: present and capturing everything -----------------------
  assert {
    condition     = aws_flow_log.vpc.traffic_type == "ALL"
    error_message = "VPC flow logs must exist and capture ALL traffic (accepts and rejects)."
  }

  # --- ElastiCache: encrypted at rest and in transit ------------------------
  assert {
    condition     = tostring(aws_elasticache_replication_group.redis.at_rest_encryption_enabled) == "true"
    error_message = "ElastiCache must have at_rest_encryption_enabled = true."
  }

  assert {
    condition     = tostring(aws_elasticache_replication_group.redis.transit_encryption_enabled) == "true"
    error_message = "ElastiCache must have transit_encryption_enabled = true (rediss://)."
  }

  # --- Security groups: no path from the internet to app or cache -----------
  assert {
    condition     = aws_vpc_security_group_ingress_rule.redis_from_app.cidr_ipv4 == null
    error_message = "Redis SG must not admit any CIDR (incl. 0.0.0.0/0); ingress is SG-referenced only."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.redis_from_app.referenced_security_group_id == aws_security_group.app.id
    error_message = "Redis SG ingress must reference the app SG, not an IP range."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.app_from_alb.cidr_ipv4 == null
    error_message = "App SG must not admit any CIDR (incl. 0.0.0.0/0)."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.app_from_alb.referenced_security_group_id == aws_security_group.alb.id
    error_message = "App SG ingress must reference the ALB SG, not the world."
  }

  # --- CloudWatch: retention at least the environment's configured floor -----
  assert {
    condition     = aws_cloudwatch_log_group.app.retention_in_days >= 7
    error_message = "Log group retention must be >= the environment value (dev = 7 days)."
  }

  # --- Secret vs config split -----------------------------------------------
  # The REDIS_URL the container reads must come from Secrets Manager...
  assert {
    condition = one([
      for s in jsondecode(aws_ecs_task_definition.app.container_definitions)[0].secrets :
      s.valueFrom if s.name == "REDIS_URL"
    ]) == aws_secretsmanager_secret.redis_url.arn
    error_message = "REDIS_URL must be injected from Secrets Manager, not a plain env or SSM String."
  }

  # ...and non-secret config must be plain SSM String parameters (not SecureString).
  assert {
    condition = one([
      for s in jsondecode(aws_ecs_task_definition.app.container_definitions)[0].secrets :
      s.valueFrom if s.name == "LOG_LEVEL"
    ]) == aws_ssm_parameter.log_level.arn
    error_message = "LOG_LEVEL config must be injected from SSM Parameter Store."
  }

  assert {
    condition     = aws_ssm_parameter.log_level.type == "String" && aws_ssm_parameter.redis_host.type == "String"
    error_message = "Non-secret config must be plain String parameters, never SecureString or secrets."
  }

  # No secret material may appear in outputs (outputs land in state / `tofu
  # output`). We expose only the secret's ARN, never the rediss:// URL.
  assert {
    condition     = !strcontains(output.redis_url_secret_arn, "rediss://")
    error_message = "Outputs must expose the secret ARN, never the rediss:// URL or the AUTH token."
  }

  # --- ECS task hardening ---------------------------------------------------
  assert {
    condition     = jsondecode(aws_ecs_task_definition.app.container_definitions)[0].readonlyRootFilesystem == true
    error_message = "ECS task must set readonlyRootFilesystem = true."
  }
}
