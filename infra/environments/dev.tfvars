# ---------------------------------------------------------------------------
# dev — smallest, cheapest footprint. Single task, single burstable cache
# node, short log retention, debug logging. A single AZ is acceptable here:
# dev has no availability SLO, so cost wins.
#
# Select with:  tofu plan  -var-file=environments/dev.tfvars
#               tofu apply -var-file=environments/dev.tfvars
# (state should be isolated per env — see the backend note in versions.tf)
# ---------------------------------------------------------------------------
environment = "dev"

# One task is enough to exercise the stack; no zero-downtime requirement.
desired_count            = 1
autoscaling_min_capacity = 1
autoscaling_max_capacity = 3

# Smallest Graviton burstable node (~USD 11/mo), and only one of it — no
# replica means no Multi-AZ failover here, which dev's SLO (none) accepts.
redis_node_type          = "cache.t4g.micro"
redis_num_cache_clusters = 1

# Deletion protection off so dev's `tofu destroy` stays one command.
alb_deletion_protection = false

# Short retention keeps CloudWatch storage near-free in a throwaway env.
log_retention_days = 7

# Verbose logs while iterating.
log_level = "debug"
