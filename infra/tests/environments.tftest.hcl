# ---------------------------------------------------------------------------
# Multi-environment tests (native `tofu test`, mock providers, plan only).
#
# Verifies two things per environment:
#   1. Every resource is name-prefixed "<project>-<environment>" so dev,
#      staging and prod never collide in a shared account.
#   2. The per-env sizing wired through the tfvars (task count, cache node
#      type, log retention) lands on the right resources.
# The `variables` blocks mirror environments/*.tfvars (tofu test does not
# auto-load var files).
# ---------------------------------------------------------------------------

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["ca-central-1a", "ca-central-1b", "ca-central-1d"]
    }
  }

  # Valid JSON so IAM role/policy resources accept the mocked policy document.
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }

  # Valid ARN shapes for the plan-time ARN validations.
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
}

mock_provider "random" {
  mock_resource "random_password" {
    defaults = {
      result = "abcdefghijklmnopqrstuvwxyz012345"
    }
  }
}

run "dev_naming_and_sizing" {
  command = plan

  variables {
    environment              = "dev"
    desired_count            = 1
    autoscaling_min_capacity = 1
    autoscaling_max_capacity = 3
    redis_node_type          = "cache.t4g.micro"
    log_retention_days       = 7
    log_level                = "debug"
  }

  assert {
    condition     = aws_ecs_cluster.main.name == "auth-api-dev"
    error_message = "ECS cluster must be prefixed with the environment (auth-api-dev)."
  }

  assert {
    condition     = aws_cloudwatch_log_group.app.name == "/ecs/auth-api-dev"
    error_message = "Log group must be env-scoped (/ecs/auth-api-dev)."
  }

  assert {
    condition     = startswith(aws_secretsmanager_secret.redis_url.name, "/auth-api/dev/")
    error_message = "Secrets must be namespaced under /auth-api/dev/."
  }

  assert {
    condition     = aws_ssm_parameter.log_level.name == "/auth-api/dev/config/LOG_LEVEL"
    error_message = "Config parameters must be namespaced under /auth-api/dev/config/."
  }

  assert {
    condition     = aws_ecs_service.app.desired_count == 1
    error_message = "dev desired_count must be 1."
  }

  assert {
    condition     = aws_elasticache_replication_group.redis.node_type == "cache.t4g.micro"
    error_message = "dev cache node must be cache.t4g.micro."
  }

  assert {
    condition     = aws_cloudwatch_log_group.app.retention_in_days == 7
    error_message = "dev log retention must be 7 days."
  }
}

run "staging_naming_and_sizing" {
  command = plan

  variables {
    environment              = "staging"
    desired_count            = 2
    autoscaling_min_capacity = 2
    autoscaling_max_capacity = 6
    redis_node_type          = "cache.t4g.small"
    log_retention_days       = 14
    log_level                = "info"
  }

  assert {
    condition     = aws_ecs_cluster.main.name == "auth-api-staging"
    error_message = "ECS cluster must be prefixed with the environment (auth-api-staging)."
  }

  assert {
    condition     = aws_ecs_service.app.desired_count == 2
    error_message = "staging desired_count must be 2."
  }

  assert {
    condition     = aws_cloudwatch_log_group.app.retention_in_days == 14
    error_message = "staging log retention must be 14 days."
  }
}

run "prod_naming_and_sizing" {
  command = plan

  variables {
    environment              = "prod"
    desired_count            = 3
    autoscaling_min_capacity = 3
    autoscaling_max_capacity = 20
    redis_node_type          = "cache.t4g.small"
    log_retention_days       = 30
    log_level                = "info"
  }

  assert {
    condition     = aws_ecs_cluster.main.name == "auth-api-prod"
    error_message = "ECS cluster must be prefixed with the environment (auth-api-prod)."
  }

  assert {
    condition     = aws_ecs_service.app.desired_count == 3
    error_message = "prod desired_count must be 3."
  }

  assert {
    condition     = aws_appautoscaling_target.ecs.max_capacity == 20
    error_message = "prod autoscaling max_capacity must be 20."
  }

  assert {
    condition     = aws_cloudwatch_log_group.app.retention_in_days == 30
    error_message = "prod log retention must be 30 days."
  }
}

# Guardrail: an invalid environment must be rejected by variable validation.
run "rejects_invalid_environment" {
  command = plan

  variables {
    environment = "qa"
  }

  expect_failures = [var.environment]
}
