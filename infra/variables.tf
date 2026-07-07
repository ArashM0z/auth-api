variable "project_name" {
  description = "Name prefix applied to all resources and tags."
  type        = string
  default     = "auth-api"
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
  description = "Baseline number of Fargate tasks. Two tasks across two AZs is the minimum for zero-downtime deploys."
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
  description = "CloudWatch log retention. 30 days balances debuggability against storage cost; compliance workloads often need 365+."
  type        = number
  default     = 30
}

variable "redis_node_type" {
  description = "ElastiCache node type. cache.t4g.micro (Graviton burstable, ~USD 11/mo on-demand in ca-central-1) is plenty for a demo."
  type        = string
  default     = "cache.t4g.micro"
}

variable "autoscaling_min_capacity" {
  description = "Lower bound for service auto scaling. Keep >= 2 so one AZ failure never drops the service to zero."
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
