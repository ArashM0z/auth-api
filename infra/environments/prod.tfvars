# ---------------------------------------------------------------------------
# prod — highest baseline capacity and the widest autoscaling headroom.
# Three tasks across two AZs, longer log retention for incident forensics,
# info-level logging.
#
# IDEALLY prod is a SEPARATE AWS ACCOUNT (AWS Organizations) with its own
# state bucket and a CI role assumed via OIDC — see the backend note in
# versions.tf. Production hardening tracked in the inline checkov skips
# (HTTPS/ACM, WAF, deletion protection, VPC Flow Logs, customer-managed KMS,
# Multi-AZ Redis, Secrets Manager rotation) would be turned on here first.
#
# Select with:  tofu apply -var-file=environments/prod.tfvars
# ---------------------------------------------------------------------------
environment = "prod"

# Three tasks: capacity headroom plus room to lose an AZ AND a task mid-deploy.
desired_count            = 3
autoscaling_min_capacity = 3
autoscaling_max_capacity = 20

# cache.t4g.small is a sane floor; a real prod load test may justify moving
# to a memory-optimised r7g node (e.g. cache.r7g.large) and, importantly,
# num_cache_clusters >= 2 with Multi-AZ automatic failover (see redis.tf).
redis_node_type = "cache.t4g.small"

# 30 days supports incident investigation; regulated data may need 365+.
log_retention_days = 30

log_level = "info"
