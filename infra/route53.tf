# Private DNS for the service: a stable internal name (api.auth.internal)
# that resolves to the ALB, instead of hard-coding the load balancer's
# generated DNS. Private hosted zone — only resolvable inside the VPC.
resource "aws_route53_zone" "internal" {
  name = "auth.internal"

  vpc {
    vpc_id = aws_vpc.main.id
  }

  # checkov:skip=CKV2_AWS_38:DNSSEC is not applicable to a private hosted zone
  # checkov:skip=CKV2_AWS_39:query logging is a prod concern; deferred for the demo
  tags = {
    Name = "${local.name_prefix}-zone"
  }
}

resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.internal.zone_id
  name    = "api.auth.internal"
  type    = "A"

  alias {
    name                   = aws_lb.app.dns_name
    zone_id                = aws_lb.app.zone_id
    evaluate_target_health = true
  }
}

output "service_dns_name" {
  description = "Internal DNS name for the auth API (resolves to the ALB inside the VPC)."
  value       = aws_route53_record.api.fqdn
}
