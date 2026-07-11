# ---------------------------------------------------------------------------
# Three-tier security group chain: internet -> alb -> app -> redis.
# Each tier only admits traffic from the security group in front of it, so
# reachability is expressed in terms of identity (SG membership) rather than
# IP ranges that drift. Rules are standalone resources (not inline blocks)
# per current AWS provider guidance — they can be modified without replacing
# the whole group.
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb"
  description = "ALB: public HTTP in, app tier out"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-alb"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  #checkov:skip=CKV_AWS_260:Port 80 open to the world is the point of a public ALB demo; production terminates TLS on :443 with an ACM cert and 301s HTTP to HTTPS (see alb.tf).
  security_group_id = aws_security_group.alb.id
  description       = "Public HTTP. Production adds :443 + ACM and redirects 80 to 443."

  cidr_ipv4   = "0.0.0.0/0"
  from_port   = 80
  to_port     = 80
  ip_protocol = "tcp"
}

# Egress deliberately scoped: the ALB only ever initiates connections to the
# app tier (request forwarding and /readyz health checks).
resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id = aws_security_group.alb.id
  description       = "Forwarding and health checks to the app tier only"

  referenced_security_group_id = aws_security_group.app.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "app" {
  name        = "${local.name_prefix}-app"
  description = "Fargate tasks: ALB in; HTTPS, redis and DNS out"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-app"
  }
}

# The ONLY ingress to the tasks, despite their public IPs (see network.tf):
# traffic must originate from the ALB security group.
resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id = aws_security_group.app.id
  description       = "App port, reachable only from the ALB"

  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
}

# Egress scoped to exactly what the tasks do: HTTPS to the AWS APIs (no NAT
# or VPC endpoints in this demo, so those are public endpoints — see
# network.tf), Redis in-VPC, and DNS to the VPC resolver. Everything else
# (including plain HTTP out) is denied.

# 443/tcp: ECR image pulls, CloudWatch Logs, SSM Parameter Store, and
# Secrets Manager — all TLS on public AWS endpoints.
resource "aws_vpc_security_group_egress_rule" "app_https" {
  security_group_id = aws_security_group.app.id
  description       = "HTTPS to AWS APIs (ECR, CloudWatch Logs, SSM, Secrets Manager)"

  cidr_ipv4   = "0.0.0.0/0"
  from_port   = 443
  to_port     = 443
  ip_protocol = "tcp"
}

# 6379/tcp, to the redis SG only: the app's datastore connection (TLS).
resource "aws_vpc_security_group_egress_rule" "app_to_redis" {
  security_group_id = aws_security_group.app.id
  description       = "Redis in the private tier, by SG reference only"

  referenced_security_group_id = aws_security_group.redis.id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
}

# 53/udp + 53/tcp to the VPC CIDR: name resolution via the VPC resolver
# (ElastiCache endpoints, AWS API hostnames). TCP is needed for large
# responses that overflow UDP.
resource "aws_vpc_security_group_egress_rule" "app_dns_udp" {
  security_group_id = aws_security_group.app.id
  description       = "DNS (UDP) to the VPC resolver"

  cidr_ipv4   = aws_vpc.main.cidr_block
  from_port   = 53
  to_port     = 53
  ip_protocol = "udp"
}

resource "aws_vpc_security_group_egress_rule" "app_dns_tcp" {
  security_group_id = aws_security_group.app.id
  description       = "DNS (TCP fallback) to the VPC resolver"

  cidr_ipv4   = aws_vpc.main.cidr_block
  from_port   = 53
  to_port     = 53
  ip_protocol = "tcp"
}

resource "aws_security_group" "redis" {
  name        = "${local.name_prefix}-redis"
  description = "ElastiCache: app tier in only"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-redis"
  }
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_app" {
  security_group_id = aws_security_group.redis.id
  description       = "Redis, reachable only from the app tier"

  referenced_security_group_id = aws_security_group.app.id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
}

# No egress rule on the redis SG at all: security groups are stateful, so
# replies to app-initiated connections flow regardless, and the cache never
# initiates outbound connections.
