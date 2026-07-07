# ---------------------------------------------------------------------------
# ElastiCache Redis — the system of record for this API (users, sessions,
# rate-limit counters), not just a cache. Single cache.t4g.micro node
# (~USD 11/mo) with daily snapshots for the demo. Production would run
# num_cache_clusters >= 2 with automatic_failover_enabled and
# multi_az_enabled so an AZ loss promotes a replica instead of losing the
# dataset since the last snapshot.
#
# Note: ElastiCache also offers the Valkey engine (engine = "valkey"), the
# BSD-licensed Redis fork, at a lower price point — a drop-in choice worth
# evaluating given Redis' licence changes.
# ---------------------------------------------------------------------------

resource "aws_elasticache_replication_group" "redis" {
  #checkov:skip=CKV_AWS_191:Default AWS-owned key for at-rest encryption is acceptable for a demo; production with compliance requirements would supply a customer-managed KMS key.
  #checkov:skip=CKV2_AWS_50:Multi-AZ automatic failover needs a replica node, doubling the ~USD 11/mo cache cost for a demo; production enables it (see header comment).
  replication_group_id = "${local.name_prefix}-redis"
  description          = "Redis datastore for ${local.name_prefix}"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.redis_node_type
  port           = 6379

  # Single node: no replica to fail over to, so both must be false.
  num_cache_clusters         = 1
  automatic_failover_enabled = false
  multi_az_enabled           = false

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  # Encrypt everywhere: TLS in transit (hence rediss:// below) and AES-256
  # at rest. Both are free; there is no reason to skip them even in a demo.
  at_rest_encryption_enabled = true
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
