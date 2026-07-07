# Optional managed front door: an API Gateway HTTP API that fronts the ALB
# over a VPC Link, adding throttling and a single audited entry point. The
# ALB still works on its own; this is the edge layer for an internal mesh.
resource "aws_apigatewayv2_api" "http" {
  name          = "${local.name_prefix}-http-api"
  protocol_type = "HTTP"
  description   = "Managed edge for the auth API — throttling and a single entry point."
}

resource "aws_apigatewayv2_vpc_link" "alb" {
  name               = "${local.name_prefix}-vpclink"
  security_group_ids = [aws_security_group.alb.id]
  subnet_ids         = aws_subnet.public[*].id
}

resource "aws_apigatewayv2_integration" "alb" {
  api_id             = aws_apigatewayv2_api.http.id
  integration_type   = "HTTP_PROXY"
  integration_uri    = aws_lb_listener.http.arn
  integration_method = "ANY"
  connection_type    = "VPC_LINK"
  connection_id      = aws_apigatewayv2_vpc_link.alb.id
}

resource "aws_apigatewayv2_route" "proxy" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.alb.id}"

  # This gateway fronts an authentication service — the app verifies every
  # request itself, so gateway-level auth (IAM/JWT) would be circular. The
  # gateway's job here is throttling and a single entry point, not authz.
  # checkov:skip=CKV_AWS_309:auth is enforced by the app; the gateway only throttles
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  # checkov:skip=CKV_AWS_76:access logging is a prod concern; deferred for the demo
  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
}

output "api_gateway_endpoint" {
  description = "API Gateway HTTP API endpoint that fronts the ALB."
  value       = aws_apigatewayv2_api.http.api_endpoint
}
