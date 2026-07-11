# ---------------------------------------------------------------------------
# staging — production-shaped but smaller. Two tasks across two AZs (the
# minimum for zero-downtime deploys), a slightly larger cache node, and
# medium log retention. Meant to mirror prod's topology so a change that
# works here is trustworthy for prod.
#
# Select with:  tofu apply -var-file=environments/staging.tfvars
# ---------------------------------------------------------------------------
environment = "staging"

# Two tasks across two AZs: survives one AZ loss and enables rolling deploys.
desired_count            = 2
autoscaling_min_capacity = 2
autoscaling_max_capacity = 6

# One size up from dev to catch memory-pressure issues before prod, and a
# primary + replica pair so Multi-AZ failover behaves like prod (redis.tf).
redis_node_type          = "cache.t4g.small"
redis_num_cache_clusters = 2

# Two weeks of logs for investigating pre-prod regressions.
log_retention_days = 14

log_level = "info"
