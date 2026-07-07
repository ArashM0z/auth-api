# ---------------------------------------------------------------------------
# ECS on Fargate: no instances to patch, per-second billing, and the
# scale-to-two-tasks floor costs ~USD 25/mo (2 x 0.25 vCPU / 0.5 GB in
# ca-central-1). Container Insights adds detailed task/service metrics for
# a few dollars a month — worth it even in a demo to show operability.
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = var.project_name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  #checkov:skip=CKV_AWS_158:Default SSE is adequate for demo app logs; a KMS CMK adds key cost and IAM complexity without a confidentiality requirement here.
  #checkov:skip=CKV_AWS_338:30-day retention is a deliberate cost/compliance trade-off for a demo (var.log_retention_days); regulated workloads would set 365+.
  name              = "/ecs/${var.project_name}"
  retention_in_days = var.log_retention_days
}

# --- IAM: two roles, deliberately distinct -----------------------------------
# Execution role = what the ECS *agent* needs to start the task (pull image,
# write logs, fetch secrets). Task role = what the *application* can do with
# AWS APIs — nothing, because the app only talks to Redis. Keeping them
# separate means a compromised app process holds no useful AWS credentials.

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "${var.project_name}-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Scoped to the single parameter the task consumes — not ssm:* or a path
# wildcard. Decryption uses the AWS-managed aws/ssm key, whose key policy
# already permits use via SSM, so no explicit kms:Decrypt grant is needed.
data "aws_iam_policy_document" "read_redis_url" {
  statement {
    sid       = "ReadRedisUrlParameter"
    actions   = ["ssm:GetParameters"]
    resources = [aws_ssm_parameter.redis_url.arn]
  }
}

resource "aws_iam_role_policy" "task_execution_read_redis_url" {
  name   = "read-redis-url-parameter"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.read_redis_url.json
}

# No policies attached: the application requires zero AWS API access.
resource "aws_iam_role" "task" {
  name               = "${var.project_name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# --- Task definition ----------------------------------------------------------

resource "aws_ecs_task_definition" "app" {
  family                   = var.project_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.container_cpu
  memory                   = var.container_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    # X86_64 keeps the demo build pipeline trivial (no cross-compilation /
    # multi-arch manifest concerns). Switching to ARM64 (Graviton) is a ~20%
    # Fargate price cut and is worth it once CI builds multi-arch images.
    cpu_architecture = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = var.project_name
      image     = "${aws_ecr_repository.app.repository_url}:${var.app_image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 3000
          protocol      = "tcp"
        }
      ]

      environment = [
        # Bind beyond loopback so the ALB can reach the container.
        { name = "HOST", value = "0.0.0.0" },
        { name = "PORT", value = "3000" },
        # Behind the ALB, client IPs arrive in X-Forwarded-For; the app's
        # per-IP rate limiting is meaningless without this.
        { name = "TRUST_PROXY", value = "true" },
        { name = "PASSWORD_MIN_LENGTH", value = tostring(var.password_min_length) }
      ]

      # Injected by the ECS agent at task start via the execution role —
      # the credential never appears in the task definition, console, or
      # `describe-task-definition` output.
      secrets = [
        {
          name      = "REDIS_URL"
          valueFrom = aws_ssm_parameter.redis_url.arn
        }
      ]

      # Container images should stay immutable and minimal, so no curl/wget:
      # the runtime itself (node's global fetch) probes liveness. /healthz is
      # process-liveness only — Redis health is the load balancer's concern
      # (/readyz, see alb.tf) so a Redis blip doesn't make ECS kill healthy
      # processes.
      healthCheck = {
        command     = ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
        interval    = 15
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }

      # The app writes only to stdout/stderr, so lock the filesystem: a
      # remote-code-execution foothold cannot persist or stage tooling.
      readonlyRootFilesystem = true

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "app"
        }
      }
    }
  ])
}

# --- Service ------------------------------------------------------------------

resource "aws_ecs_service" "app" {
  #checkov:skip=CKV_AWS_333:Public IPs are required for image pull/logs/SSM egress because the demo runs tasks in public subnets instead of paying ~USD 65+/mo for NAT (see network.tf); ingress is still ALB-only via security groups.
  name            = var.project_name
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = var.project_name
    container_port   = 3000
  }

  # A bad deploy (crash-looping image, failing health checks) halts and
  # rolls back automatically instead of flapping forever and paging a human.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Give new tasks time to open Redis connections before /readyz results
  # count against them.
  health_check_grace_period_seconds = 30

  # Auto scaling (autoscaling.tf) owns the live count after creation;
  # without this, every plan would try to reset it to desired_count.
  lifecycle {
    ignore_changes = [desired_count]
  }

  # Ensure the listener exists before ECS tries to register targets.
  depends_on = [aws_lb_listener.http]
}
