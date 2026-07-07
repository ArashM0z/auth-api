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
  #     key          = "auth-api/dev/terraform.tfstate" # per-env, set at init
  #     region       = "ca-central-1"
  #     encrypt      = true
  #     use_lockfile = true # S3-native locking (OpenTofu >= 1.10 / TF >= 1.10)
  #     # Pre-1.10 runtimes instead use a DynamoDB lock table:
  #     # dynamodb_table = "tofu-state-locks"
  #   }
  #
  # PER-ENVIRONMENT STATE ISOLATION (most -> least recommended):
  #
  #   1. Separate AWS ACCOUNTS per environment (AWS Organizations), each with
  #      its own state bucket. Strongest blast-radius isolation: a mistake or
  #      leaked credential in dev cannot touch prod data OR prod state. Prod in
  #      particular SHOULD be its own account, with CI assuming a per-env role
  #      via OIDC (no long-lived keys).
  #
  #   2. One account, SEPARATE STATE FILES per environment — a distinct backend
  #      `key` per env, supplied at init so nothing is hard-coded:
  #
  #        tofu init \
  #          -backend-config="bucket=example-org-tofu-state" \
  #          -backend-config="key=auth-api/${environment}/terraform.tfstate" \
  #          -backend-config="region=ca-central-1"
  #
  #      Every resource is also name-prefixed "<project>-<environment>" (see
  #      locals.tf) so environments cannot collide within the account.
  #
  #   3. Workspaces (one backend key, `env:/<workspace>/` prefixes). Convenient
  #      but weakest — a single bucket/credential spans all environments, so it
  #      is easy to run prod while pointed at dev. Use only if 1 and 2 cannot.
  #
  # This repo uses `local` for the demo; production would adopt option 1 or 2.
  backend "local" {}
}

provider "aws" {
  region = var.aws_region

  # Applied to every taggable resource — one place to prove ownership,
  # separate cost-allocation reports per environment, and make it obvious in
  # the console which env a resource belongs to.
  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "opentofu"
    }
  }
}
