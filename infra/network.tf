# ---------------------------------------------------------------------------
# Network layout: one VPC, two AZs, a public tier (ALB + Fargate tasks) and a
# private tier (ElastiCache only).
#
# Deliberate cost trade-off: the Fargate tasks run in PUBLIC subnets with
# public IPs and a locked-down security group instead of the textbook
# private-subnets-behind-NAT layout. A NAT gateway costs ~USD 0.062/hr +
# 0.062/GB in ca-central-1 (~USD 65+/mo before data), which dwarfs everything
# else in this demo. The security group still only admits traffic from the
# ALB, so the tasks are not reachable from the internet despite having public
# IPs. Production would use private subnets with either NAT gateways or VPC
# endpoints (ECR, S3, CloudWatch Logs, SSM) so tasks have no public address
# at all.
# ---------------------------------------------------------------------------

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  az_count = 2
  azs      = slice(data.aws_availability_zones.available.names, 0, local.az_count)
}

resource "aws_vpc" "main" {
  #checkov:skip=CKV2_AWS_11:VPC Flow Logs add CloudWatch ingest/storage cost with no reader in a zero-traffic demo; enable them (to S3) in production.
  cidr_block = "10.0.0.0/16"

  # Required for ElastiCache endpoint DNS resolution inside the VPC.
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.project_name}-vpc"
  }
}

# Explicitly manage the VPC default security group down to zero rules so
# nothing can be attached to it accidentally with its permissive defaults.
resource "aws_default_security_group" "main" {
  vpc_id = aws_vpc.main.id

  # No ingress/egress blocks: all traffic denied.

  tags = {
    Name = "${var.project_name}-default-deny-all"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-igw"
  }
}

# Public tier: ALB and Fargate task ENIs. /24 per subnet (251 usable IPs)
# is far more than needed but keeps the addressing plan legible.
resource "aws_subnet" "public" {
  count = local.az_count

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone = local.azs[count.index]

  # Deliberately false: the ECS service assigns public IPs per-task ENI
  # (see aws_ecs_service.app), so nothing else launched here gets a public
  # IP by accident.
  map_public_ip_on_launch = false

  tags = {
    Name = "${var.project_name}-public-${local.azs[count.index]}"
  }
}

# Private tier: ElastiCache only. No route to the internet in either
# direction — the route table below has just the implicit local route.
resource "aws_subnet" "private" {
  count = local.az_count

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${var.project_name}-private-${local.azs[count.index]}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-public"
  }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count = local.az_count

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Intentionally empty (local route only): keeps the cache tier fully
# isolated. Production would add NAT/VPC-endpoint routes here for the app
# tier instead of the public-subnet approach described above.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-private"
  }
}

resource "aws_route_table_association" "private" {
  count = local.az_count

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# ElastiCache lives in the isolated private tier: it never needs outbound
# internet, and nothing outside the VPC should ever reach it.
resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.project_name}-redis"
  subnet_ids = aws_subnet.private[*].id
}
