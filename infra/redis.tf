# ---------------------------------------------------------------------------
# ElastiCache Redis — the system of record for this API (users, sessions,
# rate-limit counters), not just a cache. Node count is per-environment
# (var.redis_num_cache_clusters): dev runs a single cache.t4g.micro
# (~USD 11/mo), staging/prod run a primary + replica across two AZs with
# automatic failover so an AZ loss promotes the replica instead of losing
# the dataset since the last snapshot.
#
# Note: ElastiCache also offers the Valkey engine (engine = "valkey"), the
# BSD-licensed Redis fork, at a lower price point — a drop-in choice worth
# evaluating given Redis' licence changes.
# ---------------------------------------------------------------------------

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${local.name_prefix}-redis"
  description          = "Redis datastore for ${local.name_prefix}"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.redis_node_type
  port           = 6379

  # Failover and Multi-AZ need a replica to promote, so both follow the
  # node count: on for staging/prod (>= 2 nodes), off for single-node dev.
  # (Ternary instead of a bare comparison so static analyzers can evaluate it.)
  num_cache_clusters         = var.redis_num_cache_clusters
  automatic_failover_enabled = var.redis_num_cache_clusters > 1 ? true : false
  multi_az_enabled           = var.redis_num_cache_clusters > 1 ? true : false

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  # Encrypt everywhere: TLS in transit (hence rediss:// below) and at-rest
  # encryption under the project CMK (kms.tf) so key use is auditable.
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.main.arn
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth.result

  # This Redis holds the only copy of user data, so snapshots are a hard
  # requirement, not an optimization. 7 days of dailies bounds worst-case
  # data loss to the snapshot interval.
  snapshot_retention_limit = 7
  snapshot_window          = "03:00-05:00"
}

# Generated at apply time so no credential ever appears in the repo. It does
# land in state — see the backend note in versions.tf. The token is stored as
# a secret (Secrets Manager) and assembled into the REDIS_URL secret in
# secrets.tf; the non-secret host/port are published to SSM in config.tf.
resource "random_password" "redis_auth" {
  # ElastiCache AUTH tokens must be 16-128 printable characters excluding
  # '@', '"' and '/'. Alphanumeric-only also keeps the token safe to embed
  # in the rediss:// URL without percent-encoding.
  length  = 32
  special = false
}
