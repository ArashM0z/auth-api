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
  description = "Fargate tasks: ALB in, internet + redis out"
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

# Open egress: without NAT or VPC endpoints the tasks pull images from ECR,
# ship logs to CloudWatch, and fetch config/secrets from SSM Parameter Store
# and Secrets Manager directly over the internet (TLS), plus talk to Redis
# in-VPC. Production narrows this to 443 + the redis SG once traffic flows
# through VPC endpoints.
resource "aws_vpc_security_group_egress_rule" "app_all" {
  #checkov:skip=CKV_AWS_382:Tasks need general egress to reach ECR/CloudWatch/SSM/Secrets Manager public endpoints because the demo omits NAT and VPC endpoints for cost (see network.tf).
  security_group_id = aws_security_group.app.id
  description       = "ECR pulls, CloudWatch Logs, SSM, Secrets Manager, and Redis"

  cidr_ipv4   = "0.0.0.0/0"
  ip_protocol = "-1"
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
