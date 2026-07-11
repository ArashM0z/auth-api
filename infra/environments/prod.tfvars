# ---------------------------------------------------------------------------
# prod — highest baseline capacity and the widest autoscaling headroom.
# Three tasks across two AZs, longer log retention for incident forensics,
# info-level logging.
#
# IDEALLY prod is a SEPARATE AWS ACCOUNT (AWS Organizations) with its own
# state bucket and a CI role assumed via OIDC — see the backend note in
# versions.tf. The remaining prod-first hardening tracked in inline checkov
# skips (HTTPS/ACM, Secrets Manager rotation) would be turned on here first;
# WAF, VPC Flow Logs, the customer-managed CMK, ALB access logs/deletion
# protection and Multi-AZ Redis are already wired in for every env.
#
# Select with:  tofu apply -var-file=environments/prod.tfvars
# ---------------------------------------------------------------------------
environment = "prod"

# Three tasks: capacity headroom plus room to lose an AZ AND a task mid-deploy.
desired_count            = 3
autoscaling_min_capacity = 3
autoscaling_max_capacity = 20

# cache.t4g.small is a sane floor; a real prod load test may justify moving
# to a memory-optimised r7g node (e.g. cache.r7g.large). Two nodes give
# Multi-AZ automatic failover (see redis.tf).
redis_node_type          = "cache.t4g.small"
redis_num_cache_clusters = 2

# A full year of logs for incident forensics and audit/compliance.
log_retention_days = 365

log_level = "info"
