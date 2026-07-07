# ---------------------------------------------------------------------------
# CONFIG (AWS SSM Parameter Store) — the "non-secret" half of the split.
#
# These are plain `String` parameters (NOT SecureString): every value here is
# non-sensitive operational config, safe to read in the console and safe to
# print in logs. Secrets never appear here — those live in Secrets Manager
# (secrets.tf). Keeping config in Parameter Store (vs. baking it into the task
# definition) means a value can change without a new image or task-def revision,
# and the same task definition promotes cleanly across environments because it
# only references env-scoped parameter PATHS, not literal values.
#
# Namespace is env-scoped: /<project>/<environment>/config/... so dev, staging
# and prod parameters never collide even in a shared account.
# ---------------------------------------------------------------------------

# LOG_LEVEL — injected into the container (secrets block, ecs.tf). Per-env:
# debug in dev, info in staging/prod (see environments/*.tfvars).
resource "aws_ssm_parameter" "log_level" {
  #checkov:skip=CKV2_AWS_34:Deliberately a plain String — LOG_LEVEL is non-secret config, not a credential. SecureString is reserved for secrets, which live in Secrets Manager (secrets.tf); encrypting non-secret config would blur the config/secret boundary this split exists to make explicit.
  name  = "${local.config_path}/LOG_LEVEL"
  type  = "String"
  value = var.log_level
}

# TRUST_PROXY — always true in AWS: tasks sit behind the ALB, so client IPs
# arrive in X-Forwarded-For and the app's per-IP rate limiting depends on it.
# Injected into the container (secrets block, ecs.tf).
resource "aws_ssm_parameter" "trust_proxy" {
  #checkov:skip=CKV2_AWS_34:Deliberately a plain String — TRUST_PROXY is non-secret config. Secrets live in Secrets Manager (secrets.tf); see log_level for the full rationale.
  name  = "${local.config_path}/TRUST_PROXY"
  type  = "String"
  value = "true"
}

# PASSWORD_MIN_LENGTH — password policy is config, not a secret. Injected into
# the container (secrets block, ecs.tf).
resource "aws_ssm_parameter" "password_min_length" {
  #checkov:skip=CKV2_AWS_34:Deliberately a plain String — password POLICY (a length threshold) is non-secret config, not a password. Secrets live in Secrets Manager (secrets.tf); see log_level for the full rationale.
  name  = "${local.config_path}/PASSWORD_MIN_LENGTH"
  type  = "String"
  value = tostring(var.password_min_length)
}

# Redis HOST / PORT — the non-secret half of the connection details. The app
# consumes the assembled REDIS_URL secret (secrets.tf), so these are NOT
# injected into the task; they are published as a discoverable, non-sensitive
# config catalog (e.g. for a sidecar, a migration job, or an on-call operator)
# and to make the config/secret boundary explicit: the host and port are
# public, only the AUTH token is not.
resource "aws_ssm_parameter" "redis_host" {
  #checkov:skip=CKV2_AWS_34:Deliberately a plain String — the Redis endpoint hostname is non-secret (only the AUTH token is). Encrypting it as SecureString would wrongly imply it is a credential; the secret is the full rediss:// URL in Secrets Manager (secrets.tf).
  name  = "${local.config_path}/REDIS_HOST"
  type  = "String"
  value = aws_elasticache_replication_group.redis.primary_endpoint_address
}

resource "aws_ssm_parameter" "redis_port" {
  #checkov:skip=CKV2_AWS_34:Deliberately a plain String — the Redis port (6379) is non-secret config. Secrets live in Secrets Manager (secrets.tf); see redis_host for the rationale.
  name  = "${local.config_path}/REDIS_PORT"
  type  = "String"
  value = "6379"
}
