# ---------------------------------------------------------------------------
# Shared naming. Every resource, and the ECS cluster, is prefixed with
# "<project>-<environment>" so dev / staging / prod can coexist in the same
# AWS account without name collisions (SG names, ALB/TG names, cluster name,
# IAM role names, log groups, secret/parameter paths are all region- or
# account-unique). Ideally each environment is a SEPARATE AWS account under
# AWS Organizations (see the backend note in versions.tf) — the prefix is the
# defence-in-depth fallback when they share one.
# ---------------------------------------------------------------------------
locals {
  name_prefix = "${var.project_name}-${var.environment}"

  # Root of the env-scoped SSM Parameter Store namespace for NON-secret
  # config (LOG_LEVEL, TRUST_PROXY, password policy, redis host/port). Secrets
  # live in Secrets Manager under a sibling path — see secrets.tf.
  config_path = "/${var.project_name}/${var.environment}/config"
}
