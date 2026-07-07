output "alb_dns_name" {
  description = "Public entry point — `curl http://<alb_dns_name>/healthz` after deploy."
  value       = aws_lb.app.dns_name
}

output "ecr_repository_url" {
  description = "Push target for application images (docker push <url>:<tag>)."
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  description = "Cluster name, handy for `aws ecs` CLI operations and CI deploy steps."
  value       = aws_ecs_cluster.main.name
}

output "environment" {
  description = "The environment this state manages (dev/staging/prod)."
  value       = var.environment
}

# ARNs (not values) only: a consumer resolves the actual secret/config at
# runtime with its own IAM grant. The rediss:// URL and the AUTH token are
# NEVER emitted as outputs — outputs land in state and `tofu output`, so a
# secret here would leak. This is asserted in tests/security.tftest.hcl.
output "redis_url_secret_arn" {
  description = "Secrets Manager ARN of the REDIS_URL secret (value intentionally NOT output)."
  value       = aws_secretsmanager_secret.redis_url.arn
}

output "config_parameter_path" {
  description = "SSM Parameter Store path prefix holding non-secret config for this environment."
  value       = local.config_path
}
