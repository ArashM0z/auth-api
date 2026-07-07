# ---------------------------------------------------------------------------
# Toolchain pins. Written for OpenTofu (https://opentofu.org) but the HCL is
# Terraform-compatible; ">= 1.8" covers both runtimes.
# ---------------------------------------------------------------------------
terraform {
  required_version = ">= 1.8"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    # Used only to generate the ElastiCache AUTH token so no secret is ever
    # written into the repo. The generated value lives in state — which is why
    # production state must be encrypted and access-controlled (see backend
    # note below).
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  # Local state keeps this take-home reproducible with zero AWS footprint.
  # In production, use remote state with encryption and locking so a team
  # can collaborate safely:
  #
  #   backend "s3" {
  #     bucket       = "example-org-tofu-state"
  #     key          = "auth-api/terraform.tfstate"
  #     region       = "ca-central-1"
  #     encrypt      = true
  #     use_lockfile = true # S3-native locking (OpenTofu >= 1.10 / TF >= 1.10)
  #     # Pre-1.10 runtimes instead use a DynamoDB lock table:
  #     # dynamodb_table = "tofu-state-locks"
  #   }
  backend "local" {}
}

provider "aws" {
  region = var.aws_region

  # Applied to every taggable resource — one place to prove ownership and
  # make cost-allocation reports work without per-resource boilerplate.
  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "opentofu"
    }
  }
}
