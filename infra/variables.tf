variable "project_name" {
  description = "Name prefix applied to all resources and tags."
  type        = string
  default     = "auth-api"
}

variable "environment" {
  description = <<-EOT
    Deployment environment. Drives resource naming/tagging (every resource is
    prefixed "<project_name>-<environment>") and, via the per-env tfvars in
    environments/, sizing (task count, cache node type, log retention). No
    default on purpose: an environment must be chosen explicitly, e.g.
    `tofu apply -var-file=environments/prod.tfvars`.
  EOT
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "log_level" {
  description = "Application LOG_LEVEL (pino). Published as a non-secret SSM Parameter Store config value; typically debug in dev, info in staging/prod."
  type        = string
  default     = "info"

  validation {
    condition     = contains(["fatal", "error", "warn", "info", "debug", "trace", "silent"], var.log_level)
    error_message = "log_level must be one of: fatal, error, warn, info, debug, trace, silent."
  }
}

variable "aws_region" {
  description = "AWS region to deploy into. ca-central-1 keeps data resident in Canada."
  type        = string
  default     = "ca-central-1"
}

variable "app_image_tag" {
  description = <<-EOT
    Tag of the application image in ECR to deploy. The repository enforces
    immutable tags, so CI should push a unique tag per build (e.g. the git
    SHA) rather than reusing "latest".
  EOT
  type        = string
  default     = "v0.1.0"
}

variable "desired_count" {
  description = "Baseline number of Fargate tasks. Set per environment (dev 1, staging 2, prod 3); >= 2 across two AZs is the minimum for zero-downtime deploys in staging/prod."
  type        = number
  default     = 2
}

variable "container_cpu" {
  description = "CPU units for the task (1024 = 1 vCPU). 256 is the smallest Fargate size — the API is I/O-bound on Redis, not CPU-bound."
  type        = number
  default     = 256
}

variable "container_memory" {
  description = "Memory (MiB) for the task. Must be a valid Fargate CPU/memory pairing (256 CPU allows 512-2048 MiB)."
  type        = number
  default     = 512
}

variable "password_min_length" {
  description = "Minimum password length enforced by the API (NIST SP 800-63B-4 recommends >= 15 for single-factor auth)."
  type        = number
  default     = 15

  validation {
    condition     = var.password_min_length >= 8
    error_message = "password_min_length must be at least 8 (NIST SP 800-63B absolute floor)."
  }
}

variable "log_retention_days" {
  description = "CloudWatch log retention (also the ALB access-log S3 expiry). Defaults to a compliance-friendly 365; dev/staging override shorter (7/14) to keep storage near-free."
  type        = number
  default     = 365
}

variable "redis_node_type" {
  description = "ElastiCache node type. cache.t4g.micro (Graviton burstable, ~USD 11/mo on-demand in ca-central-1) is plenty for a demo."
  type        = string
  default     = "cache.t4g.micro"
}

variable "redis_num_cache_clusters" {
  description = "Nodes in the Redis replication group (primary + replicas). >= 2 turns on Multi-AZ automatic failover (redis.tf); dev runs 1 to halve cache cost."
  type        = number
  default     = 2

  validation {
    condition     = var.redis_num_cache_clusters >= 1
    error_message = "redis_num_cache_clusters must be at least 1."
  }
}

variable "alb_deletion_protection" {
  description = "Protect the ALB from accidental deletion. On by default; dev turns it off so `tofu destroy` stays one command."
  type        = bool
  default     = true
}

variable "autoscaling_min_capacity" {
  description = "Lower bound for service auto scaling. Staging/prod keep >= 2 so one AZ failure never drops the service to zero; dev may use 1 to save cost."
  type        = number
  default     = 2
}

variable "autoscaling_max_capacity" {
  description = "Upper bound for service auto scaling — a cost circuit-breaker as much as a capacity ceiling."
  type        = number
  default     = 10
}

variable "autoscaling_cpu_target" {
  description = "Average CPU utilization (%) the target-tracking policy maintains across the service."
  type        = number
  default     = 60
}
