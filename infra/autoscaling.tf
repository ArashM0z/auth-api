# ---------------------------------------------------------------------------
# Service auto scaling: target-tracking on average CPU. Argon2id hashing is
# the API's only CPU-heavy work, so CPU is an honest proxy for login/register
# load. Target tracking is preferred over step scaling here because it is
# self-tuning — one number to reason about instead of alarm arithmetic.
# ---------------------------------------------------------------------------

resource "aws_appautoscaling_target" "ecs" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.autoscaling_min_capacity
  max_capacity       = var.autoscaling_max_capacity
}

resource "aws_appautoscaling_policy" "ecs_cpu" {
  name               = "${local.name_prefix}-cpu-target-tracking"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    # 60% leaves headroom to absorb a login burst (each Argon2id hash pins a
    # core for ~100ms) while new tasks start — Fargate cold start plus the
    # 30s health-check grace is a couple of minutes of lag to cover.
    target_value = var.autoscaling_cpu_target

    # Scale out fast, scale in slow: over-provisioning briefly costs cents,
    # flapping under sustained load costs availability.
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
  }
}
