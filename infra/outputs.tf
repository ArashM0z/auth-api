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

output "redis_url_ssm_parameter_name" {
  description = "SSM parameter holding the rediss:// connection URL (SecureString; value intentionally not output)."
  value       = aws_ssm_parameter.redis_url.name
}
