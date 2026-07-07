# ---------------------------------------------------------------------------
# Container registry. ECR storage is USD 0.10/GB-month — with the lifecycle
# policy below capping history at 10 images (~50 MB each for this slim Node
# image) the registry costs pennies.
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "app" {
  #checkov:skip=CKV_AWS_136:AWS-managed AES-256 encryption is sufficient for demo images; a customer-managed KMS key adds USD 1/mo + per-request cost without a threat model that needs it here.
  # Env-scoped for isolation, consistent with every other resource. An
  # alternative is one SHARED registry with an image-promotion pipeline
  # (build/scan once in dev, then re-tag/pull the identical digest in staging
  # and prod) — preferable when environments are separate AWS accounts.
  name = local.name_prefix

  # Immutable tags mean a tag can never silently point at different bytes —
  # what was reviewed/scanned is what runs. CI pushes a unique tag per build.
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    # Free basic scanning (CVE feed) on every push; findings surface in the
    # console and EventBridge before the image is ever deployed.
    scan_on_push = true
  }

  # Demo convenience: allows `tofu destroy` even with images present.
  # Production would leave this false so a registry can't vanish with its
  # deployment history.
  force_delete = true
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep only the 10 most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
