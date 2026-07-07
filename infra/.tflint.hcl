# TFLint configuration — run from this directory: `tflint --init && tflint`.

# Core Terraform-language hygiene rules (unused declarations, missing
# version constraints, deprecated syntax, ...).
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

# AWS-specific rules: invalid instance/node types, invalid IAM policy JSON,
# resource-attribute sanity checks — catches a class of mistakes that
# `tofu validate` cannot, without needing AWS credentials.
plugin "aws" {
  enabled = true
  version = "0.48.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}
