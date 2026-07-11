# ---------------------------------------------------------------------------
# SECRETS (AWS Secrets Manager) — the "secret" half of the config/secret split.
#
# Principle: SECRETS live in Secrets Manager (rotatable, versioned, audited via
# CloudTrail, retrievable only with an explicit IAM grant); non-secret CONFIG
# lives in SSM Parameter Store (see config.tf). Nothing sensitive is ever put
# in a plain environment variable, an SSM `String` parameter, or a committed
# file. The values here are generated at apply time (random_password, redis.tf)
# so no credential is ever written into the repo.
#
# Two secrets are stored:
#   * redis_auth_token — the raw ElastiCache AUTH token on its own, so it can
#     be ROTATED independently (see the rotation note below) and referenced by
#     other consumers without handing them the full URL.
#   * redis_url — the full rediss://:<token>@host:6379 connection string the
#     app consumes as REDIS_URL. It EMBEDS the token, so it is a secret too and
#     must live here, never in SSM as a String.
#
# Both are encrypted with the project's customer-managed CMK (kms.tf); the
# ECS execution role is granted kms:Decrypt on exactly that key — see the
# execution-role policy in ecs.tf.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "redis_auth_token" {
  #checkov:skip=CKV2_AWS_57:Automatic rotation needs a rotation Lambda + a VPC path to ElastiCache; it is a prod-only concern (see rotation note) and out of scope for a never-applied demo.
  name        = "/${var.project_name}/${var.environment}/redis-auth-token"
  description = "Raw ElastiCache AUTH token for ${local.name_prefix} (rotate independently in prod)."
  kms_key_id  = aws_kms_key.main.arn

  # Demo: destroy immediately so `tofu destroy` leaves nothing behind. Prod
  # keeps the default 30-day recovery window (or longer) so an accidental
  # delete can be undone.
  recovery_window_in_days = 0

  # --- PRODUCTION ROTATION (intentionally omitted for the demo) ---------------
  # Rotate the AUTH token on a schedule with a rotation Lambda:
  #
  #   resource "aws_secretsmanager_secret_rotation" "redis_auth_token" {
  #     secret_id           = aws_secretsmanager_secret.redis_auth_token.id
  #     rotation_lambda_arn = aws_lambda_function.redis_rotator.arn
  #     rotation_rules { automatically_after_days = 30 }
  #   }
  #
  # The Lambda would set a new ElastiCache AUTH token (ROTATE/SET strategy),
  # write it here as a new secret version, and re-assemble redis_url below.
}

resource "aws_secretsmanager_secret_version" "redis_auth_token" {
  secret_id     = aws_secretsmanager_secret.redis_auth_token.id
  secret_string = random_password.redis_auth.result
}

# The full connection string the app reads as REDIS_URL. rediss:// (double s)
# selects TLS, matching transit_encryption_enabled on the replication group.
# It embeds the AUTH token, so it is stored as a secret and injected into the
# task via the container `secrets` block (ecs.tf), never as plaintext env.
resource "aws_secretsmanager_secret" "redis_url" {
  #checkov:skip=CKV2_AWS_57:Rotation is driven by the redis_auth_token secret above (prod-only); this derived URL is re-written by that same rotation Lambda, so a separate schedule here would be redundant.
  name        = "/${var.project_name}/${var.environment}/redis-url"
  description = "Full rediss:// REDIS_URL for ${local.name_prefix} (embeds the AUTH token)."
  kms_key_id  = aws_kms_key.main.arn

  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = "rediss://:${random_password.redis_auth.result}@${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
}
